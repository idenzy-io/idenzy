import type { Logger } from "@idenzy/core/logging/logger";
import type { AuditPartitionMaintainer } from "@idenzy/persistence/repository/audit-partition-maintainer";

export interface AuditPartitionKeeperOptions {
  readonly intervalMs?: number;
  /** How many months beyond the current one to keep ready. */
  readonly monthsAhead?: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps `audit_events` partitioned ahead of the clock (PROJECT.md 4.13.3).
 *
 * Migration 0001 created the current month and the next two and nothing has called
 * `ensure_audit_partition` since, so roughly three months after any deploy every audit insert
 * would fail with "no partition of relation found for row". This is the job that stops that.
 *
 * **It is not a sweeper, and its failures are not like theirs.** A missed retention pass leaves
 * rows that are still there and still past their age, and the next hour fixes it. A missed pass
 * here eventually means the append-only trail stops accepting writes — the integrity control
 * going dark rather than falling behind. So a failure logs at error, and the horizon is three
 * months rather than one: the job is meant to run so far ahead that several consecutive failures
 * are still survivable, and a pass that actually creates something is itself worth seeing.
 *
 * Daily, because the unit of work is a month. Once at boot too, so a fresh cell or a long
 * outage repairs itself without waiting a day for the first tick.
 */
export class AuditPartitionKeeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly maintainer: AuditPartitionMaintainer,
    private readonly logger: Logger,
    private readonly options: AuditPartitionKeeperOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.ensure();
    this.timer = setInterval(() => {
      void this.ensure();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Answers how many partitions it had to create; zero is the healthy answer. */
  async ensure(): Promise<number> {
    const monthsAhead = this.options.monthsAhead ?? 3;
    try {
      const created = await this.maintainer.ensureAhead(monthsAhead);
      if (created > 0) {
        // Only interesting when it happens. In the steady state the horizon is already met
        // and this job is silent, which is what makes a line here worth reading.
        this.logger.info("audit partitions created", {
          component: "audit-partitions",
          outcome: "created",
          created,
          monthsAhead,
        });
      }
      return created;
    } catch (error) {
      // Error and not warn: audit inserts stop when the horizon is passed, and nothing else
      // in the system reports that until a sign-in fails.
      this.logger.error("audit partition maintenance failed", {
        component: "audit-partitions",
        outcome: "failed",
        monthsAhead,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }
}
