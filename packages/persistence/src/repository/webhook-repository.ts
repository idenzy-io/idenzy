import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, asc, eq, sql } from "drizzle-orm";
import { webhooks } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** Why an endpoint is off. `paused` is a person's doing; `failing` is the breaker's. */
export type WebhookDisabledReason = "paused" | "failing";

export interface WebhookRow {
  readonly id: string;
  readonly url: string;
  readonly description: string;
  /** Ciphertext. Decrypting it is the caller's business, and only the signer's need. */
  readonly secretCiphertext: string;
  readonly previousSecretCiphertext: string | null;
  readonly previousSecretUntil: Date | null;
  readonly rolledAt: Date | null;
  readonly events: readonly string[];
  readonly allEvents: boolean;
  readonly enabled: boolean;
  readonly disabledAt: Date | null;
  readonly disabledReason: WebhookDisabledReason | null;
  readonly disabledBy: string | null;
  readonly consecutiveFailures: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewWebhook {
  readonly url: string;
  readonly description: string;
  readonly secretCiphertext: string;
  readonly events: readonly string[];
  readonly allEvents: boolean;
  readonly enabled: boolean;
}

/** What an edit may change. The secret is not here: rotating one is its own act. */
export interface WebhookChange {
  readonly url?: string;
  readonly description?: string;
  readonly events?: readonly string[];
  readonly allEvents?: boolean;
}

function toRow(row: typeof webhooks.$inferSelect): WebhookRow {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    secretCiphertext: row.secretCiphertext,
    previousSecretCiphertext: row.previousSecretCiphertext,
    previousSecretUntil: row.previousSecretUntil,
    rolledAt: row.rolledAt,
    events: [...row.events],
    allEvents: row.allEvents,
    enabled: row.enabled,
    disabledAt: row.disabledAt,
    // Safe: written only from `WebhookDisabledReason` by the two methods below.
    disabledReason: row.disabledReason as WebhookDisabledReason | null,
    disabledBy: row.disabledBy,
    consecutiveFailures: row.consecutiveFailures,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A project's webhook endpoints (ADR-0012).
 *
 * The secret travels through here as ciphertext and is never decrypted in this layer, which is
 * the convention the OAuth client secrets and TOTP secrets already follow: the repository knows
 * a column is opaque, and the service that needs the plaintext is the one holding the
 * `FieldEncryptor`. It means nothing in the data layer can accidentally log a signing key.
 *
 * The fan-out relay reads across every project, which RLS forbids by construction. It does not
 * get a SECURITY DEFINER function for it: an outbox row already names its project, so the relay
 * binds one tenant per project in the batch and asks `enabledFor` inside each. That keeps the
 * cross-tenant surface at zero and costs a transaction per project per batch, which is the
 * cheaper half of a trade against a function that could read every customer's endpoints.
 */
export class WebhookRepository extends BaseRepository<typeof webhooks> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, webhooks);
  }

  /** Every endpoint on the project, oldest first, so a list does not reshuffle on edit. */
  async list(): Promise<WebhookRow[]> {
    const rows = await this.tx
      .select()
      .from(webhooks)
      .where(this.tenantScope())
      .orderBy(asc(webhooks.createdAt));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<WebhookRow | null> {
    const rows = await this.tx
      .select()
      .from(webhooks)
      .where(and(this.tenantScope(), eq(webhooks.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * The endpoints a given event has to reach: enabled, and subscribed to it.
   *
   * The `all_events` half is why this is a query rather than a filter over `list()`. A project
   * that asked for everything means events that do not exist yet, so a new event type reaches
   * those endpoints without anybody editing a list — which is the whole point of the flag, and
   * would be quietly lost if the caller intersected arrays it read.
   */
  async enabledFor(event: string): Promise<WebhookRow[]> {
    const rows = await this.tx
      .select()
      .from(webhooks)
      .where(
        and(
          this.tenantScope(),
          eq(webhooks.enabled, true),
          sql`(${webhooks.allEvents} or ${event} = any(${webhooks.events}))`,
        ),
      )
      .orderBy(asc(webhooks.createdAt));
    return rows.map(toRow);
  }

  async create(endpoint: NewWebhook): Promise<WebhookRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(webhooks)
        .values({
          projectId: this.context.projectId,
          url: endpoint.url,
          description: endpoint.description,
          secretCiphertext: endpoint.secretCiphertext,
          events: [...endpoint.events],
          allEvents: endpoint.allEvents,
          enabled: endpoint.enabled,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "webhook" } });
    return toRow(row);
  }

  /**
   * Edits the parts an operator owns. Answers null where the endpoint is not this project's.
   *
   * A change with nothing in it still touches `updated_at`, deliberately: the caller decides
   * whether an empty edit is worth making, and a repository silently doing nothing is harder to
   * debug than a row whose timestamp moved.
   */
  async update(id: string, change: WebhookChange): Promise<WebhookRow | null> {
    const rows = await this.guard(() =>
      this.tx
        .update(webhooks)
        .set({
          ...(change.url === undefined ? {} : { url: change.url }),
          ...(change.description === undefined ? {} : { description: change.description }),
          ...(change.events === undefined ? {} : { events: [...change.events] }),
          ...(change.allEvents === undefined ? {} : { allEvents: change.allEvents }),
          updatedAt: new Date(),
        })
        .where(and(this.tenantScope(), eq(webhooks.id, id)))
        .returning(),
    );
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Turns an endpoint on, which is also what clears the breaker.
   *
   * Resuming a failing endpoint with its counter still at twenty would switch it off again on the
   * next failure rather than after twenty, and an operator who has just fixed their server would
   * watch it die immediately for a reason that had already been dealt with.
   */
  async enable(id: string, at: Date): Promise<WebhookRow | null> {
    return await this.setEnabled(id, {
      enabled: true,
      disabledAt: null,
      disabledReason: null,
      disabledBy: null,
      consecutiveFailures: 0,
      updatedAt: at,
    });
  }

  /**
   * Turns it off, saying which of the two reasons it is.
   *
   * `by` is the membership that paused it and is null for the breaker, because the breaker is
   * nobody: a screen saying "paused by" with our own name on it would read as us having decided
   * something about the customer's endpoint rather than their endpoint having stopped answering.
   */
  async disable(
    id: string,
    reason: WebhookDisabledReason,
    at: Date,
    by: string | null = null,
  ): Promise<WebhookRow | null> {
    return await this.setEnabled(id, {
      enabled: false,
      disabledAt: at,
      disabledReason: reason,
      disabledBy: by,
      updatedAt: at,
    });
  }

  /**
   * Replaces the signing secret, keeping the old one signing until the window closes.
   *
   * One statement, because the two secrets are one state: a rotation that wrote the new secret
   * and then the overlap would, if it lost the second write, leave an endpoint whose deliveries
   * are signed with a secret the customer has not been told about and no longer with the one they
   * hold. The previous ciphertext is whatever the row held a moment ago, read in the same
   * statement rather than passed in, so a caller cannot rotate against a stale copy.
   */
  async rotateSecret(
    id: string,
    secretCiphertext: string,
    previousUntil: Date,
    at: Date,
  ): Promise<WebhookRow | null> {
    const rows = await this.tx
      .update(webhooks)
      .set({
        secretCiphertext,
        previousSecretCiphertext: sql`${webhooks.secretCiphertext}`,
        previousSecretUntil: previousUntil,
        rolledAt: at,
        updatedAt: at,
      })
      .where(and(this.tenantScope(), eq(webhooks.id, id)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Drops the previous secret once its window has closed.
   *
   * A sweep across the project rather than one endpoint, because the thing that expires is a
   * timestamp and nothing happens at it on its own: without this, an old secret would keep
   * signing every delivery forever and a rotation would never actually be a rotation.
   */
  async clearExpiredPreviousSecrets(now: Date): Promise<number> {
    const rows = await this.tx
      .update(webhooks)
      .set({ previousSecretCiphertext: null, previousSecretUntil: null, updatedAt: now })
      .where(
        and(
          this.tenantScope(),
          sql`${webhooks.previousSecretUntil} is not null and ${webhooks.previousSecretUntil} <= ${now}`,
        ),
      )
      .returning({ id: webhooks.id });
    return rows.length;
  }

  /**
   * Counts a failure and answers the new total, so the caller can decide about the breaker.
   *
   * Incremented in the database rather than read-then-written: two dispatchers finishing two
   * failed attempts at once would both read nineteen and both write twenty, and the endpoint
   * would sit one short of the threshold forever.
   */
  async countFailure(id: string, at: Date): Promise<number | null> {
    const rows = await this.tx
      .update(webhooks)
      .set({ consecutiveFailures: sql`${webhooks.consecutiveFailures} + 1`, updatedAt: at })
      .where(and(this.tenantScope(), eq(webhooks.id, id)))
      .returning({ consecutiveFailures: webhooks.consecutiveFailures });
    return rows[0]?.consecutiveFailures ?? null;
  }

  /** A delivery landed, so the run of failures is over. Consecutive means consecutive. */
  async clearFailures(id: string, at: Date): Promise<void> {
    await this.tx
      .update(webhooks)
      .set({ consecutiveFailures: 0, updatedAt: at })
      .where(and(this.tenantScope(), eq(webhooks.id, id)));
  }

  /**
   * Removes an endpoint, and with it every delivery and counter it had.
   *
   * A hard delete, and the cascade is the point: what is left of a deleted endpoint would be
   * rows nobody can reach, carrying event payloads, in a table whose whole design is about not
   * keeping those (ADR-0012).
   */
  async remove(id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(webhooks)
      .where(and(this.tenantScope(), eq(webhooks.id, id)))
      .returning({ id: webhooks.id });
    return rows.length === 1;
  }

  private async setEnabled(
    id: string,
    change: Partial<typeof webhooks.$inferInsert>,
  ): Promise<WebhookRow | null> {
    const rows = await this.tx
      .update(webhooks)
      .set(change)
      .where(and(this.tenantScope(), eq(webhooks.id, id)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }
}
