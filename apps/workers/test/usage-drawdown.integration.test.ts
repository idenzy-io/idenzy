import { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { Clock } from "@idenzy/core/time/clock";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { OrgUsageActivityReader } from "@idenzy/persistence/repository/org-usage-activity-reader";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { mauCents, TOLERANCE_FLOOR_CENTS } from "@idenzy/protocol/billing/price-list";
import { CreditKind } from "@idenzy/protocol/enums/billing";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsageDrawdown } from "../src/usage-drawdown.js";

/**
 * Taking what usage costs out of the wallet, against a real Postgres.
 *
 * Everything worth asserting here is a property of the database rather than of the code.
 * The watermark's compare-and-swap is what makes two passes safe, and a fake would agree
 * with whatever this code believed about it; the check constraints are what stop a debt
 * going negative; and the union of a month's sketches only means anything against the rows
 * that hold them.
 */

const harness = new PostgresHarness();
const ORG = "aaaa0000-0000-4000-8000-000000000001";
const OTHER_ORG = "bbbb0000-0000-4000-8000-000000000002";
const PROJECT_A = "cccc0000-0000-4000-8000-000000000003";
const PROJECT_B = "dddd0000-0000-4000-8000-000000000004";
const OTHER_PROJECT = "eeee0000-0000-4000-8000-000000000005";

let uow: UnitOfWork;

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
}

/** Mid-month, so the period is open and the sketches are still there to union. */
const clock = new FixedClock(new Date("2026-03-15T12:00:00Z"));
const PERIOD = "2026-03-01";
const context = new OrgContext(ORG, "req_test", "system");

/** A gate one transaction waits on, so two of them are in flight at the same instant. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

let hold = gate();

function drawdown(): UsageDrawdown {
  return new UsageDrawdown(uow, new OrgUsageActivityReader(harness.db), clock, new SilentLogger());
}

/**
 * A sketch of `count` distinct users, offset so two projects' sets do not overlap.
 *
 * The offset is the point of the test below: real user ids are project-scoped, so two
 * projects never share one, and adding their counts is exact rather than approximate.
 */
function sketchOf(count: number, offset = 0): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (let n = 0; n < count; n += 1) {
    sketch.add(`usr_${String(offset + n).padStart(32, "0")}`);
  }
  return sketch;
}

async function seedUsage(projectId: string, day: string, sketch: HyperLogLog): Promise<void> {
  const tenant = new TenantContext(projectId, "req_test", "system");
  await uow.transaction((tx) =>
    new UsageRepository(tx, tenant).mergeActiveUsers(new Date(`${day}T06:00:00Z`), sketch),
  );
}

async function grant(cents: number): Promise<void> {
  await uow.transaction((tx) =>
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

async function wallet(): Promise<{ credit: number; debt: number; billed: number }> {
  return await uow.transaction(async (tx) => ({
    credit: await new CreditGrantRepository(tx, context).balanceCents(clock.now()),
    debt: await new UsageDrawdownRepository(tx, context).debtCents(),
    billed: (await new UsageDrawdownRepository(tx, context).stateFor(PERIOD)).billedCents,
  }));
}

async function reset(): Promise<void> {
  for (const [table, key] of [
    ["usage_charges", "org_id"],
    ["usage_billing_state", "org_id"],
    ["org_debts", "org_id"],
    ["credit_grants", "org_id"],
  ] as const) {
    await harness.owner.query(`DELETE FROM ${table} WHERE ${key} = $1`, [ORG]);
  }
  await harness.owner.query(`DELETE FROM usage_daily WHERE project_id = ANY($1::uuid[])`, [
    [PROJECT_A, PROJECT_B, OTHER_PROJECT],
  ]);
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  for (const org of [ORG, OTHER_ORG]) {
    await harness.owner.query(
      `INSERT INTO orgs (id, name)
       VALUES ($1, 'Acme')`,
      [org],
    );
  }
  for (const [project, org] of [
    [PROJECT_A, ORG],
    [PROJECT_B, ORG],
    [OTHER_PROJECT, OTHER_ORG],
  ] as const) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [project, org],
    );
  }
}, 180_000);

beforeEach(async () => {
  hold = gate();
  await reset();
});

afterAll(async () => {
  await harness.stop();
});

