import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which projects the reputation breaker has to look at, across all of them (risks.md 2).
 *
 * Not a `BaseRepository`, for the reason no cross-tenant reader here is one: the breaker
 * serves every project and binds no `app.project_id`, so a direct read comes back empty under
 * FORCE RLS — no error, no work, and a breaker that reports success while judging nothing.
 * Migration 0057's SECURITY DEFINER function answers project ids and nothing else.
 *
 * It answers projects with recent delivery events **and** projects currently held, which is
 * one question rather than two. A held project has stopped sending, so it stops producing
 * events, so it leaves the first set within a window — and a breaker reading only that set
 * could open a hold it would never see again to release.
 *
 * What the breaker does with each id afterwards is ordinary and scoped under
 * `app.project_id`. This function is the only part that crosses a tenant boundary, and all it
 * can disclose is that a project exists and has sent mail.
 */
export class ProjectEmailActivityReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** Projects with delivery events on or after `since` (as `YYYY-MM-DD`), or an open hold. */
  async toJudge(since: string, limit: number): Promise<readonly string[]> {
    const rows = await this.db.execute<{ project_id: string }>(
      sql`select * from projects_for_email_reputation(${since}::date, ${limit})`,
    );
    return rows.rows.map((row) => row.project_id);
  }
}
