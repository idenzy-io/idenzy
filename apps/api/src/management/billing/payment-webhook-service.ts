import { WebhookSignatureInvalidError } from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { PaymentProvider, type ProviderEvent } from "@idenzy/domain/ports/payment-provider";
import { TopUpSettlement } from "@idenzy/persistence/billing/top-up-settlement";
import { OrgBillingCustomerRepository } from "@idenzy/persistence/repository/org-billing-customer-repository";
import { PaymentMethodRepository } from "@idenzy/persistence/repository/payment-method-repository";
import { PaymentProviderEventRepository } from "@idenzy/persistence/repository/payment-provider-event-repository";
import { TopUpRepository } from "@idenzy/persistence/repository/top-up-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PaymentProvider as ProviderName, TopUpState } from "@idenzy/protocol/enums/billing";
import { Inject, Injectable, Optional } from "@nestjs/common";

/**
 * What the provider tells us, turned into credit — once (PROJECT.md 5.1).
 *
 * **Three guards stand between a delivery and a second lot of credit, and all three are
 * load-bearing.** `payment_provider_events` has a unique index on the provider's own event
 * id, so a redelivery is refused at the insert rather than after a lookup two concurrent
 * deliveries would both pass. `top_ups.provider_intent_id` is unique. And `settle` carries
 * `settled_at is null` in its predicate, so the update that grants credit either takes a
 * pending row or takes nothing. A provider delivers at least once by design; being told
 * twice has to be free.
 *
 * **The org comes off the event and not from a lookup.** A webhook binds no tenant, and the
 * rows it settles are org-scoped. What we stamped on the object ourselves — behind a
 * signature we verified before reading a single field — is a better answer than a
 * cross-tenant read to work it out, and it is the only thing here that is trusted.
 *
 * **Granting the credit, settling the charge and clearing the debt are one transaction.**
 * Either the row says paid and the balance moved, or neither did. Two statements would leave
 * a customer charged with nothing added, which is the one failure on this path nobody can be
 * asked to shrug off — and a third would leave debt paid off against credit that was never
 * granted.
 */
