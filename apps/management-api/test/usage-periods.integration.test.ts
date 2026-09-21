import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { UsagePeriodRepository } from "@idenzy/persistence/repository/usage-period-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics NestJS
// DI depends on.
import { UsageService } from "../dist/usage/usage-service.js";

/**
 * What the usage screen reads, against a real Postgres.
 *
 * The two properties here are the two that cannot be unit-tested: a running level that must span
 * the part of the month the caller did *not* ask for, and a closed period answering from the
 * record after the sketches that produced it have been deleted.
 */

const harness = new PostgresHarness();
const ORG = "33333333-3333-3333-3333-333333333333";
const PROJECT = "11111111-1111-1111-1111-111111111111";
let publicProjectId = "";

let uow: UnitOfWork;
let service: UsageService;

/** The real `ProjectScope` needs an org plane; this test is about the figures, so it is stubbed. */
class FixedScope {
  async of(): Promise<TenantContext> {
    return await Promise.resolve(new TenantContext(PROJECT, "req_test", "customer_staff"));
  }
}

const context = { orgId: ORG } as OrgContext;

function inTenant<T>(work: (usage: UsageRepository) => Promise<T>): Promise<T> {
  const tenant = new TenantContext(PROJECT, "req_test", "system");
  return uow.run(tenant, (tx) => work(new UsageRepository(tx, tenant)));
}

function sketchOf(ids: readonly string[]): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (const id of ids) sketch.add(id);
  return sketch;
}

function users(from: number, to: number): readonly string[] {
  return Array.from({ length: to - from }, (_, n) => `usr_${String(from + n).padStart(32, "0")}`);
}

/** The month in progress, so "open" cases land where the service expects them. */
function thisMonth(dayOfMonth: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth, 9));
}

function monthId(back: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    .toISOString()
    .slice(0, 7);
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  // The scope is substituted, so the service never resolves the project through the org plane.
  service = new UsageService(uow, new FixedScope() as never);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu1', 'EU', 'https://eu.test', 'ring')`,
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
  publicProjectId = `prj_${PROJECT.replaceAll("-", "")}`;
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the usage a screen reads", () => {
  it("carries a level that includes the part of the month the caller did not ask for", async () => {
    await inTenant((usage) => usage.mergeActiveUsers(thisMonth(2), sketchOf(users(0, 60))));
    await inTenant((usage) => usage.mergeActiveUsers(thisMonth(9), sketchOf(users(0, 80))));

    const day9 = thisMonth(9).toISOString().slice(0, 10);
    const usage = await service.forProject(context, publicProjectId, { from: day9, to: day9 });

    expect(usage.days).toHaveLength(1);
    // The window is one day and the level is the month's: a customer looking at the 9th wants
    // what they owe, not what the 9th would have cost on its own.
    expect(usage.days[0]?.activeUsers).toBe(sketchOf(users(0, 80)).count);
    expect(usage.days[0]?.activeUsersToDate).toBe(sketchOf(users(0, 80)).count);

    const day2 = thisMonth(2).toISOString().slice(0, 10);
    const both = await service.forProject(context, publicProjectId, { from: day2, to: day9 });
    expect(both.days.map((day) => day.activeUsersToDate)).toEqual([
      sketchOf(users(0, 60)).count,
      sketchOf(users(0, 80)).count,
    ]);
  });

  it("reports the month in progress as open, from the daily rows", async () => {
    const periods = await service.periods(context, publicProjectId, 3);

    expect(periods[0]?.id).toBe(monthId(0));
    expect(periods[0]?.closed).toBe(false);
    expect(periods[0]?.closedAt).toBeNull();
    expect(periods[0]?.activeUsers).toBe(sketchOf(users(0, 80)).count);
  });

  it("reports a closed month from the record, with no sketches left to read", async () => {
    const period = `${monthId(2)}-01`;
    const tenant = new TenantContext(PROJECT, "req_test", "system");
    await uow.run(tenant, async (tx) => {
      // Exactly what the closer writes, and nothing in `usage_daily` to back it up.
      await new UsagePeriodRepository(tx, tenant).close(
        {
          period,
          activeUsers: 4_211,
          emailsSent: 900,
          smsSent: 12,
          smsVerified: 11,
          smsCost: "0.148000",
        },
        new Date("2026-01-01T00:00:00Z"),
      );
    });

    const periods = await service.periods(context, publicProjectId, 3);
    const closed = periods.find((entry) => entry.id === monthId(2));
    expect(closed?.closed).toBe(true);
    expect(closed?.activeUsers).toBe(4_211);
    expect(closed?.smsCost).toBe("0.148000");
    expect(closed?.closedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns a month nobody used at all, rather than a gap in the list", async () => {
    const periods = await service.periods(context, publicProjectId, 3);
    expect(periods.map((entry) => entry.id)).toEqual([monthId(0), monthId(1), monthId(2)]);
    expect(periods[1]).toMatchObject({ closed: false, activeUsers: 0, emailsSent: 0 });
  });
});
