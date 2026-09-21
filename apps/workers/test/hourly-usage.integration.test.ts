import { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { Clock } from "@idenzy/core/time/clock";
import { UsageActiveProjectsReader } from "@idenzy/persistence/repository/usage-active-projects-reader";
import { UsageHourlyRepository } from "@idenzy/persistence/repository/usage-hourly-repository";
import { UsagePeriodRepository } from "@idenzy/persistence/repository/usage-period-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { UsageRetentionPruner } from "@idenzy/persistence/repository/usage-retention-pruner";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HourlyUsageRoller } from "../src/hourly-usage-roller.js";
import { UsageRetentionSweeper } from "../src/usage-retention-sweeper.js";

/**
 * The hourly rollup and the retention pass, against a real Postgres.
 *
 * Two things here are only observable with the database in place. The roller's counters are the
 * day's cumulative totals less what earlier hours already carry, so it is arithmetic across rows
 * that a fake would simply hand back. And the pruner deletes through SECURITY DEFINER functions
 * precisely because the app role cannot — `usage_periods` holds no DELETE grant — which is a
 * privilege question and not a code one.
 */

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";

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

/** Ten past eleven, so the hour that has just completed is 10:00. */
const clock = new FixedClock(new Date("2026-03-04T11:10:00Z"));

interface Repos {
  readonly usage: UsageRepository;
  readonly hourly: UsageHourlyRepository;
  readonly periods: UsagePeriodRepository;
}

function inTenant<T>(work: (repos: Repos) => Promise<T>): Promise<T> {
  const tenant = new TenantContext(PROJECT, "req_test", "system");
  return uow.run(tenant, (tx) =>
    work({
      usage: new UsageRepository(tx, tenant),
      hourly: new UsageHourlyRepository(tx, tenant),
      periods: new UsagePeriodRepository(tx, tenant),
    }),
  );
}

function sketchOf(count: number): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (let n = 0; n < count; n += 1) sketch.add(`usr_${String(n).padStart(32, "0")}`);
  return sketch;
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
     VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("rolling an hour up", () => {
  const roller = (): HourlyUsageRoller =>
    new HourlyUsageRoller(
      new UsageActiveProjectsReader(harness.db),
      uow,
      clock,
      new SilentLogger(),
    );

  it("writes the level it observed and the whole day's counters as the first hour's", async () => {
    const at = new Date("2026-03-04T09:30:00Z");
    await inTenant(({ usage }) => usage.mergeActiveUsers(at, sketchOf(120)));
    await inTenant(({ usage }) => usage.recordEmailSent(at, 40));

    expect(await roller().sweep()).toBe(1);

    const hours = await inTenant(({ hourly }) =>
      hourly.between(new Date("2026-03-04T00:00:00Z"), new Date("2026-03-04T23:00:00Z")),
    );
    expect(hours).toHaveLength(1);
    expect(hours[0]?.hour.toISOString()).toBe("2026-03-04T10:00:00.000Z");
    expect(hours[0]?.mauToDate).toBe(sketchOf(120).count);
    expect(hours[0]?.emailsSent).toBe(40);
  });

  /* The arithmetic that needs the database: the day's total keeps climbing, so an hour is what the
     day has that the hours before it do not. */
  it("gives the next hour only what the day gained since the last one", async () => {
    await inTenant(({ usage }) => usage.recordEmailSent(new Date("2026-03-04T11:20:00Z"), 15));
    clock.moveTo(new Date("2026-03-04T12:02:00Z"));

    expect(await roller().sweep()).toBe(1);

    const hours = await inTenant(({ hourly }) =>
      hourly.between(new Date("2026-03-04T00:00:00Z"), new Date("2026-03-04T23:00:00Z")),
    );
    expect(hours.map((entry) => entry.emailsSent)).toEqual([40, 15]);
    // Summing the hours gives the day back, which is the property that makes the two agree.
    expect(hours.reduce((total, entry) => total + entry.emailsSent, 0)).toBe(55);
  });

  it("writes an hour once, because its figures are only true when they are taken", async () => {
    await inTenant(({ usage }) => usage.recordEmailSent(new Date("2026-03-04T12:30:00Z"), 99));
    expect(await roller().sweep()).toBe(0);

    const hours = await inTenant(({ hourly }) =>
      hourly.between(new Date("2026-03-04T11:00:00Z"), new Date("2026-03-04T11:00:00Z")),
    );
    expect(hours[0]?.emailsSent).toBe(15);
  });

  it("never visits a project with nothing metered", async () => {
    const projects = await new UsageActiveProjectsReader(harness.db).withActivity("2030-01-01", 50);
    expect(projects).toEqual([]);
  });
});

describe("the retention pass", () => {
  const sweeper = (): UsageRetentionSweeper =>
    new UsageRetentionSweeper(new UsageRetentionPruner(harness.db), clock, new SilentLogger());

  it("computes a cutoff per tier from the clock", () => {
    const cutoffs = sweeper().cutoffs(new Date("2026-03-04T12:00:00Z"));
    expect(cutoffs.hourlyBefore.toISOString()).toBe("2025-09-04T12:00:00.000Z");
    expect(cutoffs.dailyBefore).toBe("2024-03-04");
    expect(cutoffs.periodsBefore).toBe("2020-03-04");
  });

  it("removes what is past its tier and leaves what is not", async () => {
    await inTenant(({ usage }) =>
      usage.mergeActiveUsers(new Date("2023-01-10T09:00:00Z"), sketchOf(10)),
    );
    await inTenant(({ hourly }) =>
      hourly.record({
        hour: new Date("2024-01-10T09:00:00Z"),
        mauToDate: 5,
        emailsSent: 1,
        smsSent: 0,
        smsVerified: 0,
        smsCost: "0",
      }),
    );

    const removed = await sweeper().sweep();
    expect(removed).toBe(2);

    expect(
      await inTenant(({ usage }) => usage.dailyBetween("2023-01-01", "2023-01-31")),
    ).toHaveLength(0);
    expect(
      await inTenant(({ hourly }) =>
        hourly.between(new Date("2024-01-10T00:00:00Z"), new Date("2024-01-10T23:00:00Z")),
      ),
    ).toHaveLength(0);
    // This month's rows are well inside every tier and are untouched.
    expect(
      await inTenant(({ usage }) => usage.dailyBetween("2026-03-01", "2026-03-31")),
    ).toHaveLength(1);
  });

  /**
   * The privilege question, which is the whole reason the deletion goes through a SECURITY DEFINER
   * function: `usage_periods` withholds DELETE from the app role on purpose (0046), so a retention
   * pass that ran as the application could not enforce the tier it declares.
   */
  it("removes a closed period the app role is not allowed to delete", async () => {
    await inTenant(({ periods }) =>
      periods.close(
        {
          period: "2019-01-01",
          activeUsers: 1,
          emailsSent: 0,
          smsSent: 0,
          smsVerified: 0,
          smsCost: "0",
        },
        new Date("2019-02-01T00:00:00Z"),
      ),
    );
    expect(
      await inTenant(({ periods }) => periods.between("2019-01-01", "2019-01-01")),
    ).toHaveLength(1);

    await harness.pool.query("SET ROLE idenzy_app");
    await expect(
      harness.pool.query("DELETE FROM usage_periods WHERE period = '2019-01-01'"),
    ).rejects.toThrow(/permission denied/i);

    expect(await sweeper().sweep()).toBe(1);
    expect(
      await inTenant(({ periods }) => periods.between("2019-01-01", "2019-01-01")),
    ).toHaveLength(0);
  });
});
