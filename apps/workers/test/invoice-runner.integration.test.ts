import { BillingWorkReader } from "@idenzy/persistence/repository/billing-work-reader";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { InvoiceRepository } from "@idenzy/persistence/repository/invoice-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { mauCents } from "@idenzy/protocol/billing/price-list";
import { CreditKind } from "@idenzy/protocol/enums/billing";
import { FakePaymentProvider } from "@idenzy/testing/fake-payment-provider";
import { FakeClock, RecordingBillingSignals, RecordingLogger } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InvoiceRunner } from "../src/billing/invoice-runner.js";

/**
 * Month-end invoicing for organisations billed in arrears, against a real Postgres (ADR-0019).
 *
 * The money invariants are the database's — a unique invoice per organisation and month, a
 * watermark moved by compare-and-swap, credit and debt moved in the same transaction as the
 * invoice — so they are asserted against it. The provider is a fake that, like Stripe, finds an
 * invoice it already made by our reference.
 */
const harness = new PostgresHarness();
const ORG = "aaaa0000-0000-4000-8000-0000000000d1";
const PROJECT_A = "cccc0000-0000-4000-8000-0000000000d2";
const PROJECT_B = "dddd0000-0000-4000-8000-0000000000d3";
const PERIOD = "2026-09-01";
const context = new OrgContext(ORG, "req_test", "system");

let uow: UnitOfWork;
let clock: FakeClock;
let provider: FakePaymentProvider;

function runner(): InvoiceRunner {
  return new InvoiceRunner(
    uow,
    provider,
    new BillingWorkReader(harness.db),
    new RecordingBillingSignals(),
    clock,
    new RecordingLogger(),
  );
}

async function closed(projectId: string, activeUsers: number): Promise<void> {
  await harness.owner.query(
    `INSERT INTO usage_daily (project_id, day, mau, mau_to_date) VALUES ($1, '2026-09-15', $2, $2)`,
    [projectId, activeUsers],
  );
  await harness.owner.query(
    `INSERT INTO usage_periods (project_id, period, active_users, emails_sent, sms_sent,
                                sms_verified, sms_cost, closed_at)
     VALUES ($1, $2, $3, 0, 0, 0, 0, now())`,
    [projectId, PERIOD, activeUsers],
  );
}

async function invoiced(): Promise<void> {
  await harness.owner.query(
    `INSERT INTO billing_settings (org_id, billing_mode, invoice_terms_days, invoice_email)
     VALUES ($1, 'invoiced', 14, 'ap@acme.test')`,
    [ORG],
  );
}

async function invoices() {
  const { rows } = await harness.owner.query<{
    id: string;
    status: string;
    total_cents: string;
    provider_invoice_id: string | null;
    hosted_url: string | null;
  }>(
    `SELECT id, status, total_cents, provider_invoice_id, hosted_url FROM invoices WHERE org_id = $1`,
    [ORG],
  );
  return rows.map((row) => ({ ...row, total_cents: Number(row.total_cents) }));
}

async function lines(): Promise<{ item: string; total: number }[]> {
  const { rows } = await harness.owner.query<{ item: string; total_cents: string }>(
    `SELECT item, total_cents FROM invoice_lines WHERE org_id = $1 ORDER BY item, total_cents`,
    [ORG],
  );
  return rows.map((row) => ({ item: row.item, total: Number(row.total_cents) }));
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Acme')`, [ORG]);
  for (const project of [PROJECT_A, PROJECT_B]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
      [project, ORG],
    );
  }
}, 180_000);

beforeEach(async () => {
  for (const table of [
    "invoice_lines",
    "invoices",
    "usage_billing_state",
    "org_debts",
    "credit_grants",
    "billing_settings",
  ]) {
    await harness.owner.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]);
  }
  await harness.owner.query(`UPDATE orgs SET billing_customer_id = NULL WHERE id = $1`, [ORG]);
  await harness.owner.query(`DELETE FROM usage_periods WHERE project_id = ANY($1::uuid[])`, [
    [PROJECT_A, PROJECT_B],
  ]);
  await harness.owner.query(`DELETE FROM usage_daily WHERE project_id = ANY($1::uuid[])`, [
    [PROJECT_A, PROJECT_B],
  ]);
  clock = new FakeClock(new Date("2026-10-01T09:00:00Z"));
  provider = new FakePaymentProvider();
});

afterAll(async () => {
  await harness.stop();
});

