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
 * concurrent deliveries both pass; the unique index does not. A repeat of an event already
 * handled is not acted on again; a repeat of one whose handling failed is, because that is the
 * provider's retry and nothing else here would ever try it again.
 */
export class PaymentProviderEventRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Records a delivery and answers what to do with it.
   *
   * `new` is the first delivery; `unfinished` is a redelivery of one whose handling failed or
   * never completed, which the caller handles again — every handler here is idempotent by its
   * own predicates, and a redelivery is the provider's retry doing exactly what it is for;
   * `handled` is a repeat of something already done, which the caller must not act on.
   */
  async record(event: NewPaymentProviderEvent): Promise<"new" | "unfinished" | "handled"> {
    const inserted = await this.db.execute<{ id: string }>(
      sql`insert into payment_provider_events (provider, provider_event_id, type, payload)
          values (${event.provider}, ${event.providerEventId}, ${event.type},
                  ${JSON.stringify(event.payload)}::jsonb)
          on conflict (provider, provider_event_id) do nothing
          returning id`,
    );
    if (inserted.rows.length === 1) return "new";
    const existing = await this.db.execute<{ processed_at: Date | null }>(
      sql`select processed_at from payment_provider_events
          where provider = ${event.provider} and provider_event_id = ${event.providerEventId}`,
    );
    return existing.rows[0]?.processed_at == null ? "unfinished" : "handled";
  }

  /** Marks one handled. A row still null here is one the provider's next retry handles again. */
  async markProcessed(provider: PaymentProvider, providerEventId: string): Promise<void> {
    await this.db.execute(
      sql`update payment_provider_events
          set processed_at = now(), failure_reason = null
          where provider = ${provider} and provider_event_id = ${providerEventId}`,
    );
  }

  /** Records why one could not be handled, leaving it for the provider's retry. */
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
