import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which organisations have had usage worth charging for, across all of them (ADR-0014).
 *
 * Not an `OrgRepository`, for the reason every cross-tenant reader here is not one: the
 * drawdown serves every organisation and binds no `app.org_id`, so a direct read comes back
 * empty under FORCE RLS — no error, no work, and nothing ever charged. Migration 0055's
 * SECURITY DEFINER function answers organisation ids and nothing else.
 *
 * What the job does with each id is ordinary and scoped: the organisation's projects under
 * `app.org_id`, then each project's own days under `app.project_id`. This function is the
 * only part that crosses a tenant boundary, and all it can disclose is that an organisation
 * exists and has been used.
 */
export class OrgUsageActivityReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** Organisations with a `usage_daily` row on or after `since`, as `YYYY-MM-DD`. */
  async withActivity(since: string, limit: number): Promise<readonly string[]> {
    const rows = await this.db.execute<{ org_id: string }>(
      sql`select * from orgs_with_recent_usage(${since}::date, ${limit})`,
    );
    return rows.rows.map((row) => row.org_id);
  }
}
