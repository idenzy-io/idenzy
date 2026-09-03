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
 * a relay has no `app.project_id` to be scoped to. The outbox read goes through
 * `outbox_events_since`, a SECURITY DEFINER function narrowed to one topic and a bounded
 * window, for the same reason `revocation_events_since` is one.
 *
 * The audit write is the interesting part. `audit_events` grants `idenzy_app` INSERT and
 * SELECT and nothing else (PROJECT.md 4.13.3), so this class can add to the trail and has
 * no privilege to rewrite it, which is the property the whole chain rests on.
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
      sql`select entry_hash, seq from audit_events
          where project_id = ${projectId}::uuid
          order by seq desc limit 1`,
    );
    const row = rows.rows[0];
    return row === undefined ? null : { entryHash: row.entry_hash, seq: Number(row.seq) };
  }

  /** The whole chain for a project, oldest first, for the verifier. */
  async chain(projectId: string): Promise<readonly AuditChainRow[]> {
    const rows = await this.db.execute<AuditChainSqlRow>(
      sql`select project_id, actor_type, actor_id, action, target, metadata,
                 prev_hash, entry_hash, created_at, seq
          from audit_events
          where project_id = ${projectId}::uuid
          order by seq asc`,
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
      sql`insert into audit_events
            (project_id, actor_type, actor_id, action, target, ip, ua, metadata,
             prev_hash, entry_hash, created_at)
          values (${entry.projectId}::uuid, ${entry.actorType}, ${entry.actorId},
                  ${entry.action}, ${entry.target}, ${entry.ip}, ${entry.ua},
                  ${JSON.stringify(entry.metadata)}::jsonb,
                  ${entry.prevHash}, ${entry.entryHash}, ${entry.createdAt.toISOString()})`,
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
