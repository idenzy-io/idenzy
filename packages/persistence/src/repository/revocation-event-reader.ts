import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { asRecord } from "./jsonb.js";

export interface RevocationEvent {
  readonly projectId: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

interface Row extends Record<string, unknown> {
  readonly project_id: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly created_at: Date;
}

/**
 * Revocation events across every project, for the reconciler that replays them into the
 * cache (ADR-0009).
 *
 * Not a `BaseRepository`, and it cannot be one: those are tenant-scoped by construction and
 * this reads every tenant. It goes through `revocation_events_since`, a SECURITY DEFINER
 * function scoped to two topics, for the same reason project resolution does: a relay serves
 * every project and has none of its own to be scoped to. The function's two topics are what
 * bound it — with no policy underneath, a plain select here would read the table entire.
 *
 * It reads a window rather than a cursor. Entries in the set expire on their own, so
 * anything older than the retention window is not worth replaying, and a window means there
 * is no watermark to keep, no state to lose, and no interference with the outbox's own
 * `published_at`, which belongs to the relay that will drain this table to Pub/Sub.
 */
export class RevocationEventReader {
  constructor(private readonly db: NodePgDatabase) {}

  async since(since: Date): Promise<readonly RevocationEvent[]> {
    const rows = await this.db.execute<Row>(
      sql`select * from revocation_events_since(${since.toISOString()})`,
    );
    return rows.rows.map((row) => ({
      projectId: row.project_id,
      topic: row.topic,
      payload: asRecord(row.payload),
      createdAt: new Date(row.created_at),
    }));
  }
}
