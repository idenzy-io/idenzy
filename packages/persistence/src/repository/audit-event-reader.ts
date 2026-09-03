import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { asRecord } from "./jsonb.js";

export interface OutboxEvent {
  readonly id: string;
  readonly projectId: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
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
}

/**
 * The reads and the one write the audit relay needs, across every project.
 *
 * Not a `BaseRepository` and it cannot be one: those are tenant-scoped by construction and
 * a relay has no `app.project_id` to be scoped to. Every call here therefore goes through a
 * SECURITY DEFINER function, each narrowed to one job, which is the pattern migration 0002
 * used for project resolution and 0015 for the revocation reader.
 *
 * Reaching for the tables directly is what the first version of this did, and it failed in
 * the quietest possible way: `audit_events` has FORCE RLS keyed on a variable a relay does
 * not set, so every insert was refused and every read came back empty, with no error and an
 * audit trail that recorded nothing.
 *
 * None of the three functions can UPDATE or DELETE, so the append-only privilege shape from
 * migration 0001 still holds (PROJECT.md 4.13.3): a bug here can add a wrong entry and
 * still cannot remove or alter a right one.
 */
export class AuditEventReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** Events of one topic newer than a watermark, oldest first. Capped by the function. */
  async outboxSince(topic: string, since: Date): Promise<readonly OutboxEvent[]> {
    const rows = await this.db.execute<OutboxRow>(
      sql`select * from outbox_events_since(${topic}, ${since.toISOString()})`,
    );
    return rows.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      topic: row.topic,
      payload: asRecord(row.payload),
      createdAt: new Date(row.created_at),
    }));
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

  /** Appends one entry. The sequence assigns the order; nothing here chooses it. */
  async append(entry: NewAuditEntry): Promise<void> {
    await this.db.execute(
      sql`select append_audit_event(
            ${entry.projectId}::uuid, ${entry.actorType}, ${entry.actorId},
            ${entry.action}, ${entry.target}, ${entry.ip}, ${entry.ua},
            ${JSON.stringify(entry.metadata)}::jsonb,
            ${entry.prevHash}, ${entry.entryHash}, ${entry.createdAt.toISOString()}::timestamptz)`,
    );
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
