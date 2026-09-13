import type { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import type { Clock } from "@idenzy/core/time/clock";
import type { UsageClosableReader } from "@idenzy/persistence/repository/usage-closable-reader";
import { UsagePeriodRepository } from "@idenzy/persistence/repository/usage-period-repository";
import { type FrozenDay, UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";

export interface UsagePeriodCloserOptions {
  readonly intervalMs?: number;
  /**
   * How long after a month ends before it may be shut.
   *
   * A meter holds active users in memory and flushes on an interval, so a month is not finished
   * the instant the clock rolls over — an instance that was throttled, or a worker that was down
   * over the turn of the month, still has the last of it to write. Six hours is far beyond the
   * minute a flush takes and cheap: nothing downstream reads a closed period sooner, because the
   * panel serves the month in progress from the daily rows.
   */
  readonly graceMs?: number;
  /** Periods shut per pass. A pass is a pass; the next one is minutes away. */
  readonly periodsPerPass?: number;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_GRACE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PERIODS = 100;

/** The first day of the month `at` falls in, `YYYY-MM-DD` in UTC. */
function monthStart(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** The last day of the month beginning at `period`. */
function monthEnd(period: string): string {
  const start = new Date(`${period}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

/**
 * Shuts a month and drops the sketches behind it (PROJECT.md 5.1).
 *
 * It exists because of the one thing a HyperLogLog cannot do: a month's figure is the union of its
 * days, and a union can only be taken from the sketches themselves. So the union has to happen
 * while they are still there, and once it has, they are 16 KiB a day being kept for six years to
 * answer a question that is already answered. This is the pass that takes the answer and lets them
 * go — which is the whole of why `usage_daily` stays small enough to live beside sign-in.
 *
 * A worker rather than a request path, and a worker rather than a database job, for the same
 * reason the audit relay is: the union is our code, in our sketch format, and Postgres has no
 * operator for it.
 *
 * Everything a period needs is done in one transaction per project-month — the figure written and
 * the sketches dropped together — because the two halves in either order on their own are a bug:
 * drop first and the figure can never be produced again, write first and a crash leaves 16 KiB a
 * day nothing will ever collect. Running it twice is safe by construction: `close` is an insert
 * that does nothing on conflict and says so, so a second pass over a shut month cannot re-close it
 * against sketches that are already gone and record a zero.
 */
export class UsagePeriodCloser {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly closable: UsageClosableReader,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: UsagePeriodCloserOptions = {},
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

  /** One pass. Answers how many periods it shut. */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    // The boundary is the month containing "now minus the grace", so a month is only eligible
    // once the grace has elapsed since it ended rather than since it began.
    const boundary = monthStart(
      new Date(now.getTime() - (this.options.graceMs ?? DEFAULT_GRACE_MS)),
    );
    const periods = await this.closable.closable(
      boundary,
      this.options.periodsPerPass ?? DEFAULT_PERIODS,
    );

    let shut = 0;
    for (const period of periods) {
      if (await this.closeOne(period.projectId, period.period, now)) shut += 1;
    }
    return shut;
  }

  private async closeOne(projectId: string, period: string, now: Date): Promise<boolean> {
    const tenant = new TenantContext(projectId, "usage-close", "system");
    try {
      return await this.uow.run(tenant, async (tx) => {
        const usage = new UsageRepository(tx, tenant);
        const days = await usage.dailyBetween(period, monthEnd(period));
        if (days.length === 0) return false;

        const running = HyperLogLog.empty();
        const frozen: FrozenDay[] = days.map((day) => {
          running.mergeFrom(day.activeUsers);
          return {
            day: day.day,
            mau: day.mau ?? day.activeUsers.count,
            mauToDate: running.count,
          };
        });

        const totals = await usage.totalsBetween(period, monthEnd(period));
        const { closed } = await new UsagePeriodRepository(tx, tenant).close(
          { period, activeUsers: running.count, ...totals },
          now,
        );
        // Only the call that actually closed the period touches the days. A pass that lost the
        // race has a running total built from sketches somebody else has already dropped, and
        // freezing from it would overwrite correct levels with zeroes.
        if (closed) await usage.freezeDays(frozen);
        return closed;
      });
    } catch (error) {
      // One project's month failing must not stop the rest of the pass: the row is still there
      // and still closable, and the next sweep is minutes away.
      this.logger.error("usage period close failed", {
        projectId,
        component: "usage",
        outcome: "deferred",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }
}
