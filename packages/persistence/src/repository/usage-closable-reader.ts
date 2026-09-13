import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** One project's month that has ended and has not been shut. */
export interface ClosablePeriod {
  readonly projectId: string;
  /** The first day of the calendar month, `YYYY-MM-DD`. */
  readonly period: string;
}

/**
 * Which project-months are ready to be closed, across all of them (PROJECT.md 5.1).
 *
 * Not a `BaseRepository`, and it cannot be one: those are tenant-scoped by construction and a
 * closer serving every project has no `app.project_id` to be scoped to. So it goes through the
 * SECURITY DEFINER function from migration 0047, narrowed to exactly this question — a project id
 * and a month — which is the pattern `WebhookDueReader` and the audit relay already use.
 *
 * Reading `usage_daily` directly is the mistake this class exists to prevent, and it fails
 * silently: FORCE RLS keyed on a variable a worker does not set means every row is invisible, so
 * there is never anything to close while the sketches pile up behind it.
 */
export class UsageClosableReader {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Months that ended before `beforePeriod`, oldest first.
   *
   * The caller passes the boundary rather than "last month", because how long to wait after a
   * month ends is a judgement about in-flight meters and belongs with the thing that knows the
   * flush interval.
   */
  async closable(beforePeriod: string, limit: number): Promise<readonly ClosablePeriod[]> {
    const rows = await this.db.execute<{ project_id: string; period: string }>(
      sql`select * from usage_closable_periods(${beforePeriod}::date, ${limit})`,
    );
    return rows.rows.map((row) => ({ projectId: row.project_id, period: row.period }));
  }
}
