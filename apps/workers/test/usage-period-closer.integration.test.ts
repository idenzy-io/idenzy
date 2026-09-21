import { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { Clock } from "@idenzy/core/time/clock";
import { UsageClosableReader } from "@idenzy/persistence/repository/usage-closable-reader";
import { UsagePeriodRepository } from "@idenzy/persistence/repository/usage-period-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsagePeriodCloser } from "../src/usage-period-closer.js";

/**
 * The pass that drops data, against a real Postgres (PROJECT.md 5.1).
 *
 * It deletes the only thing that can produce a month's figure, so the properties worth asserting
 * are all about what happens when it goes wrong: a second pass over a period that is already shut,
 * a month that is not old enough to touch, and a flush that turns up after the door closed. None
 * of those is observable without the transaction and the constraint being real.
 */

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

let uow: UnitOfWork;
let closer: UsagePeriodCloser;

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
  constructor(private instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
  moveTo(instant: Date): void {
    this.instant = instant;
  }
}

/** Mid-March, so February is well past its grace and March is the month in progress. */
const clock = new FixedClock(new Date("2026-03-15T12:00:00Z"));

function inTenant<T>(
  projectId: string,
  work: (repos: { usage: UsageRepository; periods: UsagePeriodRepository }) => Promise<T>,
): Promise<T> {
  const context = new TenantContext(projectId, "req_test", "system");
  return uow.run(context, (tx) =>
    work({
      usage: new UsageRepository(tx, context),
      periods: new UsagePeriodRepository(tx, context),
    }),
  );
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
  closer = new UsagePeriodCloser(
    new UsageClosableReader(harness.db),
    uow,
    clock,
    new SilentLogger(),
  );

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu1', 'EU', 'https://eu.test', 'ring')`,
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

describe("closing a usage period", () => {
  it("records the union of the month and then drops the sketches that produced it", async () => {
    // The same forty people on both days, plus ten new ones on the second: one month of fifty.
    await inTenant(PROJECT_A, ({ usage }) =>
      usage.mergeActiveUsers(new Date("2026-01-10T09:00:00Z"), sketchOf(users(0, 40))),
    );
    await inTenant(PROJECT_A, ({ usage }) =>
      usage.mergeActiveUsers(new Date("2026-01-11T09:00:00Z"), sketchOf(users(0, 50))),
    );

    expect(await closer.sweep()).toBeGreaterThanOrEqual(1);

    const closed = await inTenant(PROJECT_A, ({ periods }) =>
      periods.between("2026-01-01", "2026-01-01"),
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]?.activeUsers).toBe(sketchOf(users(0, 50)).count);

    const days = await inTenant(PROJECT_A, ({ usage }) =>
      usage.dailyBetween("2026-01-01", "2026-01-31"),
    );
    // The sketches are gone and the two levels the chart draws are in their place.
    expect(days.map((day) => day.activeUsers.isEmpty)).toEqual([true, true]);
    expect(days.map((day) => day.mau)).toEqual([
      sketchOf(users(0, 40)).count,
      sketchOf(users(0, 50)).count,
    ]);
    expect(days.map((day) => day.mauToDate)).toEqual([
      sketchOf(users(0, 40)).count,
      sketchOf(users(0, 50)).count,
    ]);
  });

  it("shuts a period once, and a second pass does not reopen it against sketches that are gone", async () => {
    const before = await inTenant(PROJECT_A, ({ periods }) =>
      periods.between("2026-01-01", "2026-01-01"),
    );
    await closer.sweep();
    const after = await inTenant(PROJECT_A, ({ periods }) =>
      periods.between("2026-01-01", "2026-01-01"),
    );
    expect(after).toEqual(before);
  });

  it("leaves the month in progress alone, and the one still inside its grace", async () => {
    await inTenant(PROJECT_B, ({ usage }) =>
      usage.mergeActiveUsers(new Date("2026-03-02T09:00:00Z"), sketchOf(users(0, 30))),
    );
    await closer.sweep();

    const open = await inTenant(PROJECT_B, ({ usage }) =>
      usage.dailyBetween("2026-03-01", "2026-03-31"),
    );
    expect(open[0]?.activeUsers.isEmpty).toBe(false);
    expect(open[0]?.mauToDate).toBeNull();

    // One minute into February would be inside a six-hour grace if February were the month that
    // had just ended, which is the case the boundary is computed for.
    clock.moveTo(new Date("2026-02-01T00:01:00Z"));
    await inTenant(PROJECT_B, ({ usage }) =>
      usage.mergeActiveUsers(new Date("2026-01-20T09:00:00Z"), sketchOf(users(0, 30))),
    );
    await closer.sweep();
    expect(
      await inTenant(PROJECT_B, ({ periods }) => periods.between("2026-01-01", "2026-01-01")),
    ).toHaveLength(0);

    clock.moveTo(new Date("2026-03-15T12:00:00Z"));
  });

  it("refuses a flush that arrives after the period was shut", async () => {
    await inTenant(PROJECT_A, ({ usage }) =>
      usage.mergeActiveUsers(new Date("2026-01-11T09:00:00Z"), sketchOf(users(500, 900))),
    );

    const days = await inTenant(PROJECT_A, ({ usage }) =>
      usage.dailyBetween("2026-01-11", "2026-01-11"),
    );
    // Dropped, not merged: a closed period is a financial record and putting a sketch back on a
    // day whose figure is already published would make the two disagree.
    expect(days[0]?.activeUsers.isEmpty).toBe(true);
    expect(days[0]?.mau).toBe(sketchOf(users(0, 50)).count);
  });

  it("closes a month that had no billable users but did send email", async () => {
    await inTenant(PROJECT_B, ({ usage }) =>
      usage.recordEmailSent(new Date("2025-12-04T09:00:00Z"), 7),
    );
    await closer.sweep();

    const closed = await inTenant(PROJECT_B, ({ periods }) =>
      periods.between("2025-12-01", "2025-12-01"),
    );
    expect(closed).toHaveLength(1);
    expect(closed[0]?.activeUsers).toBe(0);
    expect(closed[0]?.emailsSent).toBe(7);
  });

  it("keeps one project's period out of another's", async () => {
    const a = await inTenant(PROJECT_A, ({ periods }) =>
      periods.between("2025-12-01", "2025-12-01"),
    );
    expect(a).toHaveLength(0);
  });
});
