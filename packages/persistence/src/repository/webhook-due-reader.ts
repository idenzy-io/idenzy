import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which projects have a delivery due, across all of them (ADR-0012).
 *
 * Not a `BaseRepository`, and it cannot be one: those are tenant-scoped by construction and the
 * sweeper serving every project has no tenant to be scoped to. So it goes through the SECURITY
 * DEFINER function `webhook_projects_with_due_deliveries`, narrowed to exactly this question —
 * project ids, nothing else — which is the pattern the audit relay's outbox reader already uses.
 *
 * Reaching for `webhook_deliveries` directly is the mistake this class exists to prevent, and it
 * fails silently either way. Under the old row policies the queue read as empty while it filled;
 * with them gone it reads every project's deliveries at once. The function is the only remaining
 * bound on the question.
 */
export class WebhookDueReader {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Projects with work due, the longest-waiting first.
   *
   * Capped, because a sweep is a pass and not a backlog drain: taking the projects that have been
   * waiting longest means a busy tenant cannot starve a quiet one of its turn, and the next pass is
   * a couple of seconds away.
   */
  async projectsWithDueDeliveries(dueBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.db.execute<{ project_id: string }>(
      sql`select * from webhook_projects_with_due_deliveries(${dueBefore.toISOString()}, ${limit})`,
    );
    return rows.rows.map((row) => row.project_id);
  }
}
