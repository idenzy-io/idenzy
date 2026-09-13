import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { Clock } from "@idenzy/core/time/clock";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
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
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly logger: Logger,
    config: AppConfig,
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
  }

  /** The last flush, and the only one that is not optional: after this the buffer is gone. */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
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
      await this.uow.run(tenant, (tx) =>
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

  /** The backstop, and where a day that is over is written one last time and let go. */
  private async sweep(): Promise<void> {
    const today = utcDay(this.clock.now());
    for (const [key, buffer] of [...this.buffers]) {
      if (buffer.dirty) await this.flush(buffer);
      if (buffer.day !== today && !buffer.dirty) this.buffers.delete(key);
    }
  }
}
