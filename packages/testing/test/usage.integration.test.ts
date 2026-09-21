import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

/**
 * The MAU sketch against a real Postgres (PROJECT.md 5.1).
 *
 * The sketch itself is unit-tested; what is only observable here is the round trip through
 * `bytea` and the lock the merge takes. A union is not something Postgres can do, so unlike
 * every other counter on this table the merge reads bytes out, unions them in this process and
 * writes them back — and the interesting question is what happens when two meters do that at
 * once, which no fake can answer.
 */

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

let uow: UnitOfWork;

function inTenant<T>(projectId: string, work: (usage: UsageRepository) => Promise<T>): Promise<T> {
  const context = new TenantContext(projectId, "req_test", "system");
  return uow.transaction((tx) => work(new UsageRepository(tx, context)));
}

function sketchOf(ids: readonly string[]): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (const id of ids) sketch.add(id);
  return sketch;
}

function users(from: number, to: number): readonly string[] {
  return Array.from({ length: to - from }, (_, n) => `usr_${String(from + n).padStart(32, "0")}`);
}

/**
 * What a stored sketch must agree with: the same sketch, built here.
 *
 * Deliberately not the true cardinality. An estimator is allowed to answer 2006 for two
 * thousand people and an assertion against 2000 would be testing the published error bound,
 * which is the unit tests' job and is not what a round trip through `bytea` can get wrong.
 * What this file is asking is whether the database ended up holding the union we expect, and
 * the sketch is deterministic, so the two counts are equal or something lost a register.
 */
function expectSameAs(stored: HyperLogLog | undefined, expected: readonly string[]): void {
  expect(stored?.count).toBe(sketchOf(expected).count);
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  const orgId = rows[0]?.id;

  for (const projectId of [PROJECT_A, PROJECT_B]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [projectId, orgId],
    );
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the day's active-user sketch", () => {
  it("survives the round trip through bytea", async () => {
    const day = new Date("2026-03-01T09:00:00Z");
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(0, 400))));

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-03-01", "2026-03-01"),
    );
    expect(rows).toHaveLength(1);
    expectSameAs(rows[0]?.activeUsers, users(0, 400));
  });

  it("accumulates flush after flush rather than replacing what is there", async () => {
    const day = new Date("2026-03-02T09:00:00Z");
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(0, 300))));
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(300, 500))));

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-03-02", "2026-03-02"),
    );
    expectSameAs(rows[0]?.activeUsers, users(0, 500));
  });

  it("is unchanged by a flush replayed after a crash", async () => {
    const day = new Date("2026-03-03T09:00:00Z");
    const flushed = sketchOf(users(0, 250));
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, flushed));
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, flushed));

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-03-03", "2026-03-03"),
    );
    expectSameAs(rows[0]?.activeUsers, users(0, 250));
  });

  it("loses neither half when two meters flush the same day at once", async () => {
    const day = new Date("2026-03-04T09:00:00Z");
    await Promise.all([
      inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(0, 1_000)))),
      inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(1_000, 2_000)))),
    ]);

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-03-04", "2026-03-04"),
    );
    expectSameAs(rows[0]?.activeUsers, users(0, 2_000));
  });

  it("counts a month as the union of its days and never their sum", async () => {
    const returning = users(0, 100);
    for (const day of ["2026-04-01", "2026-04-02", "2026-04-03"]) {
      await inTenant(PROJECT_A, (usage) =>
        usage.mergeActiveUsers(new Date(`${day}T09:00:00Z`), sketchOf(returning)),
      );
    }

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-04-01", "2026-04-30"),
    );
    expect(rows).toHaveLength(3);
    const union = HyperLogLog.union(rows.map((row) => row.activeUsers));
    expect(rows.reduce((total, row) => total + row.activeUsers.count, 0)).toBe(union.count * 3);
    expectSameAs(union, returning);
  });

  it("writes nothing for a day on which nobody was billable", async () => {
    const day = new Date("2026-05-01T09:00:00Z");
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, HyperLogLog.empty()));
    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-05-01", "2026-05-01"),
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps one project's actives out of another's, at the database", async () => {
    const day = new Date("2026-06-01T09:00:00Z");
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(0, 700))));
    await inTenant(PROJECT_B, (usage) => usage.mergeActiveUsers(day, sketchOf(users(0, 40))));

    const b = await inTenant(PROJECT_B, (usage) => usage.dailyBetween("2026-06-01", "2026-06-01"));
    expect(b).toHaveLength(1);
    expectSameAs(b[0]?.activeUsers, users(0, 40));
  });
});
