import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which projects the reputation breaker has to look at, across all of them (risks.md 2).
 *
 * Not a `BaseRepository`, for the reason no cross-tenant reader here is one: the breaker
 * serves every project, and a `BaseRepository` cannot be constructed without one tenant to be
 * scoped to. `projects_for_email_reputation` answers project ids and nothing else.
 *
 * Reaching for the tables directly is the mistake this class exists to prevent, and what that
 * mistake costs has inverted. Under the old row policies it came back empty — a breaker that
 * reported success while judging nothing. With the policies gone it comes back *full*, and the
 * breaker judges every customer's mail as though it were one project's. The function is now
 * the only thing bounding what a cross-tenant read can see.
 *
 * It answers projects with recent delivery events **and** projects currently held, which is
 * one question rather than two. A held project has stopped sending, so it stops producing
 * events, so it leaves the first set within a window — and a breaker reading only that set
 * could open a hold it would never see again to release.
 *
 * What the breaker does with each id afterwards is ordinary and tenant-scoped. This function
 * is the only part that crosses a tenant boundary, and all it can disclose is that a project
 * exists and has sent mail.
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
