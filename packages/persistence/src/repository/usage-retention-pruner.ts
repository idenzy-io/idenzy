import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** What one pass removed, per tier. */
export interface PrunedUsage {
  readonly hourly: number;
  readonly daily: number;
  readonly periods: number;
}

/** The three cutoffs, computed from the tiers declared in the schema. */
export interface UsageCutoffs {
  /** Hours older than this go. `Retention.Months6`. */
  readonly hourlyBefore: Date;
  /** Days older than this go, as `YYYY-MM-DD`. `Retention.Years2`. */
  readonly dailyBefore: string;
  /** Periods starting before this go, as `YYYY-MM-DD`. `Retention.Years6`. */
  readonly periodsBefore: string;
}

/**
 * Deletes usage past its tier (PROJECT.md 4.13).
 *
 * Not a `BaseRepository`, and it could not be one twice over. A sweeper serves every project and
 * has no tenant to be scoped to. And `usage_periods` holds no DELETE grant for the app role at
 * all, deliberately (`0001`): retention is a system action, and an application path that could
 * remove a closed billing period is exactly what that withholding exists to prevent. The
 * `usage_prune_*` SECURITY DEFINER functions keep both properties at once — the app still cannot,
 * and this still can.
 *
 * Bounded per call and reporting what it removed, so the first pass over a table that has been
 * accumulating is a series of passes rather than one statement holding locks for minutes.
 */
export class UsageRetentionPruner {
  constructor(private readonly db: NodePgDatabase) {}

  async prune(cutoffs: UsageCutoffs, maxRowsPerTier: number): Promise<PrunedUsage> {
    return {
      hourly: await this.call(
        sql`select usage_prune_hourly(${cutoffs.hourlyBefore.toISOString()}::timestamptz, ${maxRowsPerTier}) as removed`,
      ),
      daily: await this.call(
        sql`select usage_prune_daily(${cutoffs.dailyBefore}::date, ${maxRowsPerTier}) as removed`,
      ),
      periods: await this.call(
        sql`select usage_prune_periods(${cutoffs.periodsBefore}::date, ${maxRowsPerTier}) as removed`,
      ),
    };
  }

  private async call(statement: ReturnType<typeof sql>): Promise<number> {
    const rows = await this.db.execute<{ removed: string }>(statement);
    return Number(rows.rows[0]?.removed ?? 0);
  }
}
