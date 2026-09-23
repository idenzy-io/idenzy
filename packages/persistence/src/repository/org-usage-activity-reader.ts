import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Which organisations have had usage worth charging for, across all of them (ADR-0014).
 *
 * Not an `OrgRepository`, for the reason every cross-tenant reader here is not one: the
 * drawdown serves every organisation, and an `OrgRepository` cannot be constructed without one
 * to be scoped to. `orgs_with_recent_usage` answers organisation ids and nothing else.
 *
 * A direct read used to come back empty under the row policies — no error, no work, nothing
 * ever charged. It now comes back with every organisation's rows, and a drawdown that reads
 * them all is a billing error against real money rather than a silent no-op.
 *
 * What the job does with each id is ordinary and scoped: the organisation's projects under an
 * `OrgContext`, then each project's own days under a `TenantContext`. This function is the only
 * part that crosses a tenant boundary, and all it can disclose is that an organisation exists
 * and has been used.
 */
export class OrgUsageActivityReader {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * One page of organisations with a `usage_daily` row on or after `since` (`YYYY-MM-DD`), in id
   * order, starting after `after`. A caller walks pages until one comes back short: a caller that
   * read only the first page is how the 201st organisation was never charged.
   */
  async withActivity(
    since: string,
    limit: number,
    after: string | null = null,
  ): Promise<readonly string[]> {
    const rows = await this.db.execute<{ org_id: string }>(
      sql`select * from orgs_with_recent_usage(${since}::date, ${after}::uuid, ${limit})`,
    );
    return rows.rows.map((row) => row.org_id);
  }
}
