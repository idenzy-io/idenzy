import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { allocateCents } from "@idenzy/domain/policies/allocate-cents";
import type { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import type { PaymentProvider } from "@idenzy/domain/ports/payment-provider";
import { WalletLedger } from "@idenzy/persistence/billing/wallet-ledger";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import type { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import {
  type InvoiceLineRow,
  InvoiceRepository,
  type InvoiceRow,
} from "@idenzy/persistence/repository/invoice-repository";
import { OrgBillingCustomerRepository } from "@idenzy/persistence/repository/org-billing-customer-repository";
import { OrgProjectRepository } from "@idenzy/persistence/repository/org-project-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { UsagePeriodRepository } from "@idenzy/persistence/repository/usage-period-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { Transaction, UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { mauCents } from "@idenzy/protocol/billing/price-list";
import {
  BillingLineItem,
  BillingMode,
  PaymentProvider as ProviderName,
} from "@idenzy/protocol/enums/billing";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { monthEnd } from "./periods.js";

export interface InvoiceRunnerOptions {
  readonly intervalMs?: number;
  readonly orgsPerPage?: number;
}

/** Hourly. A month is invoiced once and its closer runs every fifteen minutes; there is no hurry. */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_PAGE = 100;

/** What a draft came to, for the log and for tests. */
export type DraftResult = "drafted" | "nothing_owed" | "settled_from_credit" | "not_ready";

/**
 * Invoices the organisations staff chose to bill in arrears, once a month (ADR-0019).
 *
 * **Two phases, and the row always comes first.** A month is drafted in one Postgres transaction —
 * the price of the month less what the prepaid part of it already paid (the drawdown's watermark),
 * any prepaid credit applied, any prepaid debt carried over, the lines, the invoice row, and the
 * watermark advanced — and only then issued at the provider. A crash between the two leaves a
 * draft, which the next run issues; the provider finds an invoice it already made by our reference
 * rather than making a second.
 *
 * **Never twice.** One invoice per organisation and month is a unique index; the watermark advance
 * is a compare-and-swap, so two runs drafting at once let exactly one commit; and the drawdown, which
 * skips invoiced organisations, finds the watermark already at the month's price if the organisation
 * is later switched back.
 *
 * **Nothing stops over an unpaid invoice.** This issues and records; overdue is the provider's
 * event and a person's decision.
 */
export class InvoiceRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly payments: PaymentProvider,
    private readonly work: BillingWorkReader,
    private readonly signals: BillingSignals,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: InvoiceRunnerOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drafts every organisation ready for last month, then issues every draft. Never throws. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const period = previousMonth(this.clock.now());
      await this.eachPage(
        (after, limit) => this.work.invoicedReady(period, monthEnd(period), limit, after),
        (orgId) => this.draft(orgId, period),
      );
      await this.eachPage(
        (after, limit) => this.work.withDraftInvoices(limit, after),
        (orgId) => this.issueDrafts(orgId),
      );
    } catch (cause: unknown) {
      this.logger.error("invoice run cut short", {
        component: "billing",
        outcome: "deferred",
        errorName: cause instanceof Error ? cause.name : "unknown",
      });
    } finally {
      this.running = false;
    }
  }

  /** Drafts one organisation's invoice for a month. Everything that moves money is one transaction. */
  async draft(orgId: string, period: string): Promise<DraftResult> {
    const context = new OrgContext(orgId, "invoice-run", "system");
    const now = this.clock.now();
    const result = await this.uow.transaction(async (tx) => {
      const settings = new BillingSettingsRepository(tx, context);
      // The lock every writer of this organisation's money takes first.
      const current = await settings.lockForAutoTopUp();
      if (current?.mode !== BillingMode.Invoiced) return "not_ready" as const;
      const invoices = new InvoiceRepository(tx, context);
      if ((await invoices.forPeriod(period)) !== null) return "not_ready" as const;

      const usage = await this.monthUsage(tx, context, period);

      const drawdown = new UsageDrawdownRepository(tx, context);
      const state = await drawdown.stateFor(period);
      const debt = await drawdown.lockedDebtCents();
      const credit = await new CreditGrantRepository(tx, context).balanceCents(now);
      const bill = billFor(usage, state.billedCents, debt, credit);

      // Last of the reads and inside this transaction: two runs drafting at once both read the
      // same watermark, and exactly one moves it.
      if (!(await drawdown.advance(period, state.billedMau, bill.mau, bill.priced))) {
        throw new ConcurrentInvoiceRun(`${orgId} ${period}`);
      }
      if (bill.lines.length === 0) return "nothing_owed" as const;

      return await this.write(tx, context, period, bill, current.currency, now);
    });
    // Quiet for a month with nothing owed: the run finds it again every hour, and says nothing
    // each time rather than the same nothing each time.
    if (result === "drafted" || result === "settled_from_credit") {
      await this.signals.walletMoved(orgId);
      this.logger.info("invoice drafted", { orgId, component: "billing", outcome: result });
    }
    return result;
  }

  /**
   * Moves the money a month's bill says and writes the invoice, inside the drafting transaction:
   * prepaid debt carried onto it, prepaid credit applied against it, and the row itself.
   */
  private async write(
    tx: Transaction,
    context: OrgContext,
    period: string,
    bill: MonthBill,
    currency: string,
    now: Date,
  ): Promise<"drafted" | "settled_from_credit"> {
    if (bill.debt > 0) await new UsageDrawdownRepository(tx, context).adjustDebt(-bill.debt);
    if (bill.applied > 0) await new WalletLedger(tx, context).debit(bill.applied, now);
    // A month wholly covered by credit left over from prepaid is a receipt, not a bill: there is
    // nothing for the provider to collect, so it is written settled and never sent.
    const settled = bill.total === 0;
    await new InvoiceRepository(tx, context).issue(
      {
        number: invoiceNumber(context.orgId, period),
        periodStart: period,
        periodEnd: monthEnd(period),
        currency,
        provider: ProviderName.Stripe,
        issuedAt: now,
        dueAt: null,
        paidAt: settled ? now : null,
        lines: bill.lines,
      },
      settled ? "paid" : "draft",
    );
    return settled ? "settled_from_credit" : "drafted";
  }

  /** Issues every draft an organisation holds, at the provider, and writes the answer down. */
  async issueDrafts(orgId: string): Promise<number> {
    const context = new OrgContext(orgId, "invoice-run", "system");
    const found = await this.uow.transaction(async (tx) => ({
      drafts: await new InvoiceRepository(tx, context).drafts(),
      settings: await new BillingSettingsRepository(tx, context).current(),
      org: await new OrgBillingCustomerRepository(tx, context).current(),
      projects: await new OrgProjectRepository(tx, context).list(),
    }));
    if (found.drafts.length === 0 || found.org === null) return 0;
    if (found.settings.invoiceEmail === null) return 0;

    const customer = await this.customerOf(context, found.org, found.settings.invoiceEmail);
    await this.payments.setBillingEmail(customer, found.settings.invoiceEmail);
    const names = new Map(found.projects.map((project) => [project.id, project.name]));

    let issued = 0;
    for (const draft of found.drafts) {
      if (await this.issueOne(context, draft, customer, found.settings, names)) issued += 1;
    }
    return issued;
  }

  private async issueOne(
    context: OrgContext,
    draft: InvoiceRow,
    customer: string,
    settings: { readonly invoiceTermsDays: number },
    names: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    const lines = await this.uow.transaction((tx) =>
      new InvoiceRepository(tx, context).linesOf(draft.id),
    );
    const invoice = await this.payments.issueInvoice({
      providerCustomerId: customer,
      orgId: context.orgId,
      reference: draft.id,
      number: draft.number,
      currency: draft.currency,
      daysUntilDue: settings.invoiceTermsDays,
      lines: lines.map((line) => ({
        reference: line.id,
        description: describe(line, names),
        amountCents: line.totalCents,
      })),
    });
    const recorded = await this.uow.transaction((tx) =>
      new InvoiceRepository(tx, context).recordIssued(draft.id, {
        providerInvoiceId: invoice.providerInvoiceId,
        hostedUrl: invoice.hostedUrl,
        pdfUrl: invoice.pdfUrl,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
      }),
    );
    if (recorded) {
      this.logger.info("invoice issued", {
        orgId: context.orgId,
        component: "billing",
        outcome: "issued",
      });
    }
    return recorded;
  }

  /** Each project's closed MAU for the month: the frozen figure the period closer wrote. */
  private async monthUsage(
    tx: Transaction,
    context: OrgContext,
    period: string,
  ): Promise<readonly { projectId: string; mau: number }[]> {
    const projects = await new OrgProjectRepository(tx, context).list();
    const usage: { projectId: string; mau: number }[] = [];
    for (const project of projects) {
      const tenant = new TenantContext(project.id, "invoice-run", "system");
      const [closed] = await new UsagePeriodRepository(tx, tenant).between(period, period);
      usage.push({ projectId: project.id, mau: closed?.activeUsers ?? 0 });
    }
    return usage;
  }

  /** The provider's customer for the organisation, created and claimed if it has none yet. */
  private async customerOf(
    context: OrgContext,
    org: { readonly name: string; readonly billingCustomerId: string | null },
    email: string,
  ): Promise<string> {
    if (org.billingCustomerId !== null) return org.billingCustomerId;
    const created = await this.payments.ensureCustomer(context.orgId, org.name, email);
    const won = await this.uow.transaction((tx) =>
      new OrgBillingCustomerRepository(tx, context).claim(created.providerCustomerId),
    );
    if (won) return created.providerCustomerId;
    const reread = await this.uow.transaction((tx) =>
      new OrgBillingCustomerRepository(tx, context).current(),
    );
    return reread?.billingCustomerId ?? created.providerCustomerId;
  }

  private async eachPage(
    page: (after: string | null, limit: number) => Promise<readonly string[]>,
    each: (orgId: string) => Promise<unknown>,
  ): Promise<void> {
    const limit = this.options.orgsPerPage ?? DEFAULT_PAGE;
    let after: string | null = null;
    for (;;) {
      const orgs = await page(after, limit);
      for (const orgId of orgs) {
        try {
          await each(orgId);
        } catch (cause: unknown) {
          // One organisation's failure is not the run's. A draft stays a draft; a month not
          // drafted is drafted next hour.
          this.logger.error("invoice not produced", {
            orgId,
            component: "billing",
            outcome: "deferred",
            errorName: cause instanceof Error ? cause.name : "unknown",
          });
        }
      }
      const last = orgs.at(-1);
      if (orgs.length < limit || last === undefined) return;
      after = last;
    }
  }
}

