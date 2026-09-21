import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { asRecord } from "./jsonb.js";

export interface OutboxEvent {
  readonly id: string;
  readonly projectId: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  /** The consumer's watermark. Unique and monotonic, which `createdAt` is neither. */
  readonly seq: number;
}

export interface AuditChainTip {
  readonly entryHash: string;
  readonly seq: number;
}

interface OutboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly project_id: string;
  readonly topic: string;
  readonly payload: unknown;
  readonly created_at: Date;
  readonly seq: string;
}

/**
 * The reads and the one write the audit relay needs, across every project.
 *
 * Not a `BaseRepository` and it cannot be one: those are tenant-scoped by construction and
 * a relay has no tenant to be scoped to. Every call here therefore goes through a SECURITY
 * DEFINER function, each narrowed to one job — the pattern `resolve_project_by_host` uses for
 * project resolution and `revocation_events_since` for the revocation reader.
 *
 * Reaching for the tables directly is what the first version of this did, and it failed in the
 * quietest possible way: every insert refused and every read empty, with no error and an audit
 * trail that recorded nothing. The row policy that did that is gone, so the same mistake now
 * reads every project's trail instead. Quiet in the other direction, and worse.
 *
 * None of the three functions can UPDATE or DELETE, so the append-only privilege shape from
 * the append-only grant still holds (PROJECT.md 4.13.3): a bug here can add a wrong entry and
 * still cannot remove or alter a right one.
 */
export class AuditEventReader {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Events of one topic past a watermark, in sequence order. Capped by the function.
   *
   * The watermark is `outbox.seq` and not `created_at`, which is the whole point of
   * migration 0031. A timestamp ties at millisecond precision, so an exclusive bound on
   * one skipped every event that shared the last instant of a sweep, for ever and
   * without an error (PROJECT.md 4.13.3).
   *
   * `notBefore` is only for a consumer that has no watermark yet: it bounds how far back
   * a cold start reads. In steady state it is null and the sequence alone decides.
   */
  async outboxSince(
    topic: string,
    sinceSeq: number,
    notBefore: Date | null = null,
  ): Promise<readonly OutboxEvent[]> {
    const rows = await this.db.execute<OutboxRow>(
      sql`select * from outbox_events_since(
            ${topic}, ${sinceSeq}, ${notBefore === null ? null : notBefore.toISOString()})`,
    );
    return rows.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      topic: row.topic,
      payload: asRecord(row.payload),
      createdAt: new Date(row.created_at),
      // bigint arrives as a string from pg, because it does not fit a JS number in
      // general. It does here: the sequence would need 2^53 events to overflow.
      seq: Number(row.seq),
    }));
  }

  /** Where a consumer with no watermark starts: the newest event already past its lookback. */
  async outboxSeqBefore(topic: string, at: Date): Promise<number> {
    const rows = await this.db.execute<{ outbox_seq_before: string }>(
      sql`select outbox_seq_before(${topic}, ${at.toISOString()})`,
    );
    return Number(rows.rows[0]?.outbox_seq_before ?? 0);
  }

  /**
   * The newest entry for a project, which is what the next one links to.
   *
   * Ordered by `seq` and not by `created_at`. That is the whole reason the column exists:
   * timestamps tie at millisecond precision, and a tie here is two entries claiming the
   * same predecessor.
   */
  async tip(projectId: string): Promise<AuditChainTip | null> {
    const rows = await this.db.execute<{ entry_hash: string; seq: string }>(
      sql`select * from audit_chain_tip(${projectId}::uuid)`,
    );
    const row = rows.rows[0];
    return row === undefined ? null : { entryHash: row.entry_hash, seq: Number(row.seq) };
  }

  /** The whole chain for a project, oldest first, for the verifier. */
  async chain(projectId: string): Promise<readonly AuditChainRow[]> {
    const rows = await this.db.execute<AuditChainSqlRow>(
      sql`select * from audit_chain_for(${projectId}::uuid)`,
    );
    return rows.rows.map((row) => ({
      projectId: row.project_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      target: row.target,
      metadata: asRecord(row.metadata),
      prevHash: row.prev_hash,
      entryHash: row.entry_hash,
      createdAt: new Date(row.created_at),
      seq: Number(row.seq),
    }));
  }

  /**
   * Appends one entry, and answers whether this call was the one that wrote it.
   *
   * False means the outbox event behind it is already in the trail, which is what any
   * cold start produces: it re-reads its lookback window, and that window is the one it
   * has already chained. The caller needs the distinction rather than a void, because on
   * false the hash it computed was never stored and must not be carried forward as the
   * project's tip.
   *
   * The sequence assigns the order; nothing here chooses it.
   */
  async append(entry: NewAuditEntry): Promise<boolean> {
    const rows = await this.db.execute<{ append_audit_event: boolean }>(
      sql`select append_audit_event(
            ${entry.projectId}::uuid, ${entry.actorType}, ${entry.actorId},
            ${entry.action}, ${entry.target}, ${entry.ip}, ${entry.ua},
            ${JSON.stringify(entry.metadata)}::jsonb,
            ${entry.prevHash}, ${entry.entryHash}, ${entry.createdAt.toISOString()}::timestamptz,
            ${entry.outboxSeq})`,
    );
    return rows.rows[0]?.append_audit_event ?? false;
  }
}

export interface NewAuditEntry {
  readonly projectId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly ip: string | null;
  readonly ua: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly entryHash: string;
  /** The outbox row this came from. Null where nothing relayed it, and never deduplicated. */
  readonly outboxSeq: number | null;
  readonly createdAt: Date;
}

export interface AuditChainRow {
  readonly projectId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly entryHash: string;
  readonly createdAt: Date;
  readonly seq: number;
}

interface AuditChainSqlRow extends Record<string, unknown> {
  readonly project_id: string;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly metadata: unknown;
  readonly prev_hash: string;
  readonly entry_hash: string;
  readonly created_at: Date;
  readonly seq: string;
}
