import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which projects had any usage to roll up, across all of them (PROJECT.md 5.1).
 *
 * Not a `BaseRepository`, for the reason every cross-tenant reader here is not one: a worker has
 * no tenant to be scoped to, and a `BaseRepository` cannot be constructed without one. The
 * SECURITY DEFINER function `usage_projects_with_activity` answers a project id and nothing else.
 *
 * A direct read of `usage_daily` used to come back empty under the row policies — no error, no
 * work, an hourly series permanently blank. It now comes back with every project's rows, which
 * is the louder failure only if something is looking. The function is what keeps the question
 * narrow enough that nothing has to.
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