/** What a month bills, before anything is written. */
interface MonthBill {
  readonly mau: number;
  readonly priced: number;
  /** Prepaid debt carried onto the invoice. */
  readonly debt: number;
  /** Prepaid credit applied against it. */
  readonly applied: number;
  readonly total: number;
  /** Empty when nothing is owed at all. */
  readonly lines: InvoiceLineRow[];
}

/**
 * The month's bill: its price less what the prepaid part of it already paid (the watermark), plus
 * any prepaid debt, less any prepaid credit — as lines that sum to the total exactly.
 *
 * Pure, so the arithmetic is readable apart from the transaction that writes it.
 */
function billFor(
  usage: readonly { projectId: string; mau: number }[],
  billedCents: number,
  debtCents: number,
  creditCents: number,
): MonthBill {
  const mau = usage.reduce((total, project) => total + project.mau, 0);
  const priced = mauCents(mau);
  const owed = Math.max(0, priced - billedCents);
  const applied = Math.min(creditCents, owed + debtCents);
  const total = owed + debtCents - applied;
  if (owed + debtCents === 0) return { mau, priced, debt: 0, applied: 0, total: 0, lines: [] };

  const shares = allocateCents(
    owed,
    usage.map((project) => project.mau),
  );
  const lines: InvoiceLineRow[] = usage
    .map((project, index) => ({
      projectId: project.projectId,
      item: BillingLineItem.Mau,
      quantity: project.mau,
      unitRateMillicents:
        project.mau === 0 ? 0 : Math.round(((shares[index] ?? 0) * 1000) / project.mau),
      totalCents: shares[index] ?? 0,
    }))
    .filter((line) => line.totalCents > 0);
  if (debtCents > 0) {
    lines.push({
      projectId: null,
      item: BillingLineItem.PrepaidDebt,
      quantity: 1,
      unitRateMillicents: 0,
      totalCents: debtCents,
    });
  }
  if (applied > 0) {
    lines.push({
      projectId: null,
      item: BillingLineItem.PrepaidCredit,
      quantity: 1,
      unitRateMillicents: 0,
      totalCents: -applied,
    });
  }
  return { mau, priced, debt: debtCents, applied, total, lines };
}

/** Ours, human, never reused: the month and the start of the organisation's public id. */
function invoiceNumber(orgId: string, period: string): string {
  const org = PublicId.encode(IdPrefix.Org, orgId).value.slice(4, 12).toUpperCase();
  return `IDZ-${period.slice(0, 7).replace("-", "")}-${org}`;
}

function previousMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10);
}

function describe(line: InvoiceLineRow, names: ReadonlyMap<string, string>): string {
  switch (line.item) {
    case BillingLineItem.Mau: {
      const name = line.projectId === null ? "" : (names.get(line.projectId) ?? "a project");
      return `Monthly active users — ${name} (${line.quantity.toLocaleString("en-US")})`;
    }
    case BillingLineItem.PrepaidDebt:
      return "Usage owed on the prepaid wallet before invoicing";
    case BillingLineItem.PrepaidCredit:
      return "Prepaid credit applied";
    default:
      return line.item;
  }
}

/**
 * Another run drafted this organisation's month first. Thrown to roll back what this one did — the
 * credit applied, the debt cleared — because the other run did exactly the same.
 */
class ConcurrentInvoiceRun extends Error {
  override readonly name = "ConcurrentInvoiceRun";
}
