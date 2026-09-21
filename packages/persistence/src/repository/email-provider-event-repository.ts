import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface NewEmailProviderEvent {
  readonly provider: string;
  /** The SNS `MessageId`. Stable across every redelivery of the same notification. */
  readonly providerEventId: string;
  readonly type: string;
  /** From the message tag, and null where the message predates sends carrying one. */
  readonly projectId: string | null;
  readonly bounceType: string | null;
  readonly bounceSubType: string | null;
}

/**
 * Every SES delivery event we have been told about, once.
 *
 * Takes the pool rather than a transaction and a `TenantContext`, like
 * `PaymentProviderEventRepository` and for the same reason: the notification arrives for
 * whichever project it happens to concern, and reading the tag that says which is something
 * the receiver does *after* it has a row. The table carries no tenant key to match.
 *
 * `record` is the idempotency check and not something done before one. SNS delivers at least
 * once, so a lookup followed by an insert has a window two concurrent deliveries both pass;
 * the unique index does not. `false` means this is a repeat and the caller must not act on it
 * again — which matters here in a way it does not for a suppression, because suppressing the
 * same address twice is harmless and counting the same bounce twice moves a rate.
 */
export class EmailProviderEventRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /** Answers whether this delivery is the first, and so whether to act on it. */
  async record(event: NewEmailProviderEvent): Promise<boolean> {
    const result = await this.db.execute<{ id: string }>(
      sql`insert into email_provider_events
            (provider, provider_event_id, type, project_id, bounce_type, bounce_sub_type)
          values (${event.provider}, ${event.providerEventId}, ${event.type},
                  ${event.projectId}, ${event.bounceType}, ${event.bounceSubType})
          on conflict (provider, provider_event_id) do nothing
          returning id`,
    );
    return result.rows.length === 1;
  }

  async markProcessed(provider: string, providerEventId: string): Promise<void> {
    await this.db.execute(
      sql`update email_provider_events
          set processed_at = now(), failure_reason = null
          where provider = ${provider} and provider_event_id = ${providerEventId}`,
    );
  }

  /** Records why one could not be handled, leaving it visible as unprocessed. */
  async markFailed(provider: string, providerEventId: string, reason: string): Promise<void> {
    await this.db.execute(
      sql`update email_provider_events
          set failure_reason = ${reason}
          where provider = ${provider} and provider_event_id = ${providerEventId}`,
    );
  }
}
