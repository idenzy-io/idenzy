import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, asc, eq, isNull } from "drizzle-orm";
import { outbox } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
}

/**
 * The transactional outbox (PROJECT.md 9.4).
 *
 * An event is written in the same transaction as the state change that caused it, so a
 * rolled-back sign-in cannot emit a webhook or an audit entry. The relay that drains
 * this table is a worker, which is also what serializes the audit hash chain: doing that
 * on the request path would mean taking a per-project lock on every authentication.
 */
export class OutboxRepository extends BaseRepository<typeof outbox> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, outbox);
  }

  async enqueue(topic: string, payload: Readonly<Record<string, unknown>>): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(outbox)
        .values({ projectId: this.context.projectId, topic, payload })
        .returning({ id: outbox.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "outbox" } });
    return row.id;
  }

  /** Oldest first, so the relay preserves the order events happened in. */
  async pendingBatch(limit = 100): Promise<readonly OutboxMessage[]> {
    const rows = await this.tx
      .select()
      .from(outbox)
      .where(and(this.tenantScope(), isNull(outbox.publishedAt)))
      .orderBy(asc(outbox.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      payload: asRecord(row.payload),
      attempts: row.attempts,
    }));
  }

  async markPublished(id: string, at: Date): Promise<void> {
    await this.tx
      .update(outbox)
      .set({ publishedAt: at })
      .where(and(this.tenantScope(), eq(outbox.id, id)));
  }
}
