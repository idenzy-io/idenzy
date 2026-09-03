import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Where a background consumer of the outbox has read up to.
 *
 * Its own row per consumer rather than the outbox's `published_at`, which belongs to the
 * relay that will drain this table to Pub/Sub. Two consumers sharing one watermark means
 * whichever runs first decides what the other never sees.
 *
 * A timestamp and not an id, and the bound is exclusive. A restart re-reads whatever
 * shares the last second, which is cheap and idempotent, where a cursor that skipped
 * would lose an entry silently.
 */
export class RelayOffsetRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async read(consumer: string): Promise<Date | null> {
    const rows = await this.db.execute<{ position: Date }>(
      sql`select position from relay_offsets where consumer = ${consumer}`,
    );
    const row = rows.rows[0];
    return row === undefined ? null : new Date(row.position);
  }

  /**
   * Moves the watermark forward, never back.
   *
   * `greatest` rather than an assignment, so a sweep that overlapped an earlier one
   * cannot rewind the consumer and replay work that is already done.
   */
  async advance(consumer: string, position: Date): Promise<void> {
    await this.db.execute(
      sql`insert into relay_offsets (consumer, position, updated_at)
          values (${consumer}, ${position.toISOString()}, now())
          on conflict (consumer) do update
          set position = greatest(relay_offsets.position, excluded.position),
              updated_at = now()`,
    );
  }
}
