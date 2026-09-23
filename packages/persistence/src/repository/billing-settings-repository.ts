import { AUTO_TOP_UP_DAILY_LIMIT } from "@idenzy/protocol/billing/price-list";
import {
  type AutoTopUpSuspension,
  BillingMode,
  DEFAULT_INVOICE_TERMS_DAYS,
} from "@idenzy/protocol/enums/billing";
import { and, eq, isNull, sql } from "drizzle-orm";
import { billingSettings } from "../schema/billing.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface AutoTopUpRow {
  readonly enabled: boolean;
  readonly thresholdCents: number;
  readonly amountCents: number;
  readonly methodId: string | null;
}

/** What the rule remembers about its own attempts. Written by the rule, never over the wire. */
export interface AutoTopUpStateRow {
  readonly dailyLimit: number;
  readonly failures: number;
  readonly lastAttemptAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly suspendedReason: AutoTopUpSuspension | null;
}

export interface SpendAlertRow {
  readonly enabled: boolean;
  readonly thresholdCents: number;
  readonly sentForMonth: string | null;
}

export interface BillingSettingsRow {
  readonly currency: string;
  readonly autoTopUp: AutoTopUpRow;
  readonly autoTopUpState: AutoTopUpStateRow;
  /** How the organisation pays (ADR-0019). Staff-set. */
  readonly mode: BillingMode;
  readonly invoiceTermsDays: number;
  /** Where invoices go, for an invoiced organisation. Required by constraint when invoiced. */
  readonly invoiceEmail: string | null;
  readonly spendAlert: SpendAlertRow;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

/** What an organisation that has never opened the screen gets: both levers off. */
const DEFAULTS: Omit<BillingSettingsRow, "updatedAt"> = {
  currency: "USD",
  autoTopUp: { enabled: false, thresholdCents: 0, amountCents: 0, methodId: null },
  autoTopUpState: {
    dailyLimit: AUTO_TOP_UP_DAILY_LIMIT,
    failures: 0,
    lastAttemptAt: null,
    suspendedAt: null,
    suspendedReason: null,
  },
  mode: BillingMode.Prepaid,
  invoiceTermsDays: DEFAULT_INVOICE_TERMS_DAYS,
  invoiceEmail: null,
  spendAlert: { enabled: false, thresholdCents: 0, sentForMonth: null },
  updatedBy: null,
};

function toRow(row: typeof billingSettings.$inferSelect): BillingSettingsRow {
  return {
    currency: row.currency,
    autoTopUp: {
      enabled: row.autoTopUpEnabled,
      thresholdCents: row.autoTopUpThresholdCents,
      amountCents: row.autoTopUpAmountCents,
      methodId: row.autoTopUpMethodId,
    },
    autoTopUpState: {
      dailyLimit: row.autoTopUpDailyLimit,
      failures: row.autoTopUpFailures,
      lastAttemptAt: row.autoTopUpLastAttemptAt,
      suspendedAt: row.autoTopUpSuspendedAt,
      // Safe: the column is written only from AutoTopUpSuspension.
      suspendedReason: row.autoTopUpSuspendedReason as AutoTopUpSuspension | null,
    },
    // Safe: the column is constrained to BillingMode's values by `billing_settings_mode_ck`.
    mode: row.billingMode as BillingMode,
    invoiceTermsDays: row.invoiceTermsDays,
    invoiceEmail: row.invoiceEmail,
    spendAlert: {
      enabled: row.spendAlertEnabled,
      thresholdCents: row.spendAlertThresholdCents,
      sentForMonth: row.spendAlertSentForMonth,
    },
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

/**
 * The rules an organisation has set about its own money (ADR-0011, PROJECT.md 5.1).
 *
 * `current` never answers null. A missing row and a row with both levers off mean the
 * same thing, and handing back the one shape spares every caller a branch whose two
 * sides would be identical — which is also the branch somebody eventually gets wrong in
 * the direction that charges a card.
 */
export class BillingSettingsRepository extends OrgRepository<typeof billingSettings> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, billingSettings);
  }

  async current(): Promise<BillingSettingsRow> {
    const rows = await this.tx.select().from(billingSettings).where(this.orgScope()).limit(1);
    const row = rows[0];
    return row === undefined ? { ...DEFAULTS, updatedAt: new Date(0) } : toRow(row);
  }

