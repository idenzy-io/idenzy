import { Clock } from "@idenzy/core/time/clock";
import { ProjectSpendStateRepository } from "@idenzy/persistence/repository/project-spend-state-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { WalletSolvency } from "../dist/delivery/wallet-solvency.js";

/**
 * The spend gate as a cell reads it (ADR-0016), against a real Postgres.
 *
 * The arithmetic is not here any more. It is pure and lives in `SpendTolerance`, tested in
 * `@idenzy/domain` without a database, because testing a calculation through Postgres was testing
 * Postgres. What needs a database is the property this file now asserts: that the decision the
 * control plane published is the decision the cell reads back, in the cell's own tables, with no
 * query crossing the plane boundary on the send path.
 *
 * The two fail-open cases are the ones worth staring at. A gate that failed closed would mean a
 * dead drawdown silently stopping one-time codes for paying customers, which is a far worse
 * outage than a few hours of spending by somebody who has stopped paying — a trade ADR-0014 had
 * already made when it wrote "neither does an outage of ours".
 */
const harness = new PostgresHarness();
const ORG = "f0f0f0f0-0000-4000-8000-000000000001";
const PROJECT = "f1f1f1f1-0000-4000-8000-000000000002";
const ABSENT = "f2f2f2f2-0000-4000-8000-000000000003";

let uow: UnitOfWork;
let solvency: WalletSolvency;
let now = new Date("2026-03-01T12:00:00.000Z");

/** Moved by hand, so a staleness horizon can be crossed without waiting six hours. */
class TestClock extends Clock {
  override now(): Date {
    return now;
  }
}

const tenant = new TenantContext(PROJECT, "req_test", "system");

/** What the drawdown does at the end of a pass, without running the whole worker. */
async function publish(spendable: boolean, staleAfter: Date): Promise<void> {
  await uow.transaction((tx) =>
    new ProjectSpendStateRepository(tx, tenant).publish({
      spendable,
      reason: spendable ? "" : "Owed beyond the tolerance.",
      computedAt: now,
      staleAfter,
    }),
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  solvency = new WalletSolvency(uow, new TestClock());

  await harness.owner.query(
    `INSERT INTO orgs (id, name)
     VALUES ($1, 'Acme')`,
    [ORG],
  );
  for (const projectId of [PROJECT, ABSENT]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [projectId, ORG],
    );
  }
}, 180_000);

beforeEach(async () => {
  now = new Date("2026-03-01T12:00:00.000Z");
  await harness.owner.query(`DELETE FROM project_spend_state WHERE project_id = $1`, [PROJECT]);
});

afterAll(async () => {
  await harness.stop();
});

describe("the spend gate a cell reads", () => {
  it("refuses when the drawdown published a refusal that is still current", async () => {
    await publish(false, new Date(now.getTime() + 60 * 60 * 1000));
    expect(await solvency.canSpend(PROJECT)).toBe(false);
  });

  it("allows when the drawdown published an allowance", async () => {
    await publish(true, new Date(now.getTime() + 60 * 60 * 1000));
    expect(await solvency.canSpend(PROJECT)).toBe(true);
  });

  /**
   * Every new project, and every project whose organisation owes nothing, has no row. Treating
   * that as a refusal would refuse the common case — the gate would be closed by default for a
   * customer who has never owed a penny.
   */
  it("allows a project the drawdown has never visited", async () => {
    expect(await solvency.canSpend(ABSENT)).toBe(true);
  });

  /**
   * The fail-open case, and the reason this control is safe to depend on. A refusal that nobody
   * refreshed is not a decision about a customer; it is a worker that died.
   */
  it("allows once a refusal has gone stale, because a stale gate is our outage and not theirs", async () => {
    const staleAfter = new Date(now.getTime() + 60 * 60 * 1000);
    await publish(false, staleAfter);
    expect(await solvency.canSpend(PROJECT)).toBe(false);

    now = new Date(staleAfter.getTime() + 1000);
    expect(await solvency.canSpend(PROJECT)).toBe(true);
  });

  it("re-refuses when a later pass republishes, so opening is never permanent", async () => {
    await publish(false, new Date(now.getTime() + 1000));
    now = new Date(now.getTime() + 60_000);
    expect(await solvency.canSpend(PROJECT)).toBe(true);

    // The next pass lands. An upsert, so the project has one row rather than a history.
    await publish(false, new Date(now.getTime() + 60 * 60 * 1000));
    expect(await solvency.canSpend(PROJECT)).toBe(false);

    const { rows } = await harness.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM project_spend_state WHERE project_id = $1`,
      [PROJECT],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  /**
   * The property the whole change exists for. If this query needed a control-plane table, the
   * send path would still be crossing planes and ADR-0016 would not have happened.
   */
  it("reads nothing outside the cell", async () => {
    await publish(false, new Date(now.getTime() + 60 * 60 * 1000));
    // Take the org-keyed tables away entirely: the gate must still answer.
    for (const table of ["usage_charges", "org_debts", "credit_grants"]) {
      await harness.owner.query(`DELETE FROM ${table} WHERE org_id = $1`, [ORG]);
    }
    expect(await solvency.canSpend(PROJECT)).toBe(false);
  });
});
