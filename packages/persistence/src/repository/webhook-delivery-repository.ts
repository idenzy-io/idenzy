import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { webhookDeliveries } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

/**
 * Where a delivery is.
 *
 * `queued` and `delivering` are both "pending" to a reader; the split exists so a dispatcher can
 * tell a delivery nobody has picked up from one another dispatcher is mid-call on.
 */
export type DeliveryStatus = "queued" | "delivering" | "delivered" | "failed";

/** One attempt, as the row records it and the screen shows it. */
export interface DeliveryAttemptRecord {
  /** One is the first call, not the first retry. */
  readonly n: number;
  readonly at: string;
  /** What the endpoint answered, or null where nothing did. */
  readonly status: number | null;
  /** Why there is no status: a timeout, a refused connection, a name that did not resolve. */
  readonly error: string | null;
  readonly durationMs: number;
  /** An excerpt of the receiver's own response, capped by the caller before it arrives here. */
  readonly response: string;
}

export interface WebhookDeliveryRow {
  readonly id: string;
  readonly webhookId: string;
  readonly event: string;
  readonly sequence: number;
  readonly status: DeliveryStatus;
  /** Present only while the delivery is open. Cleared on a terminal outcome (ADR-0012). */
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly attemptCount: number;
  readonly attempts: readonly DeliveryAttemptRecord[];
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly test: boolean;
  readonly createdAt: Date;
}

export interface NewWebhookDelivery {
  readonly webhookId: string;
  readonly event: string;
  readonly sequence: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly test?: boolean;
}

/**
 * How long a claim holds a delivery before another worker may take it over.
 *
 * A lease rather than a flag, because `delivering` has to be re-claimable: a dispatcher that died
 * mid-call leaves a delivery in it, and nothing else would ever pick that up. The lease is what
 * separates "somebody is working on this" from "somebody was working on this and is gone", and it
 * must outlast the longest attempt — fifteen seconds on the retry lane — plus the bookkeeping
 * after it. Sixty seconds costs a minute of delay on a crash and prevents two dispatchers calling
 * one customer's endpoint about the same event.
 */
const CLAIM_LEASE_SECONDS = 60;

/** What an attempt concluded, which is the caller's decision and not this layer's. */
export interface AttemptOutcome {
  readonly attempt: DeliveryAttemptRecord;
  /** Where the delivery now is. */
  readonly status: DeliveryStatus;
  /** When to try again, or null for a terminal outcome. */
  readonly nextAttemptAt: Date | null;
}

function toRow(row: typeof webhookDeliveries.$inferSelect): WebhookDeliveryRow {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    sequence: row.sequence,
    // Safe: written only from `DeliveryStatus` by the methods below.
    status: row.status as DeliveryStatus,
    payload: row.payload === null ? null : asRecord(row.payload),
    attemptCount: row.attemptCount,
    attempts: readAttempts(row.attemptLog),
    nextAttemptAt: row.nextAttemptAt,
    deliveredAt: row.deliveredAt,
    test: row.test,
    createdAt: row.createdAt,
  };
}

function leaseUntil(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

/**
 * `jsonb` is typed `unknown`, correctly: the database guarantees valid JSON and no more.
 *
 * Narrowed once, here, so nothing downstream asserts — and a row written by an older version
 * with a shape we no longer recognise reads as an empty list rather than throwing in the middle
 * of somebody's diagnostics screen.
 */
function readAttempts(value: unknown): DeliveryAttemptRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const { n, at, status, error, durationMs, response } = record;
    if (typeof n !== "number" || typeof at !== "string") return [];
    return [
      {
        n,
        at,
        status: typeof status === "number" ? status : null,
        error: typeof error === "string" ? error : null,
        durationMs: typeof durationMs === "number" ? durationMs : 0,
        response: typeof response === "string" ? response : "",
      },
    ];
  });
}

