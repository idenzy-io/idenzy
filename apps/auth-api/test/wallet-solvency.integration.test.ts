import { SystemClock } from "@idenzy/core/time/clock";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { TOLERANCE_FLOOR_CENTS } from "@idenzy/protocol/billing/price-list";
import { BillingLineItem, CreditKind } from "@idenzy/protocol/enums/billing";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { WalletSolvency } from "../dist/delivery/wallet-solvency.js";

/**
 * Whether an organisation may still spend, against a real Postgres.
 *
 * The gate is the synchronous half of ADR-0014 and the only part of billing on a request
 * path. What is worth asserting is the shape of its refusal: it is not a zero check, it
 * runs out gradually, and it never answers about anything but the metered channels — the
 * caller is `DatabaseSpendCap`, and nothing on the authentication path asks it at all.
 */

const harness = new PostgresHarness();
const ORG = "f0f0f0f0-0000-4000-8000-000000000001";
const PROJECT = "f1f1f1f1-0000-4000-8000-000000000002";

let uow: UnitOfWork;
let solvency: WalletSolvency;

const clock = new SystemClock();
const context = new OrgContext(ORG, "req_test", "system");

async function setDebt(cents: number): Promise<void> {
  await uow.runForOrg(context, (tx) => new UsageDrawdownRepository(tx, context).adjustDebt(cents));
}

async function setCredit(cents: number): Promise<void> {
  await uow.runForOrg(context, (tx) =>
    new CreditGrantRepository(tx, context).grant({
      kind: CreditKind.Purchased,
      amountCents: cents,
      currency: "USD",
      topUpId: null,
      note: "Test credit",
      expiresAt: null,
    }),
  );
}

/** Charges in the window, which is what the tolerance is a share of. */
async function chargeHistory(cents: number): Promise<void> {
  await uow.runForOrg(context, (tx) =>
    new UsageDrawdownRepository(tx, context).record({
      period: "2026-03-01",
      item: BillingLineItem.Mau,
      quantity: 1,
      chargedCents: cents,
      fromCreditCents: cents,
      toDebtCents: 0,
    }),
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  solvency = new WalletSolvency(uow, clock);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  await harness.owner.query(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES ($1, 'Acme', (SELECT id FROM region_cells LIMIT 1))`,
    [ORG],
  );
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
     VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [PROJECT, ORG],
  );
}, 180_000);

beforeEach(async () => {
  for (const table of ["usage_charges", "org_debts", "credit_grants"]) {
    await harness.owner.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]);
  }
});

afterAll(async () => {
  await harness.stop();
});

describe("whether an organisation may still spend", () => {
  it("allows one that owes nothing", async () => {
    expect(await solvency.canSpend(PROJECT)).toBe(true);
  });

  it("allows one whose credit covers what it owes", async () => {
    await setCredit(10_000);
    await setDebt(4000);
    expect(await solvency.canSpend(PROJECT)).toBe(true);
  });

  /**
   * The design's whole point: running out is not a cliff. A new organisation with no
   * history still gets the floor, so its first overage is not also its first outage.
   */
  it("allows a small overage on the floor alone", async () => {
    await setDebt(TOLERANCE_FLOOR_CENTS - 100);
    expect(await solvency.canSpend(PROJECT)).toBe(true);
  });

  it("refuses once the debt passes the floor and there is no history", async () => {
    await setDebt(TOLERANCE_FLOOR_CENTS + 100);
    expect(await solvency.canSpend(PROJECT)).toBe(false);
  });

  /**
   * Tolerance is a share of what was charged, so an organisation that uses more gets more
   * rope — and it does not move because they happened to top up on a particular day, which
   * is the failure of keying it on payments.
   */
  it("gives a heavier user more rope, in proportion to what it was charged", async () => {
    await chargeHistory(500_000);
    // 20% of $5,000 is $1,000, comfortably above the floor.
    await setDebt(90_000);
    expect(await solvency.canSpend(PROJECT)).toBe(true);

    await setDebt(20_000);
    expect(await solvency.canSpend(PROJECT)).toBe(false);
  });

  /** Credit offsets the debt before the tolerance is consulted at all. */
  it("counts credit against the debt before the rope", async () => {
    await setDebt(TOLERANCE_FLOOR_CENTS + 1000);
    expect(await solvency.canSpend(PROJECT)).toBe(false);
    await setCredit(1500);
    expect(await solvency.canSpend(PROJECT)).toBe(true);
  });

  /**
   * A project nobody can read is one nobody can be billed for. Refusing is the safe
   * direction: the alternative is spending money on an unattributable send.
   */
  it("refuses a project it cannot resolve to an organisation", async () => {
    expect(await solvency.canSpend("99999999-0000-4000-8000-00000000ffff")).toBe(false);
  });
});
