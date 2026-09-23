import { InternalError, WebhookSignatureInvalidError } from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import { PaymentProvider, type ProviderEvent } from "@idenzy/domain/ports/payment-provider";
import { type DisputeMovement, TopUpReversals } from "@idenzy/persistence/billing/top-up-reversals";
import { type Settled, TopUpSettlement } from "@idenzy/persistence/billing/top-up-settlement";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { InvoiceRepository } from "@idenzy/persistence/repository/invoice-repository";
import { OrgBillingCustomerRepository } from "@idenzy/persistence/repository/org-billing-customer-repository";
import { PaymentMethodRepository } from "@idenzy/persistence/repository/payment-method-repository";
import { PaymentProviderEventRepository } from "@idenzy/persistence/repository/payment-provider-event-repository";
import { TopUpRepository } from "@idenzy/persistence/repository/top-up-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  AutoTopUpSuspension,
  InvoiceStatus,
  PaymentProvider as ProviderName,
  TopUpState,
} from "@idenzy/protocol/enums/billing";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  type StripeDispute,
  type StripeRefund,
  type StripeReview,
  stripeCustomerSchema,
  stripeDisputeSchema,
  stripeIntentSchema,
  stripeInvoiceSchema,
  stripeRefundSchema,
  stripeReviewSchema,
} from "./stripe-objects.js";

/** Where an invoice may be paid from: issued and unpaid, or written off and then paid after all. */
const PAYABLE: readonly InvoiceStatus[] = [
  InvoiceStatus.Draft,
  InvoiceStatus.Open,
  InvoiceStatus.PastDue,
  InvoiceStatus.Uncollectible,
];
const OUTSTANDING: readonly InvoiceStatus[] = [InvoiceStatus.Open, InvoiceStatus.PastDue];
const VOIDABLE: readonly InvoiceStatus[] = [
  InvoiceStatus.Draft,
  InvoiceStatus.Open,
  InvoiceStatus.PastDue,
];