/**
 * Deliveries: the queue, and the short window of what happened (ADR-0012).
 *
 * The methods here are the pipeline's vocabulary rather than CRUD, because the interesting part
 * of a delivery is not its fields but the four transitions it can make: fanned out, picked up,
 * concluded, and swept away. Each of those is one statement, so two dispatchers racing on the
 * same delivery cannot both believe they own it and a crash between two writes cannot leave a
 * delivery that is neither open nor finished.
 */
export class WebhookDeliveryRepository extends BaseRepository<typeof webhookDeliveries> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, webhookDeliveries);
  }

  /**
   * Writes one delivery per endpoint for an event, due immediately.
   *
   * One statement for the whole fan-out: an event reaching six endpoints is six rows in one
   * insert rather than six round trips inside the relay's batch.
   *
   * Conflicts are ignored rather than raised, and that is what makes the relay replayable. The
   * unique index is (webhook_id, sequence), so an outbox row relayed twice — a crash between the
   * fan-out and the watermark, which is the normal failure — finds its deliveries already there
   * and writes nothing. Answering with the rows it did insert is what lets the caller enqueue a
   * first attempt for exactly those.
   */
  async fanOut(
    deliveries: readonly NewWebhookDelivery[],
    due: Date,
  ): Promise<WebhookDeliveryRow[]> {
    if (deliveries.length === 0) return [];
    const rows = await this.guard(() =>
      this.tx
        .insert(webhookDeliveries)
        .values(
          deliveries.map((delivery) => ({
            projectId: this.context.projectId,
            webhookId: delivery.webhookId,
            event: delivery.event,
            sequence: delivery.sequence,
            payload: delivery.payload,
            status: "queued" as const,
            nextAttemptAt: due,
            test: delivery.test ?? false,
          })),
        )
        .onConflictDoNothing({
          target: [webhookDeliveries.webhookId, webhookDeliveries.sequence],
        })
        .returning(),
    );
    return rows.map(toRow);
  }

  async findById(id: string): Promise<WebhookDeliveryRow | null> {
    const rows = await this.tx
      .select()
      .from(webhookDeliveries)
      .where(and(this.tenantScope(), eq(webhookDeliveries.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Takes ownership of one delivery, or answers null because somebody else has it.
   *
   * The `status = 'queued'` in the predicate is the lock. Cloud Tasks is at-least-once and so is
   * the sweeper below, so the same delivery can arrive at two dispatchers at once; the one whose
   * update matches a queued row owns it and the other is told to stop. Doing this as a read
   * followed by a write would let both pass the read.
   *
   * The claim takes a lease rather than stamping the current time: `next_attempt_at` moves a
   * minute out, so a sweeper looking for what is due does not find a delivery somebody is calling
   * right now, and does find one whose dispatcher died holding it.
   */
  async claim(
    id: string,
    at: Date,
    leaseSeconds = CLAIM_LEASE_SECONDS,
  ): Promise<WebhookDeliveryRow | null> {
    const rows = await this.tx
      .update(webhookDeliveries)
      .set({ status: "delivering", nextAttemptAt: leaseUntil(at, leaseSeconds) })
      .where(
        and(
          this.tenantScope(),
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.status, "queued"),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Records what an attempt found and where the delivery goes next.
   *
   * The attempt is appended in the database rather than merged from a list this layer read, so
   * two writers cannot drop each other's attempt. The payload is cleared on a terminal outcome in
   * the same statement: it is the largest column, it names a user, and the moment nothing will be
   * sent again is the moment it stops being needed.
   */
  async recordAttempt(id: string, outcome: AttemptOutcome): Promise<WebhookDeliveryRow | null> {
    const terminal = outcome.status === "delivered" || outcome.status === "failed";
    const rows = await this.tx
      .update(webhookDeliveries)
      .set({
        status: outcome.status,
        attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
        attemptLog: sql`${webhookDeliveries.attemptLog} || ${JSON.stringify([outcome.attempt])}::jsonb`,
        nextAttemptAt: outcome.nextAttemptAt,
        ...(outcome.status === "delivered" ? { deliveredAt: new Date(outcome.attempt.at) } : {}),
        ...(terminal ? { payload: null } : {}),
      })
      .where(and(this.tenantScope(), eq(webhookDeliveries.id, id)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Deliveries whose next attempt is due, oldest first, claimed as they are read.
   *
   * This is the durable half of the pipeline: Cloud Tasks is a timer and timers are lost, so
   * something has to find a delivery whose task never arrived or whose dispatcher died holding
   * it. `FOR UPDATE SKIP LOCKED` is what lets several workers sweep at once without any of them
   * waiting on another's row — the alternative is a lock that serialises the whole pipeline
   * behind its slowest delivery.
   *
   * `delivering` is in the predicate on purpose, which is why the claim takes a lease: without
   * one, the row this statement just updated would still be due a millisecond later and a second
   * sweeper would call the same endpoint about the same event. With one, a delivery in flight is
   * invisible for a minute and a dead dispatcher's is recoverable after it.
   *
   * It reads a project's own deliveries, like everything here. A sweeper covering every project
   * runs this per project, for the reason `WebhookRepository` gives.
   */
  async claimDue(
    now: Date,
    limit = 50,
    leaseSeconds = CLAIM_LEASE_SECONDS,
  ): Promise<WebhookDeliveryRow[]> {
    const due = this.tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          this.tenantScope(),
          inArray(webhookDeliveries.status, ["queued", "delivering"]),
          lte(webhookDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    const rows = await this.tx
      .update(webhookDeliveries)
      .set({ status: "delivering", nextAttemptAt: leaseUntil(now, leaseSeconds) })
      .where(and(this.tenantScope(), inArray(webhookDeliveries.id, due)))
      .returning();
    return rows.map(toRow);
  }

  /** One endpoint's deliveries, newest first: the table on the screen. */
  async listForEndpoint(webhookId: string, limit = 50): Promise<WebhookDeliveryRow[]> {
    const rows = await this.tx
      .select()
      .from(webhookDeliveries)
      .where(and(this.tenantScope(), eq(webhookDeliveries.webhookId, webhookId)))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
    return rows.map(toRow);
  }

  /**
   * Re-opens a terminal delivery for one more attempt, which is what the screen's Retry does.
   *
   * Refused where the payload has gone, and that refusal is the honest half: a retry sends the
   * same delivery id with the same body, and a body we have cleared cannot be reproduced —
   * re-signing something assembled now would be a different delivery wearing an old id. Answering
   * null lets the screen say so rather than sending something subtly different.
   */
  async reopen(id: string, due: Date): Promise<WebhookDeliveryRow | null> {
    const rows = await this.tx
      .update(webhookDeliveries)
      .set({ status: "queued", nextAttemptAt: due })
      .where(
        and(
          this.tenantScope(),
          eq(webhookDeliveries.id, id),
          inArray(webhookDeliveries.status, ["delivered", "failed"]),
          sql`${webhookDeliveries.payload} is not null`,
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Drops terminal deliveries older than the window.
   *
   * The window's mechanism until the table is partitioned, and only ever terminal rows: a
   * delivery still owed is not old, however long its schedule has been running — the last retry
   * is a day out, which is longer than some windows anybody would choose.
   */
  async deleteFinishedBefore(cutoff: Date, limit = 1000): Promise<number> {
    const stale = this.tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          this.tenantScope(),
          inArray(webhookDeliveries.status, ["delivered", "failed"]),
          lte(webhookDeliveries.createdAt, cutoff),
        ),
      )
      .limit(limit);

    const rows = await this.tx
      .delete(webhookDeliveries)
      .where(and(this.tenantScope(), inArray(webhookDeliveries.id, stale)))
      .returning({ id: webhookDeliveries.id });
    return rows.length;
  }
}
