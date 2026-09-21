import type { PaymentProvider } from "@idenzy/protocol/enums/billing";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface NewPaymentProviderEvent {
  readonly provider: PaymentProvider;
  readonly providerEventId: string;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * Every payment webhook the provider has sent us, once.
 *
 * Takes the pool rather than a transaction and an `OrgContext`, like `RelayOffsetRepository`
 * and for the same reason: a webhook arrives for whichever organisation it happens to
 * concern, and the receiver has none bound at the moment it has to write the row. The
 * table carries no organisation key to match, and it is the only billing table that does not.
 *
 * `record` is the idempotency check rather than something done before one. The provider
 * delivers at least once by design, so a lookup followed by an insert has a window two
 * concurrent deliveries both pass; the unique index does not. `false` means this delivery
 * is a repeat and the caller must not act on it again.
 */
export class PaymentProviderEventRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /** Answers whether this delivery is the first, and so whether to act on it. */
  async record(event: NewPaymentProviderEvent): Promise<boolean> {
    const result = await this.db.execute<{ id: string }>(
      sql`insert into payment_provider_events (provider, provider_event_id, type, payload)
          values (${event.provider}, ${event.providerEventId}, ${event.type},
                  ${JSON.stringify(event.payload)}::jsonb)
          on conflict (provider, provider_event_id) do nothing
          returning id`,
    );
    return result.rows.length === 1;
  }

  /** Marks one handled. A row still null here is what the retry sweep looks for. */
  async markProcessed(provider: PaymentProvider, providerEventId: string): Promise<void> {
    await this.db.execute(
      sql`update payment_provider_events
          set processed_at = now(), failure_reason = null
          where provider = ${provider} and provider_event_id = ${providerEventId}`,
    );
  }

  /** Records why one could not be handled, leaving it for the sweep to try again. */
  async markFailed(
    provider: PaymentProvider,
    providerEventId: string,
    reason: string,
  ): Promise<void> {
    await this.db.execute(
      sql`update payment_provider_events
          set failure_reason = ${reason}
          where provider = ${provider} and provider_event_id = ${providerEventId}`,
    );
  }
}
