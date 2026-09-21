import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Keeps `audit_events` partitioned far enough ahead to accept the next insert (4.13.3).
 *
 * Not a `BaseRepository`, for the same reason `RetentionPruner` is not one: this serves the
 * cluster rather than a tenant, sets no `app.project_id`, and creates DDL rather than reading
 * rows. It is also the one maintenance job whose failure is not merely deferred work — a month
 * with no partition rejects every audit insert, and an authentication request that cannot write
 * its audit row is the exact event the trail exists to hold.
 *
 * The SQL side is `ensure_audit_partitions_ahead` from 0059, a SECURITY DEFINER wrapper: the app
 * role owns nothing and holds only USAGE on the schema, so it cannot create a partition itself,
 * and granting it CREATE to make this work would hand every connection the right to make tables.
 */
export class AuditPartitionMaintainer {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Ensures the current month and `months` after it exist. Answers how many it had to create.
   *
   * Zero is the healthy steady state and worth logging nothing about. A non-zero answer on any
   * pass but the first means the horizon is close to being caught, which is the signal that
   * matters: the job is meant to run far enough ahead that it never actually has work to do.
   */
  async ensureAhead(months: number): Promise<number> {
    const rows = await this.db.execute<{ created: string }>(
      sql`select ensure_audit_partitions_ahead(${months}) as created`,
    );
    return Number(rows.rows[0]?.created ?? 0);
  }
}