describe("a month's invoice", () => {
  it("bills the month's price, split across projects to the cent, and issues it once", async () => {
    await invoiced();
    await closed(PROJECT_A, 120_000);
    await closed(PROJECT_B, 80_000);
    await runner().runOnce();

    const expected = mauCents(200_000);
    const [invoice] = await invoices();
    expect(invoice).toMatchObject({ status: "open", total_cents: expected });
    expect(invoice?.hosted_url).toContain("https://invoice.test/");
    const mau = (await lines()).filter((line) => line.item === "mau");
    expect(mau).toHaveLength(2);
    expect(mau.reduce((total, line) => total + line.total, 0)).toBe(expected);

    expect(provider.invoices.size).toBe(1);
    const sent = [...provider.invoices.values()][0];
    expect(sent?.daysUntilDue).toBe(14);
    expect(sent?.lines.reduce((total, line) => total + line.amountCents, 0)).toBe(expected);
    expect([...provider.billingEmails.values()]).toEqual(["ap@acme.test"]);
  });

  /**
   * Switched from prepaid mid-month: the prepaid part was already drawn from the wallet, and the
   * watermark says how much. The invoice bills the rest, never the whole month again.
   */
  it("bills only what the prepaid part of the month did not already pay", async () => {
    await invoiced();
    await closed(PROJECT_A, 200_000);
    await uow.transaction((tx) =>
      new UsageDrawdownRepository(tx, context).advance(PERIOD, 0, 100_000, mauCents(100_000)),
    );
    await runner().runOnce();
    expect((await invoices())[0]?.total_cents).toBe(mauCents(200_000) - mauCents(100_000));
  });

  it("applies credit left from prepaid, and carries prepaid debt onto the invoice", async () => {
    await invoiced();
    await closed(PROJECT_A, 100_000);
    await uow.transaction(async (tx) => {
      await new CreditGrantRepository(tx, context).grant({
        kind: CreditKind.Purchased,
        amountCents: 3_000,
        currency: "USD",
        topUpId: null,
        note: "left over",
        expiresAt: null,
      });
      await new UsageDrawdownRepository(tx, context).adjustDebt(500);
    });
    await runner().runOnce();

    const owed = mauCents(100_000);
    expect((await invoices())[0]?.total_cents).toBe(owed + 500 - 3_000);
    expect(await lines()).toEqual(
      expect.arrayContaining([
        { item: "prepaid_debt", total: 500 },
        { item: "prepaid_credit", total: -3_000 },
      ]),
    );
    const wallet = await uow.transaction(async (tx) => ({
      credit: await new CreditGrantRepository(tx, context).balanceCents(clock.now()),
      debt: await new UsageDrawdownRepository(tx, context).debtCents(),
    }));
    expect(wallet).toEqual({ credit: 0, debt: 0 });
  });

  it("records a month wholly covered by credit as paid, and asks the provider for nothing", async () => {
    await invoiced();
    await closed(PROJECT_A, 60_000);
    await uow.transaction((tx) =>
      new CreditGrantRepository(tx, context).grant({
        kind: CreditKind.Purchased,
        amountCents: 1_000_000,
        currency: "USD",
        topUpId: null,
        note: "plenty",
        expiresAt: null,
      }),
    );
    await runner().runOnce();
    expect((await invoices())[0]).toMatchObject({ status: "paid", total_cents: 0 });
    const { rows } = await harness.owner.query<{ paid_at: Date | null }>(
      `SELECT paid_at FROM invoices WHERE org_id = $1`,
      [ORG],
    );
    expect(rows[0]?.paid_at).not.toBeNull();
    expect(provider.invoiceRequests).toHaveLength(0);
  });

  it("invoices nothing for a month with nothing owed", async () => {
    await invoiced();
    await closed(PROJECT_A, 10_000);
    await runner().runOnce();
    expect(await invoices()).toEqual([]);
  });

  it("waits while any project's month is still open", async () => {
    await invoiced();
    await closed(PROJECT_A, 100_000);
    await harness.owner.query(
      `INSERT INTO usage_daily (project_id, day) VALUES ($1, '2026-09-20')`,
      [PROJECT_B],
    );
    await runner().runOnce();
    expect(await invoices()).toEqual([]);
  });

  it("leaves a prepaid organisation to the drawdown", async () => {
    await closed(PROJECT_A, 100_000);
    await runner().runOnce();
    expect(await invoices()).toEqual([]);
  });
});

describe("never twice", () => {
  it("issues one invoice however many times the run is repeated", async () => {
    await invoiced();
    await closed(PROJECT_A, 150_000);
    await runner().runOnce();
    await runner().runOnce();
    clock.advanceSeconds(3600);
    await runner().runOnce();
    expect(await invoices()).toHaveLength(1);
    expect(provider.invoices.size).toBe(1);
  });

  /**
   * The provider made the invoice and the answer was lost. The draft stays a draft, and the next
   * run asks again under the same reference and is handed the invoice it already made.
   */
  it("recovers an invoice whose answer was lost without issuing a second", async () => {
    await invoiced();
    await closed(PROJECT_A, 150_000);
    provider.failNextInvoice = true;
    await runner().runOnce();
    expect((await invoices())[0]?.status).toBe("draft");

    await runner().runOnce();
    expect((await invoices())[0]?.status).toBe("open");
    expect(provider.invoiceRequests).toHaveLength(2);
    expect(provider.invoices.size).toBe(1);
  });

  it("drafts once when two runs draft the same month at the same moment", async () => {
    await invoiced();
    await closed(PROJECT_A, 150_000);
    const results = await Promise.allSettled([
      runner().draft(ORG, PERIOD),
      runner().draft(ORG, PERIOD),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled" && result.value === "drafted"),
    ).toHaveLength(1);
    expect(await invoices()).toHaveLength(1);
  });

  it("keeps a draft out of what the customer is shown", async () => {
    await invoiced();
    await closed(PROJECT_A, 150_000);
    provider.failNextInvoice = true;
    await runner().runOnce();
    const shown = await uow.transaction((tx) => new InvoiceRepository(tx, context).list());
    expect(shown).toEqual([]);
  });
});
