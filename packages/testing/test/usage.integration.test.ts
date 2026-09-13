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
  return uow.run(context, (tx) => work(new UsageRepository(tx, context)));
}

function sketchOf(ids: readonly string[]): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (const id of ids) sketch.add(id);
  return sketch;
}

function users(from: number, to: number): readonly string[] {
  return Array.from({ length: to - from }, (_, n) => `usr_${String(from + n).padStart(32, "0")}`);
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  const orgId = rows[0]?.id;

  for (const projectId of [PROJECT_A, PROJECT_B]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
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
    expect(rows[0]?.activeUsers.count).toBe(400);
  });

  it("accumulates flush after flush rather than replacing what is there", async () => {
    const day = new Date("2026-03-02T09:00:00Z");
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(0, 300))));
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, sketchOf(users(300, 500))));

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-03-02", "2026-03-02"),
    );
    expect(rows[0]?.activeUsers.count).toBe(500);
  });

  it("is unchanged by a flush replayed after a crash", async () => {
    const day = new Date("2026-03-03T09:00:00Z");
    const flushed = sketchOf(users(0, 250));
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, flushed));
    await inTenant(PROJECT_A, (usage) => usage.mergeActiveUsers(day, flushed));

    const rows = await inTenant(PROJECT_A, (usage) =>
      usage.dailyBetween("2026-03-03", "2026-03-03"),
    );
    expect(rows[0]?.activeUsers.count).toBe(250);
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
    expect(rows[0]?.activeUsers.count).toBe(2_000);
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
    expect(rows.reduce((total, row) => total + row.activeUsers.count, 0)).toBe(300);
    expect(HyperLogLog.union(rows.map((row) => row.activeUsers)).count).toBe(100);
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
    expect(b[0]?.activeUsers.count).toBe(40);
  });
});