/** Our own row ids are uuids; a reference that is not one is not a row of ours. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * **Money that leaves again is followed too.** A refund or a dispute of a top-up takes back the
 * credit it bought, and gives it back if the refund fails or the dispute is won, through
 * `TopUpReversals` — each movement claimed on its own row first, so the several events Stripe
 * sends about one refund or one dispute move the wallet once. Those events carry none of our
 * metadata, so their organisation is found by asking Stripe whose intent it is.
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
    private readonly signals: BillingSignals,
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

    const disposition = await this.events.record({
      provider: ProviderName.Stripe,
      providerEventId: event.id,
      type: event.type,
      payload: event.payload,
    });
    if (disposition === "handled") return;

    try {
      await this.handle(event, requestId);
      await this.events.markProcessed(ProviderName.Stripe, event.id);
    } catch (cause: unknown) {
      // Recorded, and then answered with a 500 so the provider delivers it again. There is no
      // sweep of our own that would ever retry it — the row's `processed_at` stays null, which
      // is what makes the redelivery handle it rather than skip it — and every handler below is
      // idempotent by its own predicates, so a second run moves nothing twice. A refund or a
      // dispute left unhandled is credit that should have been taken back and was not.
      const reason = cause instanceof Error ? cause.name : "unknown";
      await this.events.markFailed(ProviderName.Stripe, event.id, reason);
      this.logger.error("payment event not handled", {
        requestId,
        component: "billing",
        outcome: "retry",
        errorName: reason,
      });
      throw new InternalError({ detail: { event: event.type, reason } });
    }
  }

  private async handle(event: ProviderEvent, requestId: string): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed":
        return await this.forOrg(event, requestId, (context) => this.completed(context, event));
      case "payment_intent.succeeded":
        return await this.intent(event, requestId, TopUpState.Succeeded);
      case "payment_intent.payment_failed":
        return await this.intent(event, requestId, TopUpState.Failed);
      case "payment_intent.canceled":
        return await this.intent(event, requestId, TopUpState.Cancelled);

      case "refund.created":
      case "refund.updated":
      case "refund.failed":
      case "charge.refund.updated":
        return await this.refunded(stripeRefundSchema.parse(event.payload), requestId);

      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
        return await this.disputed(stripeDisputeSchema.parse(event.payload), null, requestId);
      case "charge.dispute.funds_withdrawn":
        return await this.disputed(
          stripeDisputeSchema.parse(event.payload),
          "withdrawn",
          requestId,
        );
      case "charge.dispute.funds_reinstated":
        return await this.disputed(
          stripeDisputeSchema.parse(event.payload),
          "reinstated",
          requestId,
        );

      case "review.closed":
        return await this.reviewed(stripeReviewSchema.parse(event.payload), requestId);

      // Invoices we issued to invoiced organisations (ADR-0019). Each moves the row only from the
      // states it may leave, so any order and any number of deliveries settle it once.
      case "invoice.finalized":
        return await this.forOrg(event, requestId, (context) => this.finalized(context, event));
      case "invoice.paid":
      case "invoice.payment_succeeded":
        return await this.invoiceMoved(event, requestId, PAYABLE, InvoiceStatus.Paid);
      case "invoice.overdue":
        return await this.invoiceMoved(
          event,
          requestId,
          [InvoiceStatus.Open],
          InvoiceStatus.PastDue,
        );
      case "invoice.voided":
        return await this.invoiceMoved(event, requestId, VOIDABLE, InvoiceStatus.Void);
      case "invoice.marked_uncollectible":
        return await this.invoiceMoved(event, requestId, OUTSTANDING, InvoiceStatus.Uncollectible);
      case "invoice.payment_failed":
        return await this.forOrg(event, requestId, (context) => this.invoiceFailed(context, event));

      case "customer.deleted":
        return await this.forOrg(event, requestId, (context) =>
          this.customerDeleted(context, stripeCustomerSchema.parse(event.payload).id),
        );

      default:
        // Everything else is stored and acknowledged. That includes, deliberately:
        //
        // `charge.refunded`, whose charge no longer embeds its refunds under the API version
        // we pin — the `refund.*` events carry the same money and are what acts on it.
        // The rest of `invoice.*` (`created`, `updated`, `sent`, `upcoming`…), `invoiceitem.*` and
        // `invoice_payment.*`: the invoice run and the events above already say everything they
        // would, and acting twice on one fact is how two paths come to disagree.
        // `customer.created`/`updated`: we create the customers, and the invoice run sets the
        // billing address each month. `customer.tax_id.*`, `tax.settings.updated`, `tax_rate.*`:
        // nothing here applies tax yet — that is a decision recorded in ADR-0019, not an omission.
        // `issuing_dispute.*`: Issuing is for cards we would issue, and we issue none.
        //
        // An event we do not act on is not a failure, and treating it as one is how a
        // provider ends up retrying a `customer.updated` for three days.
        return;
    }
  }

  /** For an event we originated, which carries our organisation in its metadata. */
  private async forOrg(
    event: ProviderEvent,
    requestId: string,
    work: (context: OrgContext) => Promise<void>,
  ): Promise<void> {
    if (event.orgId === null) return;
    await work(new OrgContext(event.orgId, requestId, "system"));
  }

  /**
   * For an event that names an intent and none of our metadata — a refund, a dispute, a review.
   *
   * The provider is asked whose intent it is, because what we stamped on the intent when we
   * made it is the only trusted way from one of these to an organisation. An intent that is not
   * ours answers null and the event is acknowledged and left.
   */
  private async ownerOf(intentId: string | null | undefined, requestId: string) {
    if (intentId == null || this.payments == null) return null;
    const owner = await this.payments.chargeOwner(intentId);
    return owner === null ? null : new OrgContext(owner.orgId, requestId, "system");
  }

  private async intent(event: ProviderEvent, requestId: string, state: TopUpState): Promise<void> {
    const intent = stripeIntentSchema.parse(event.payload);
    await this.forOrg(event, requestId, async (context) => {
      // An automatic charge's intent can reach us before the worker that made it has written
      // the handle down. The intent carries our row id as its reference, so the handle is
      // attached here first — once, and only onto a row that has none — and the settlement
      // below then finds it. Whichever of this and the worker settles first does the work.
      const reference = event.reference;
      if (reference !== null && UUID.test(reference)) {
        await this.uow.transaction((tx) =>
          new TopUpRepository(tx, context).attachIfUnset(reference, intent.id),
        );
      }
      const settled = await this.settleIntent(
        context,
        intent.id,
        state,
        intent.last_payment_error?.code ?? null,
      );
      if (settled?.suspended != null) await this.signals.ruleChanged(context.orgId);
      if (settled != null) await this.signals.walletMoved(context.orgId);
    });
  }

  private async refunded(refund: StripeRefund, requestId: string): Promise<void> {
    const context = await this.ownerOf(refund.payment_intent, requestId);
    if (context === null || refund.payment_intent === null) return;
    const intentId = refund.payment_intent;
    const reversal = await this.uow.transaction((tx) =>
      new TopUpReversals(tx, context).refund({
        providerRefundId: refund.id,
        providerIntentId: intentId,
        amountCents: refund.amount,
        state: refund.status,
        at: this.clock.now(),
      }),
    );
    if (reversal?.suspended != null) await this.signals.ruleChanged(context.orgId);
    if (reversal !== null) await this.signals.walletMoved(context.orgId);
  }

  private async disputed(
    dispute: StripeDispute,
    movement: DisputeMovement,
    requestId: string,
  ): Promise<void> {
    const context = await this.ownerOf(dispute.payment_intent, requestId);
    if (context === null || dispute.payment_intent === null) return;
    const intentId = dispute.payment_intent;
    const reversal = await this.uow.transaction((tx) =>
      new TopUpReversals(tx, context).dispute({
        providerDisputeId: dispute.id,
        providerIntentId: intentId,
        amountCents: dispute.amount,
        status: dispute.status,
        reason: dispute.reason,
        movement,
        at: this.clock.now(),
      }),
    );
    if (reversal?.suspended != null) await this.signals.ruleChanged(context.orgId);
    if (reversal !== null) await this.signals.walletMoved(context.orgId);
    if (reversal !== null && reversal.debitedCents + reversal.creditedCents > 0) {
      this.logger.warn("dispute moved a wallet", {
        requestId,
        orgId: context.orgId,
        component: "billing",
        outcome: movement ?? dispute.status,
      });
    }
  }

  /**
   * The provider finalised an invoice we drafted. The invoice run writes this down itself; this is
   * for the case where the event beats it, and attaches onto the draft by the reference we stamped.
   */
  private async finalized(context: OrgContext, event: ProviderEvent): Promise<void> {
    const invoice = stripeInvoiceSchema.parse(event.payload);
    const reference = event.reference;
    if (reference === null || !UUID.test(reference)) return;
    const finalizedAt = invoice.status_transitions?.finalized_at ?? invoice.created;
    await this.uow.transaction((tx) =>
      new InvoiceRepository(tx, context).attachProvider(reference, {
        providerInvoiceId: invoice.id,
        hostedUrl: invoice.hosted_invoice_url ?? null,
        pdfUrl: invoice.invoice_pdf ?? null,
        issuedAt: new Date(finalizedAt * 1000),
        dueAt: invoice.due_date == null ? null : new Date(invoice.due_date * 1000),
      }),
    );
  }

  private async invoiceMoved(
    event: ProviderEvent,
    requestId: string,
    from: readonly InvoiceStatus[],
    to: InvoiceStatus,
  ): Promise<void> {
    // Parsed inside, once the event is known to be ours: an invoice somebody else made (a
    // `stripe trigger`, another integration on the account) is acknowledged and left, not failed
    // and retried for days over a shape we never promised to read.
    await this.forOrg(event, requestId, async (context) => {
      const invoice = stripeInvoiceSchema.parse(event.payload);
      // Events are not delivered in order: a `paid` can arrive before the `finalized` that would
      // have attached the provider's invoice to our draft, so it is attached here first.
      await this.finalized(context, event);
      const paidAt = invoice.status_transitions?.paid_at;
      const at =
        to === InvoiceStatus.Paid && paidAt != null ? new Date(paidAt * 1000) : this.clock.now();
      const moved = await this.uow.transaction((tx) =>
        new InvoiceRepository(tx, context).moveByProvider(invoice.id, from, to, at),
      );
      if (moved) {
        this.logger.info("invoice moved", {
          requestId,
          orgId: context.orgId,
          component: "billing",
          outcome: to,
        });
        await this.signals.walletMoved(context.orgId);
      }
    });
  }

  /**
   * A payment attempt on an invoice failed. Nothing changes state — the invoice is still open and
   * the customer can pay it another way — and nothing stops: this is the flag a person reads.
   */
  private invoiceFailed(context: OrgContext, event: ProviderEvent): Promise<void> {
    const invoice = stripeInvoiceSchema.parse(event.payload);
    this.logger.warn("invoice payment failed", {
      orgId: context.orgId,
      component: "billing",
      outcome: invoice.status ?? "unknown",
    });
    return Promise.resolve();
  }

  /**
   * Somebody deleted the organisation's customer at the provider. Its cards went with it, so our
   * copy of them is dropped and the customer id forgotten — a new one is made on next use — and
   * the automatic rule stops, because it has nothing it could charge.
   */
  private async customerDeleted(context: OrgContext, customerId: string): Promise<void> {
    const released = await this.uow.transaction(async (tx) => {
      if (!(await new OrgBillingCustomerRepository(tx, context).release(customerId))) return false;
      const methods = new PaymentMethodRepository(tx, context);
      for (const card of await methods.list()) await methods.remove(card.id);
      await new BillingSettingsRepository(tx, context).suspendAutoTopUp(
        AutoTopUpSuspension.NoPaymentMethod,
        this.clock.now(),
      );
      return true;
    });
    if (released) await this.signals.ruleChanged(context.orgId);
  }

  /**
   * A fraud review that ended against the payment stops the automatic rule.
   *
   * The money itself moves on the refund or dispute events that accompany these; what this adds
   * is that Radar thought the card suspect, and a rule that went on charging it would be asking
   * to be declined as the next one.
   */
  private async reviewed(review: StripeReview, requestId: string): Promise<void> {
    if (review.reason !== "refunded_as_fraud" && review.reason !== "disputed") return;
    const context = await this.ownerOf(review.payment_intent, requestId);
    if (context === null) return;
    const suspended = await this.uow.transaction((tx) =>
      new BillingSettingsRepository(tx, context).suspendAutoTopUp(
        AutoTopUpSuspension.FraudReview,
        this.clock.now(),
      ),
    );
    if (suspended) await this.signals.ruleChanged(context.orgId);
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
    const settled = await this.settleIntent(context, intentId, TopUpState.Succeeded, null);
    if (settled !== null) await this.signals.walletMoved(context.orgId);
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
  ): Promise<Settled | null> {
    const at = this.clock.now();
    return await this.uow.transaction((tx) =>
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