describe("charging a month's active users", () => {
  it("charges nothing inside the free allowance", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(500));
    await grant(10_000);

    expect(await drawdown().runOnce()).toBe(0);
    const after = await wallet();
    expect(after.credit).toBe(10_000);
    expect(after.debt).toBe(0);
  });

  /**
   * The organisation's allowance, not each project's. Two projects of 30,000 are 60,000
   * active users and 10,000 of them are chargeable — where a per-project allowance would
   * charge for none, which is what splitting one project into ten used to buy.
   *
   * Adding the two counts is exact because users are project-scoped and the two sets are
   * disjoint. The sketches are unioned within a project, across its days, and only the
   * resulting counts are added.
   */
  it("pools the allowance across the organisation's projects", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(30_000, 0));
    await seedUsage(PROJECT_B, "2026-03-02", sketchOf(30_000, 1_000_000));
    await grant(100_000);

    expect(await drawdown().runOnce()).toBe(1);
    const after = await wallet();
    // Roughly 60,000 actives: 10,000 past the allowance at $0.003 is about $30. The sketch
    // is an estimate, so the assertion is a band rather than a figure.
    expect(after.billed).toBeGreaterThan(2000);
    expect(after.billed).toBeLessThan(4500);
    expect(after.credit).toBe(100_000 - after.billed);
    expect(after.debt).toBe(0);
  });

  /**
   * The guarantee the whole design exists for. A pass that runs again reprices the same
   * month, finds the watermark already there, and charges nothing — so the balance after
   * three passes is the balance after one.
   */
  it("charges once however many times it runs", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(60_000));
    await grant(100_000);

    expect(await drawdown().runOnce()).toBe(1);
    const once = await wallet();
    expect(once.billed).toBeGreaterThan(0);

    expect(await drawdown().runOnce()).toBe(0);
    expect(await drawdown().runOnce()).toBe(0);
    expect(await wallet()).toEqual(once);
  });

  /**
   * The compare-and-swap itself, driven directly.
   *
   * Running two passes through `Promise.all` does *not* test this — the pool serialises
   * them, the second reads a watermark the first has already moved, and it charges nothing
   * for the ordinary reason rather than the interesting one. That version of this test
   * passed with the `setWhere` deleted, which is the only reason it is written this way.
   *
   * So the two transactions are interleaved by hand: both read the same watermark, then
   * both try to move it. Exactly one may succeed. The loser's `false` is what makes the
   * job roll its whole transaction back, credit included.
   */
  it("lets exactly one of two passes move the watermark", async () => {
    await grant(100_000);
    const expected = 0;

    const first = uow.transaction(async (tx) => {
      const repository = new UsageDrawdownRepository(tx, context);
      const state = await repository.stateFor(PERIOD);
      expect(state.billedMau).toBe(expected);
      await hold.promise;
      return await repository.advance(PERIOD, expected, 60_000, 3000);
    });

    const second = uow.transaction(async (tx) => {
      const repository = new UsageDrawdownRepository(tx, context);
      const state = await repository.stateFor(PERIOD);
      expect(state.billedMau).toBe(expected);
      const won = await repository.advance(PERIOD, expected, 61_000, 3300);
      hold.release();
      return won;
    });

    const results = await Promise.all([first, second]);
    expect(results.filter(Boolean)).toHaveLength(1);

    // And the watermark is one of the two, never a mixture of both.
    const settled = await uow.transaction((tx) =>
      new UsageDrawdownRepository(tx, context).stateFor(PERIOD),
    );
    expect([3000, 3300]).toContain(settled.billedCents);
  });

  /**
   * More users next pass costs the difference and never the whole month again. This is the
   * assertion that would fail if the job priced a delta rather than repricing the total.
   */
  it("charges only the difference as the month grows", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(60_000, 0));
    await grant(1_000_000);
    await drawdown().runOnce();
    const first = await wallet();

    await seedUsage(PROJECT_A, "2026-03-09", sketchOf(60_000, 5_000_000));
    expect(await drawdown().runOnce()).toBe(1);
    const second = await wallet();

    expect(second.billed).toBeGreaterThan(first.billed);
    // The second charge is the difference between the two prices, not the second price.
    expect(first.credit - second.credit).toBe(second.billed - first.billed);
  });
});

/**
 * The other half of ADR-0016: the drawdown decides in the control plane and publishes into each
 * cell, so `WalletSolvency` never reaches across the boundary on the send path. Asserted from
 * this side because this is the side that writes.
 */