@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly events: PaymentProviderEventRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
    /**
     * `@Inject` by token and not by type, which is not decoration.
     *
     * A constructor parameter typed `PaymentProvider | null` emits `Object` into
     * `design:paramtypes` — a union has no runtime class — so Nest resolves nothing and the
     * parameter arrives `undefined`. `=== null` is then false and the next line dereferences
     * it. The symptom is a TypeError inside a handler rather than a boot failure, which is
     * the same shape as the `useImportType` trap `repo.md` records, and it was found by a
     * webhook answering 500 to a signature that verified perfectly well.
     */
    @Optional() @Inject(PaymentProvider) private readonly payments: PaymentProvider | null,
  ) {}

  async receive(rawBody: string, signature: string, requestId: string): Promise<void> {
    if (this.payments == null) return;
    // Verified before anything is read off it. Everything below treats the payload as ours.
    //
    // A signature that does not check out is a 400 and not a 500: nothing here is broken,
    // the caller sent something we will not accept, and a provider reading a 5xx retries
    // for days over a body that will never verify. The provider's own error class is
    // translated rather than propagated, because an internal_error on this route would
    // also hide a forgery among genuine faults.
    let event: ProviderEvent;
    try {
      event = this.payments.readEvent(rawBody, signature);
    } catch (cause: unknown) {
      throw new WebhookSignatureInvalidError({
        detail: { reason: cause instanceof Error ? cause.name : "unverifiable" },
      });
    }

    const first = await this.events.record({
      provider: ProviderName.Stripe,
      providerEventId: event.id,
      type: event.type,
      payload: event.payload,
    });
    if (!first) return;

    try {
      await this.handle(event, requestId);
      await this.events.markProcessed(ProviderName.Stripe, event.id);
    } catch (cause: unknown) {
      // Recorded and swallowed. The row keeps `processed_at` null, which is what a sweep
      // looks for, and the provider is answered 200 — a retry storm over an event we have
      // already stored helps nobody, and the durable record is what makes it recoverable.
      const reason = cause instanceof Error ? cause.name : "unknown";
      await this.events.markFailed(ProviderName.Stripe, event.id, reason);
      this.logger.error("payment event not handled", {
        requestId,
        component: "billing",
        outcome: "deferred",
        errorName: reason,
      });
    }
  }

  private async handle(event: ProviderEvent, requestId: string): Promise<void> {
    if (event.orgId === null) return;
    const context = new OrgContext(event.orgId, requestId, "system");

    switch (event.type) {
      case "checkout.session.completed":
        await this.completed(context, event);
        return;
      case "payment_intent.succeeded":
        await this.settled(context, event, TopUpState.Succeeded);
        return;
      case "payment_intent.payment_failed":
        await this.settled(context, event, TopUpState.Failed);
        return;
      default:
        // Everything else is stored and acknowledged. An event catalogue we do not act on
        // is not a failure, and treating it as one is how a provider ends up retrying a
        // `customer.updated` for three days.
        return;
    }
  }

  /**
   * A hosted checkout that finished.
   *
   * `mode: setup` saved a card and charged nothing, so there is no top-up to settle and
   * the only work is bringing our copy of the cards in line with the provider's. `mode:
   * payment` is the one that moves money, and its payment intent is what the settlement
   * keys on — the session id was only ever a handle for the page.
   */
  private async completed(context: OrgContext, event: ProviderEvent): Promise<void> {
    await this.syncCards(context);
    if (event.payload["mode"] === "setup") return;

    const intentId = readString(event.payload["payment_intent"]);
    const reference = event.reference;
    if (intentId === null || reference === null) return;

    // The row was opened with the session id, because that is all that existed when the
    // page was created. Re-pointing it at the intent is what makes the two payment_intent
    // events below find it, and what the unique index is on.
    await this.uow.transaction((tx) =>
      new TopUpRepository(tx, context).attach(reference, intentId, TopUpState.Pending),
    );
    await this.settleIntent(context, intentId, TopUpState.Succeeded, null);
  }

  private async settled(
    context: OrgContext,
    event: ProviderEvent,
    state: TopUpState,
  ): Promise<void> {
    const intentId = readString(event.payload["id"]);
    if (intentId === null) return;
    const failure = event.payload["last_payment_error"];
    const code =
      typeof failure === "object" && failure !== null
        ? readString((failure as Record<string, unknown>)["code"])
        : null;
    await this.settleIntent(context, intentId, state, code);
  }

  /**
   * Settles a charge and, where it succeeded, grants the credit it bought.
   *
   * `TopUpSettlement` does the work, because the automatic top-up worker settles charges too
   * and one of the two will get there first. The `settled_at is null` predicate inside it is
   * what decides whether anything happens at all: a second delivery takes no row and grants
   * nothing.
   */
  private async settleIntent(
    context: OrgContext,
    intentId: string,
    state: TopUpState,
    failureCode: string | null,
  ): Promise<void> {
    const at = this.clock.now();
    await this.uow.transaction((tx) =>
      new TopUpSettlement(tx, context).settle({
        providerIntentId: intentId,
        state,
        failureCode,
        at,
      }),
    );
  }

  /**
   * Brings our copy of the cards in line with the provider's.
   *
   * The provider is the record and this table is a cache of it, which is why this is a
   * reconcile rather than an insert: a card added on the hosted page is one we never saw
   * being added, and the only way to learn about it is to ask. Cards gone from the provider
   * are dropped here too — a card we would show and could not charge is worse than one we
   * never listed.
   */
  private async syncCards(context: OrgContext): Promise<void> {
    const provider = this.payments;
    if (provider == null) return;
    const customer = await this.uow.transaction((tx) =>
      new OrgBillingCustomerRepository(tx, context).current(),
    );
    if (customer?.billingCustomerId == null) return;

    const cards = await provider.listCards(customer.billingCustomerId);
    await this.uow.transaction(async (tx) => {
      const methods = new PaymentMethodRepository(tx, context);
      const held = await methods.list();
      const heldByProviderId = new Map(held.map((card) => [card.providerMethodId, card]));

      for (const card of cards) {
        if (heldByProviderId.has(card.providerMethodId)) continue;
        await methods.add({
          provider: ProviderName.Stripe,
          providerMethodId: card.providerMethodId,
          brand: card.brand,
          last4: card.last4,
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
          // Nobody here added it: the cardholder typed it on the provider's page, and
          // inventing a member would put a name against an act they did not perform.
          addedBy: null,
        });
      }

      const atProvider = new Set(cards.map((card) => card.providerMethodId));
      for (const card of held) {
        if (!atProvider.has(card.providerMethodId)) await methods.remove(card.id);
      }
    });
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
