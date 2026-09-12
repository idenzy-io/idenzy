import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Where a background consumer of the outbox has read up to.
 *
 * Its own row per consumer rather than the outbox's `published_at`, which belongs to the
 * relay that will drain this table to Pub/Sub. Two consumers sharing one watermark means
 * whichever runs first decides what the other never sees.
 *
 * The position is `outbox.seq` and the bound is exclusive, which is only safe because
 * that sequence is unique. It used to be `created_at`, and an exclusive bound on a value
 * that ties at millisecond precision skips every event sharing the last instant of a
 * sweep — permanently, with no error and no symptom but an audit entry that does not
 * exist. Migration 0031 has the measurements; 0032 moved the watermark.
 */
export class RelayOffsetRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /** Null where the consumer has never run, which is what a cold start is. */
  async read(consumer: string): Promise<number | null> {
    const rows = await this.db.execute<{ position_seq: string }>(
      sql`select position_seq from relay_offsets where consumer = ${consumer}`,
    );
    const row = rows.rows[0];
    return row === undefined ? null : Number(row.position_seq);
  }

  /**
   * Moves the watermark forward, never back.
   *
   * `greatest` rather than an assignment, so a sweep that overlapped an earlier one
   * cannot rewind the consumer and replay work that is already done.
   */
  async advance(consumer: string, position: number): Promise<void> {
    await this.db.execute(
      sql`insert into relay_offsets (consumer, position_seq, updated_at)
          values (${consumer}, ${position}, now())
          on conflict (consumer) do update
          set position_seq = greatest(relay_offsets.position_seq, excluded.position_seq),
              updated_at = now()`,
    );
  }
}
