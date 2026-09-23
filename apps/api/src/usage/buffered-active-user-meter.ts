import { randomUUID } from "node:crypto";
import { LiveUsageSketches } from "@idenzy/cache/live-usage-sketches";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { Clock } from "@idenzy/core/time/clock";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

/** `YYYY-MM-DD` in UTC, which is what the `day` column stores. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The first day of the month before `period`. */
function previousMonth(period: string): string {
  const start = new Date(`${period}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10);
}

/** The month a day falls in, as the first day's `YYYY-MM-DD`: the period the ledger prices. */
function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** One project's month, as this instance has seen it, for the live balance. */
interface MonthView {
  readonly projectId: string;
  readonly period: string;
  readonly sketch: HyperLogLog;
  /** Whether anything has been added since the last publish that succeeded. */
  dirty: boolean;
}

/**
 * Five seconds: the cadence the live balance is computed at. A publish is one hash field
 * overwritten in Valkey, only for a month that gained somebody, and nothing in Postgres.
 */
const LIVE_PUBLISH_MS = 5_000;

/** One project's day, as this instance has seen it so far. */
interface DayBuffer {
  readonly projectId: string;
  readonly day: string;
  readonly sketch: HyperLogLog;
  /** Whether anything has been added since the last write that succeeded. */
  dirty: boolean;
  /** The earliest an add may flush again. Zero on a new buffer, so the first one goes now. */
  dueAt: number;
}

/**
 * Counts active users in memory and writes the sketch down on an interval (PROJECT.md 5.1).
 *
 * A meter that wrote per authentication would put the busiest row in the system on the sign-in
 * path: unioning a sketch is a read-modify-write under the row's lock, so every refresh for a
 * project would queue behind the one before it, and a million-MAU project would leave a
 * 16 KiB dead tuple behind for each. That is the same trade ADR-0012 refused for logging every
 * webhook delivery — billing must not share IOPS with authentication — and the answer is the
 * same: hold the working set, write a summary.
 *
 * What makes that safe rather than merely cheap is that a union is a per-register maximum, so
 * every part of this is idempotent. A flush writes the instance's whole view of the day, not a
 * delta, so a failed one needs no bookkeeping to retry, a replayed one changes nothing, and ten
 * instances flushing the same project converge instead of racing.
 *
 * What it costs is a bounded undercount: an instance killed between flushes loses whoever
 * authenticated in that window and never came back. That direction is chosen, not accepted —
 * the alternative is a meter that can overcharge, and the sketch is sixteen kilobytes whether
 * it holds ten people or a million, so the window is the only thing there is to tune.
 *
 * Flushing is driven by the requests themselves and by a timer both. The timer alone would be
 * unreliable on a platform that throttles CPU between requests; requests alone would leave the
 * last few of a quiet project sitting in memory until the process ends.
 */
@Injectable()
export class BufferedActiveUserMeter
  extends ActiveUserMeter
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly buffers = new Map<string, DayBuffer>();
  private readonly months = new Map<string, MonthView>();
  private readonly intervalMs: number;
  /** This process's field in each live hash. A restart starts a fresh one; the old one expires. */
  private readonly instanceId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;

  constructor(
    clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly logger: Logger,
    config: AppConfig,
    /**
     * Told after each live publish, so the organisation's live balance is recomputed within a
     * tick (ADR-0017). A hint and never a record: it cannot fail anything, and a lost one only
     * waits for the next publish or the drawdown's own pass.
     */
    private readonly signals: BillingSignals,
    /** Where this instance's view of each month goes every five seconds. */
    private readonly live: LiveUsageSketches,
  ) {
    super(clock);
    this.intervalMs = config.get("USAGE_FLUSH_INTERVAL_SECONDS") * 1000;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.intervalMs);
    // Nothing here should hold the process open: a worker with an empty buffer has no reason
    // to keep a service alive past the last request.
    this.timer.unref();
    this.liveTimer = setInterval(() => {
      void this.publishLive();
    }, LIVE_PUBLISH_MS);
    this.liveTimer.unref();
  }

  /** The last flush, and the only one that is not optional: after this the buffer is gone. */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.liveTimer !== null) clearInterval(this.liveTimer);
    for (const buffer of this.buffers.values()) {
      if (buffer.dirty) await this.flush(buffer);
    }
  }

  protected override async record(projectId: string, userId: string, at: Date): Promise<void> {
    const day = utcDay(at);
    const key = `${projectId}:${day}`;
    let buffer = this.buffers.get(key);
    if (buffer === undefined) {
      buffer = { projectId, day, sketch: HyperLogLog.empty(), dirty: false, dueAt: 0 };
      this.buffers.set(key, buffer);
    }
    // Already counted here today, so there is nothing new to write down. This is what keeps the
    // write rate proportional to people rather than to requests: a user refreshing every five
    // minutes for a day reaches the database once.
    if (!buffer.sketch.add(userId)) return;
    buffer.dirty = true;
    this.monthOf(projectId, day, userId);
    if (at.getTime() >= buffer.dueAt) await this.flush(buffer);
  }

  /**
   * Writes what this instance has seen of a day, and never rethrows.
   *
   * A meter that could fail a sign-in would be a billing outage escalated into an
   * authentication outage. The sketch is kept either way, so the next flush carries whatever
   * this one could not.
   */
  private async flush(buffer: DayBuffer): Promise<void> {
    buffer.dueAt = this.clock.now().getTime() + this.intervalMs;
    const tenant = new TenantContext(buffer.projectId, "usage", "system");
    try {
      await this.uow.transaction((tx) =>
        new UsageRepository(tx, tenant).mergeActiveUsers(
          new Date(`${buffer.day}T00:00:00.000Z`),
          buffer.sketch,
        ),
      );
      buffer.dirty = false;
    } catch (error) {
      this.logger.error("active user flush failed", {
        projectId: buffer.projectId,
        component: "usage",
        outcome: "deferred",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  /** Adds somebody to this instance's view of the month, and marks it for the next publish. */
  private monthOf(projectId: string, day: string, userId: string): void {
    const period = monthOf(day);
    const key = `${projectId}:${period}`;
    let month = this.months.get(key);
    if (month === undefined) {
      month = { projectId, period, sketch: HyperLogLog.empty(), dirty: false };
      this.months.set(key, month);
    }
    if (month.sketch.add(userId)) month.dirty = true;
  }

  /**
   * Publishes every month that gained somebody since the last publish, and never rethrows.
   *
   * Valkey is a hint here: a publish that fails keeps the month dirty for the next one, and the
   * ledger prices Postgres whatever happened. Months before the previous one are let go, because
   * nothing prices them live any more.
   */
  async publishLive(): Promise<void> {
    const oldest = previousMonth(monthOf(utcDay(this.clock.now())));
    for (const [key, month] of [...this.months]) {
      if (month.period < oldest) {
        this.months.delete(key);
        continue;
      }
      if (!month.dirty) continue;
      month.dirty = false;
      try {
        await this.live.publish(month.projectId, month.period, this.instanceId, month.sketch);
      } catch (error) {
        month.dirty = true;
        this.logger.warn("live usage not published", {
          projectId: month.projectId,
          component: "usage",
          outcome: "deferred",
          errorCode: error instanceof Error ? error.name : "unknown",
        });
        continue;
      }
      await this.signals.usageMoved(month.projectId);
    }
  }

  /** The backstop, and where a day that is over is written one last time and let go. */
  private async sweep(): Promise<void> {
    const today = utcDay(this.clock.now());
    for (const [key, buffer] of [...this.buffers]) {
      if (buffer.dirty) await this.flush(buffer);
      if (buffer.day !== today && !buffer.dirty) this.buffers.delete(key);
    }
  }
}
