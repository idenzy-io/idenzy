import type { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import type { Clock } from "@idenzy/core/time/clock";
import type { UsageActiveProjectsReader } from "@idenzy/persistence/repository/usage-active-projects-reader";
import { UsageHourlyRepository } from "@idenzy/persistence/repository/usage-hourly-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";

export interface HourlyUsageRollerOptions {
  /**
   * How often a pass runs.
   *
   * Well under an hour, because an hour is written the first time a pass sees it complete and the
   * lag between those two instants is the only error in its counters — the day's cumulative figures
   * keep moving, so whatever the next hour accrued before the pass ran is attributed to the one
   * that ended. Five minutes bounds that at five minutes of traffic on a chart.
   */
  readonly intervalMs?: number;
  /** Projects looked at per pass. */
  readonly projectsPerPass?: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_PROJECTS = 500;
const HOUR_MS = 60 * 60 * 1000;

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function monthStart(at: Date): string {
  return `${at.toISOString().slice(0, 7)}-01`;
}

/**
 * Writes one row per project per completed hour (PROJECT.md 5.1).
 *
 * The hourly view exists because a customer watching a launch wants today by the hour, and the
 * rollup a bill is raised from is daily. What makes it affordable is what it does *not* store: an
 * hourly HyperLogLog would be 16 KiB an hour, so an hour keeps the month-to-date level as an
 * integer instead, unioned here from the day's sketches while they are still there.
 *
 * **An hour is observed, not reconstructed.** The level is what it was when the pass ran, and the
 * counters are the day's cumulative figures less whatever earlier hours of the same day already
 * carry. Neither can be recomputed later — the daily row keeps moving — which is why an hour is
 * written once and never revised, and why a worker that was down leaves a gap rather than a
 * fabricated curve. The traffic from that gap is not lost: it lands in the first hour recorded
 * after it, because the arithmetic is against the day's total rather than against a window.
 *
 * A project with no usage at all has no `usage_daily` row and so is never visited, which is what
 * stops this writing a row of zeroes every hour for the life of every dormant account.
 */
export class HourlyUsageRoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly active: UsageActiveProjectsReader,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: HourlyUsageRollerOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Answers how many hours it wrote. */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    const hour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - HOUR_MS);
    // Yesterday as well as today, so an hour of the previous day that ended moments ago is still
    // found after midnight.
    const since = utcDay(new Date(hour.getTime() - 24 * HOUR_MS));
    const projects = await this.active.withActivity(
      since,
      this.options.projectsPerPass ?? DEFAULT_PROJECTS,
    );

    let written = 0;
    for (const projectId of projects) {
      if (await this.rollOne(projectId, hour)) written += 1;
    }
    return written;
  }

  private async rollOne(projectId: string, hour: Date): Promise<boolean> {
    const tenant = new TenantContext(projectId, "usage-hourly", "system");
    try {
      return await this.uow.run(tenant, async (tx) => {
        const hourly = new UsageHourlyRepository(tx, tenant);
        if ((await hourly.at(hour)) !== null) return false;

        const usage = new UsageRepository(tx, tenant);
        const day = utcDay(hour);
        const month = await usage.dailyBetween(monthStart(hour), day);
        if (month.length === 0) return false;

        // The level: the union of the month's sketches as they stand. A closed month has none left,
        // but a closed month has no hours to roll either — this only ever runs on the open one.
        const running = HyperLogLog.empty();
        for (const row of month) running.mergeFrom(row.activeUsers);
        const today = month.at(-1);
        const mauToDate = today?.mauToDate ?? running.count;

        // The counters: the day's totals less what earlier hours of the same day already carry.
        const earlier = await hourly.since(new Date(`${day}T00:00:00.000Z`));
        const attributed = earlier.reduce(
          (totals, row) => ({
            emails: totals.emails + row.emailsSent,
            sms: totals.sms + row.smsSent,
            verified: totals.verified + row.smsVerified,
            cost: totals.cost + Number(row.smsCost),
          }),
          { emails: 0, sms: 0, verified: 0, cost: 0 },
        );
        const cumulative = today?.day === day ? today : null;

        await hourly.record({
          hour,
          mauToDate,
          emailsSent: Math.max(0, (cumulative?.emailsSent ?? 0) - attributed.emails),
          smsSent: Math.max(0, (cumulative?.smsSent ?? 0) - attributed.sms),
          smsVerified: Math.max(0, (cumulative?.smsVerified ?? 0) - attributed.verified),
          // Not floored at zero: a provider that came in under its quote settles a negative
          // difference, and an hour that swallowed it would leave the day's total disagreeing
          // with the sum of its hours.
          smsCost: (Number(cumulative?.smsCost ?? 0) - attributed.cost).toFixed(6),
        });
        return true;
      });
    } catch (error) {
      // One project failing must not stop the pass. The hour is simply never written, which is the
      // same outcome as a worker that was down for it, and the chart shows a gap rather than a lie.
      this.logger.error("hourly usage roll-up failed", {
        projectId,
        component: "usage",
        outcome: "skipped",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }
}
