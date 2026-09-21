import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  UsageCutoffs,
  UsageRetentionPruner,
} from "@idenzy/persistence/repository/usage-retention-pruner";

export interface UsageRetentionSweeperOptions {
  readonly intervalMs?: number;
  /** Rows removed per tier per pass. */
  readonly rowsPerPass?: number;
  /** `Retention.Months6` on `usage_hourly`. */
  readonly hourlyMonths?: number;
  /** `Retention.Years2` on `usage_daily`. */
  readonly dailyYears?: number;
  /** `Retention.Years6` on `usage_periods`. */
  readonly periodYears?: number;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_ROWS = 20_000;
const DEFAULT_HOURLY_MONTHS = 6;
const DEFAULT_DAILY_YEARS = 2;
const DEFAULT_PERIOD_YEARS = 6;

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Deletes usage past its tier, which is what makes the three tiers facts (PROJECT.md 4.13).
 *
 * `classified()` declares how long each rollup is kept and generates a data map that says so, and
 * until this existed that was a description rather than a control: nothing removed a row, so every
 * table's real retention was "forever" while the published answer said otherwise. That gap is worse
 * than a shorter tier, because a data map is what a customer is shown.
 *
 * The cutoffs are computed here from the same numbers the schema declares, and the deletion runs
 * through the `usage_prune_*` SECURITY DEFINER functions — both because a sweeper has no tenant
 * to be scoped to, and because `usage_periods` deliberately holds no DELETE grant for the app role.
 * Retention is a system action; an application path that could remove a closed billing period is
 * precisely what that withholding exists to stop.
 *
 * Bounded per pass and hourly, so the first run over a table that has been accumulating is a
 * series of small deletes rather than one that holds locks for minutes.
 */
export class UsageRetentionSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pruner: UsageRetentionPruner,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: UsageRetentionSweeperOptions = {},
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

  /** The three cutoffs as of `now`, from the tiers the schema declares. */
  cutoffs(now: Date): UsageCutoffs {
    const back = (years: number, months: number) =>
      new Date(
        Date.UTC(
          now.getUTCFullYear() - years,
          now.getUTCMonth() - months,
          now.getUTCDate(),
          now.getUTCHours(),
        ),
      );
    return {
      hourlyBefore: back(0, this.options.hourlyMonths ?? DEFAULT_HOURLY_MONTHS),
      dailyBefore: utcDay(back(this.options.dailyYears ?? DEFAULT_DAILY_YEARS, 0)),
      periodsBefore: utcDay(back(this.options.periodYears ?? DEFAULT_PERIOD_YEARS, 0)),
    };
  }

  /** One pass. Answers how many rows it removed across the three tiers. */
  async sweep(): Promise<number> {
    try {
      const removed = await this.pruner.prune(
        this.cutoffs(this.clock.now()),
        this.options.rowsPerPass ?? DEFAULT_ROWS,
      );
      const total = removed.hourly + removed.daily + removed.periods;
      if (total > 0) {
        this.logger.info("usage retention swept", {
          component: "usage",
          outcome: "pruned",
          hourly: removed.hourly,
          daily: removed.daily,
          periods: removed.periods,
        });
      }
      return total;
    } catch (error) {
      // Nothing downstream depends on a pass succeeding: the rows are still there and still past
      // their tier, and the next pass is an hour away.
      this.logger.error("usage retention sweep failed", {
        component: "usage",
        outcome: "deferred",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }
}
