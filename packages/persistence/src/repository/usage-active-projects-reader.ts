import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which projects had any usage to roll up, across all of them (PROJECT.md 5.1).
 *
 * Not a `BaseRepository`, for the reason every cross-tenant reader here is not one: a worker sets
 * no `app.project_id`, so a direct read of `usage_daily` comes back empty under FORCE RLS — no
 * error, no work, and an hourly series that is permanently blank. The SECURITY DEFINER function
 * from migration 0050 answers a project id and nothing else.
 */
export class UsageActiveProjectsReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** Projects with a `usage_daily` row on or after `since`, as `YYYY-MM-DD`. */
  async withActivity(since: string, limit: number): Promise<readonly string[]> {
    const rows = await this.db.execute<{ project_id: string }>(
      sql`select * from usage_projects_with_activity(${since}::date, ${limit})`,
    );
    return rows.rows.map((row) => row.project_id);
  }
}