  /**
   * The settings, with the row locked until the transaction ends.
   *
   * What serialises the automatic rule per organisation. Two workers asking at once both
   * reach this statement and the second waits for the first to commit — by which time the
   * charge the first opened is visible, and the second sees it and stands down. Null means no
   * row, which means the rule was never switched on and there is nothing to lock.
   */
  async lockForAutoTopUp(): Promise<BillingSettingsRow | null> {
    const rows = await this.tx
      .select()
      .from(billingSettings)
      .where(this.orgScope())
      .limit(1)
      .for("update");
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /** Stamps the attempt the rule is about to make. Inside the transaction that opens it. */
  async recordAutoTopUpAttempt(at: Date): Promise<void> {
    await this.tx
      .update(billingSettings)
      .set({ autoTopUpLastAttemptAt: at })
      .where(this.orgScope());
  }

  /** A charge the rule made went through, so the next failure starts counting from one. */
  async recordAutoTopUpSuccess(): Promise<void> {
    await this.tx.update(billingSettings).set({ autoTopUpFailures: 0 }).where(this.orgScope());
  }

  /**
   * Counts a charge the rule made that did not succeed, and answers the new count.
   *
   * In the statement rather than read-then-write, so a webhook and the worker settling the
   * same organisation's charges cannot both write the same figure.
   */
  async recordAutoTopUpFailure(): Promise<number> {
    const rows = await this.tx
      .update(billingSettings)
      .set({ autoTopUpFailures: sql`least(${billingSettings.autoTopUpFailures} + 1, 100)` })
      .where(this.orgScope())
      .returning({ failures: billingSettings.autoTopUpFailures });
    return rows[0]?.failures ?? 0;
  }

  /**
   * Stops the rule until a person saves it again, and answers whether this call did.
   *
   * The first reason stands. A rule suspended because a card needs authentication and then
   * disputed is still, first, a card that needs authentication — and the person who clears
   * it should see what stopped it rather than whatever happened last.
   */
  async suspendAutoTopUp(reason: AutoTopUpSuspension, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(billingSettings)
      .set({ autoTopUpSuspendedAt: at, autoTopUpSuspendedReason: reason })
      .where(and(this.orgScope(), isNull(billingSettings.autoTopUpSuspendedAt)))
      .returning({ orgId: billingSettings.orgId });
    return rows.length === 1;
  }

  /**
   * An automatic rule that added less than it triggered on would fire again on the
   * balance it had just created. `billing_settings_auto_top_up_ck` refuses that pair, so
   * this surfaces as a constraint violation rather than as a charge loop.
   */
  async setAutoTopUp(
    setting: AutoTopUpRow,
    updatedBy: string | null,
    options: { readonly clearSuspension: boolean } = { clearSuspension: true },
  ): Promise<void> {
    await this.upsert(
      {
        autoTopUpEnabled: setting.enabled,
        autoTopUpThresholdCents: setting.thresholdCents,
        autoTopUpAmountCents: setting.amountCents,
        autoTopUpMethodId: setting.methodId,
        // A person saving the rule is the person clearing whatever stopped it: they have
        // seen the reason on the screen they saved from, and the count starts again. A side
        // effect of removing a card is not that, so its caller keeps the suspension.
        ...(options.clearSuspension
          ? { autoTopUpSuspendedAt: null, autoTopUpSuspendedReason: null, autoTopUpFailures: 0 }
          : {}),
      },
      updatedBy,
    );
  }

  /**
   * Switches how the organisation pays (ADR-0019). Called only from the operator surface, inside
   * the transaction that also writes the `operator_actions` row recording who and why.
   */
  async setBillingMode(
    mode: BillingMode,
    termsDays: number,
    invoiceEmail: string | null,
    updatedBy: string | null,
  ) {
    await this.upsert({ billingMode: mode, invoiceTermsDays: termsDays, invoiceEmail }, updatedBy);
  }

  async setSpendAlert(
    setting: Omit<SpendAlertRow, "sentForMonth">,
    updatedBy: string | null,
  ): Promise<void> {
    await this.upsert(
      {
        spendAlertEnabled: setting.enabled,
        spendAlertThresholdCents: setting.thresholdCents,
        // A new threshold has not been alerted on yet, whatever the old one had reached.
        spendAlertSentForMonth: null,
      },
      updatedBy,
    );
  }

  /**
   * Records that this month's alert has gone out, and answers whether it was this call
   * that claimed it.
   *
   * The `is distinct from` predicate is the guard: a threshold crossed once would
   * otherwise be mailed on every sweep for the rest of the month, and a customer who
   * learns to ignore the alert has the same protection as one who never enabled it.
   */
  async claimSpendAlert(month: string): Promise<boolean> {
    const rows = await this.tx
      .update(billingSettings)
      .set({ spendAlertSentForMonth: month, updatedAt: new Date() })
      .where(
        and(
          this.orgScope(),
          eq(billingSettings.spendAlertEnabled, true),
          sql`${billingSettings.spendAlertSentForMonth} is distinct from ${month}`,
        ),
      )
      .returning({ orgId: billingSettings.orgId });
    return rows.length === 1;
  }

  private async upsert(
    values: Partial<typeof billingSettings.$inferInsert>,
    updatedBy: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.guard(() =>
      this.tx
        .insert(billingSettings)
        .values({ orgId: this.context.orgId, ...values, updatedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: billingSettings.orgId,
          set: { ...values, updatedBy, updatedAt: now },
        }),
    );
  }
}