describe("publishing the spend gate into each cell", () => {
  it("writes a row for every project of the organisation it visited", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(80_000));
    await drawdown().runOnce();

    const { rows } = await harness.owner.query<{ project_id: string; spendable: boolean }>(
      `SELECT project_id, spendable FROM project_spend_state WHERE project_id = ANY($1::uuid[])
       ORDER BY project_id`,
      [[PROJECT_A, PROJECT_B]],
    );
    // Both projects, not only the one with usage: the gate is an organisation's answer and a
    // cell holds projects, so it has to be written everywhere that organisation has one.
    expect(rows).toHaveLength(2);
  });

  /**
   * The case that would be missed by publishing only after a charge. An organisation past its
   * tolerance stops being served, so it stops accruing charges — and the pass that follows has
   * nothing to charge it for. If that pass skipped publishing, the refusal would age out and the
   * gate would open for somebody who had stopped paying.
   */
  it("publishes even on a pass that charges nothing", async () => {
    await drawdown().runOnce();
    const { rows } = await harness.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM project_spend_state WHERE project_id = $1`,
      [PROJECT_A],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("refuses in the cell once the debt passes the tolerance", async () => {
    await uow.transaction((tx) =>
      new UsageDrawdownRepository(tx, context).adjustDebt(TOLERANCE_FLOOR_CENTS + 100_000),
    );
    await drawdown().runOnce();

    const { rows } = await harness.owner.query<{ spendable: boolean; reason: string }>(
      `SELECT spendable, reason FROM project_spend_state WHERE project_id = $1`,
      [PROJECT_A],
    );
    expect(rows[0]?.spendable).toBe(false);
    expect(rows[0]?.reason).not.toBe("");
  });

  it("sets a horizon in the future, so a cell has something to expire", async () => {
    await drawdown().runOnce();
    const { rows } = await harness.owner.query<{ ahead: boolean }>(
      `SELECT stale_after > computed_at AS ahead FROM project_spend_state WHERE project_id = $1`,
      [PROJECT_A],
    );
    expect(rows[0]?.ahead).toBe(true);
  });
});

describe("when the credit runs out", () => {
  /**
   * The overage lands on debt rather than on a grant, because a grant cannot go negative:
   * it is something that was bought, and a bought thing is not worth less than nothing.
   */
  it("puts what credit cannot cover onto the debt", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(80_000));
    await grant(1000);

    expect(await drawdown().runOnce()).toBe(1);
    const after = await wallet();
    expect(after.credit).toBe(0);
    expect(after.debt).toBe(after.billed - 1000);

    const charges = await uow.transaction((tx) =>
      new UsageDrawdownRepository(tx, context).recentCharges(),
    );
    const charge = charges[0];
    // The two halves sum to what was charged, which the check constraint also insists on.
    expect((charge?.fromCreditCents ?? 0) + (charge?.toDebtCents ?? 0)).toBe(charge?.chargedCents);
    expect(charge?.fromCreditCents).toBe(1000);
  });

  it("keeps charging into debt without ever going below zero credit", async () => {
    await seedUsage(PROJECT_A, "2026-03-02", sketchOf(80_000, 0));
    await grant(500);
    await drawdown().runOnce();

    await seedUsage(PROJECT_A, "2026-03-09", sketchOf(80_000, 5_000_000));
    await drawdown().runOnce();

    const after = await wallet();
    expect(after.credit).toBe(0);
    expect(after.debt).toBe(after.billed - 500);
  });
});

describe("keeping one organisation out of another's wallet", () => {
  /**
   * The one that matters. Everything above could pass while the job charged the wrong
   * organisation, and a single-organisation fixture cannot tell the difference.
   */
  it("never charges an organisation for another's usage", async () => {
    await seedUsage(OTHER_PROJECT, "2026-03-02", sketchOf(80_000));
    await grant(100_000);

    await drawdown().runOnce();

    const mine = await wallet();
    expect(mine.billed).toBe(0);
    expect(mine.credit).toBe(100_000);

    const theirs = new OrgContext(OTHER_ORG, "req_test", "system");
    const theirState = await uow.transaction((tx) =>
      new UsageDrawdownRepository(tx, theirs).stateFor(PERIOD),
    );
    expect(theirState.billedCents).toBeGreaterThan(0);
    await harness.owner.query(`DELETE FROM usage_charges WHERE org_id = $1`, [OTHER_ORG]);
    await harness.owner.query(`DELETE FROM usage_billing_state WHERE org_id = $1`, [OTHER_ORG]);
    await harness.owner.query(`DELETE FROM org_debts WHERE org_id = $1`, [OTHER_ORG]);
  });
});

describe("the price the job charges", () => {
  /** The job must not hold a second opinion about what a month costs. */
  it("is the price list's, not one of its own", () => {
    expect(mauCents(60_000)).toBe(3000);
    expect(mauCents(1_000_000)).toBe(247_500);
  });
});
