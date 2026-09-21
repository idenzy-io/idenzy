import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** What one pass removed, per table. */
export interface PrunedEmail {
  readonly stats: number;
  readonly events: number;
}

/** The two cutoffs, computed from the tiers declared in the schema. */
export interface EmailCutoffs {
  /** Delivery-stat days older than this go, as `YYYY-MM-DD`. `Retention.Years2`. */
  readonly statsBefore: string;
  /** Provider events received before this go. `Retention.Days30`. */
  readonly eventsBefore: Date;
}

/**
 * Deletes email delivery data past its tier (PROJECT.md 4.13).
 *
 * It exists because declaring a retention and never removing a row is the bug
 * `docs/guide/backend.md` records against the usage rollups: `classified()` published a term
 * while the real answer was "forever", and a data map is what a customer is shown.
 *
 * Not a `BaseRepository`, twice over. A sweeper serves every project and binds no
 * `app.project_id`, so a tenant-scoped delete matches nothing — no error, no rows, and a table
 * that grows while a job reports success. And neither table grants DELETE to the app role at
 * all (migration 0057), deliberately: removing a counter or an idempotency record is a system
 * action. The SECURITY DEFINER functions keep both properties at once.
 */
export class EmailRetentionPruner {
  constructor(private readonly db: NodePgDatabase) {}

  async prune(cutoffs: EmailCutoffs, maxRowsPerTable: number): Promise<PrunedEmail> {
    return {
      stats: await this.call(
        sql`select email_prune_delivery_stats(${cutoffs.statsBefore}::date, ${maxRowsPerTable}) as removed`,
      ),
      events: await this.call(
        sql`select email_prune_provider_events(${cutoffs.eventsBefore.toISOString()}::timestamptz, ${maxRowsPerTable}) as removed`,
      ),
    };
  }

  private async call(statement: ReturnType<typeof sql>): Promise<number> {
    const rows = await this.db.execute<{ removed: string }>(statement);
    return Number(rows.rows[0]?.removed ?? 0);
  }
}
