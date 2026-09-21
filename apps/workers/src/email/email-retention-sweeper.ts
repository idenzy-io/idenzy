import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  EmailCutoffs,
  EmailRetentionPruner,
} from "@idenzy/persistence/repository/email-retention-pruner";

export interface EmailRetentionSweeperOptions {
  readonly intervalMs?: number;
  /** Rows removed per table per pass. */
  readonly rowsPerPass?: number;
  /** `Retention.Years2` on `email_delivery_stats`. */
  readonly statsYears?: number;
  /** `Retention.Days30` on `email_provider_events`. */
  readonly eventDays?: number;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_ROWS = 20_000;
const DEFAULT_STATS_YEARS = 2;
const DEFAULT_EVENT_DAYS = 30;

/**
 * Deletes email delivery data past its tier, which is what makes the tiers facts.
 *
 * It ships with the tables rather than after them, deliberately. The usage rollups declared a
 * retention for months while nothing removed a row, so the real answer was "forever" and the
 * published one was not — and a data map is what a customer is shown (PROJECT.md 4.13.6). A new
 * table with a declared term and no sweeper repeats that exactly.
 *
 * Both deletions run through the `email_prune_*` SECURITY DEFINER functions, both because a
 * sweeper has no tenant to be scoped to and because neither table grants DELETE to the app role.
 */
export class EmailRetentionSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pruner: EmailRetentionPruner,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: EmailRetentionSweeperOptions = {},
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

  /** The two cutoffs as of `now`, from the tiers the schema declares. */
  cutoffs(now: Date): EmailCutoffs {
    const statsBefore = new Date(
      Date.UTC(
        now.getUTCFullYear() - (this.options.statsYears ?? DEFAULT_STATS_YEARS),
        now.getUTCMonth(),
        now.getUTCDate(),
      ),
    );
    const eventDays = this.options.eventDays ?? DEFAULT_EVENT_DAYS;
    return {
      statsBefore: statsBefore.toISOString().slice(0, 10),
      eventsBefore: new Date(now.getTime() - eventDays * 24 * 60 * 60 * 1000),
    };
  }

  /** One pass. Answers how many rows it removed across both tables. */
  async sweep(): Promise<number> {
    try {
      const removed = await this.pruner.prune(
        this.cutoffs(this.clock.now()),
        this.options.rowsPerPass ?? DEFAULT_ROWS,
      );
      const total = removed.stats + removed.events;
      if (total > 0) {
        this.logger.info("email retention swept", {
          component: "email-events",
          outcome: "pruned",
          stats: removed.stats,
          events: removed.events,
        });
      }
      return total;
    } catch (error) {
      // Nothing downstream depends on a pass succeeding: the rows are still there and still past
      // their tier, and the next pass is an hour away.
      this.logger.error("email retention sweep failed", {
        component: "email-events",
        outcome: "deferred",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }
}
