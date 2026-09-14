import {
  type BillingCustomer,
  type ChargeOutcome,
  type CheckoutRequest,
  type HostedCheckout,
  type OffSessionCharge,
  PaymentProvider,
  type ProviderCard,
  type ProviderEvent,
} from "@idenzy/domain/ports/payment-provider";
import {
  CardBrand,
  PaymentProvider as ProviderName,
  TopUpState,
} from "@idenzy/protocol/enums/billing";
import Stripe from "stripe";
import type { StripeSettings } from "./stripe-settings.js";

/** Our own key on every object we create there, so a row can be found from an event. */
const REFERENCE = "idenzy_reference";
const ORG = "idenzy_org_id";

/**
 * Stripe (PROJECT.md 5.1).
 *
 * **The SDK rather than the REST API**, which is the opposite of the call SES and Cloud
 * Tasks got. Those are one signed request and one POST with four fields; this is customers,
 * checkout sessions, payment methods, off-session intents and — the part that decides it —
 * webhook signature verification, where `constructEvent` owns the tolerance window and the
 * constant-time compare. A careful implementation of ours would be a liability on exactly
 * the path where being wrong means accepting a forged charge notification.
 *
 * **The API version is pinned here and not left to the account.** Stripe rolls object
 * shapes per version, so a deployment that took the account default would change behaviour
 * the day somebody upgrades it in a dashboard nobody here is watching.
 *
 * **Nothing in this class writes to our database.** A provider call and a row cannot be
 * made atomic, so the caller records its intent first, calls, and reconciles on the event.
 */
export class StripePaymentProvider extends PaymentProvider {
  override readonly id = ProviderName.Stripe;
  private readonly stripe: Stripe;

  constructor(private readonly settings: StripeSettings) {
    super();
    this.stripe = new Stripe(settings.secretKey, {
      // Safe: the version is ours to pin and Stripe's own types are generated against
      // whichever the SDK shipped with, which is not necessarily the one we ask for.
      apiVersion: settings.apiVersion as Stripe.LatestApiVersion,
      // Two, then give up. A checkout a person is waiting on must not hang behind a
      // provider outage, and every write here is either idempotent or recorded first.
      maxNetworkRetries: 2,
      timeout: 15_000,
    });
  }

  /**
   * The billing entity, created if the organisation has none.
   *
   * Searched by our own org id rather than by email, because an address is a thing a
   * customer changes and two organisations may share one. The search is Stripe's own index
   * over metadata, so this stays one round trip in the common case.
   */
  override async ensureCustomer(
    orgId: string,
    name: string,
    email: string | null,
  ): Promise<BillingCustomer> {
    const found = await this.stripe.customers.search({
      query: `metadata['${ORG}']:'${orgId}'`,
      limit: 1,
    });
    const existing = found.data[0];
    if (existing !== undefined) return { providerCustomerId: existing.id };

    const created = await this.stripe.customers.create({
      name,
      ...(email === null ? {} : { email }),
      metadata: { [ORG]: orgId },
    });
    return { providerCustomerId: created.id };
  }

  /**
   * A hosted page that takes the payment and keeps the card.
   *
   * `setup_future_usage: off_session` is what makes the automatic rule possible at all: a
   * card that was only ever charged with the cardholder present cannot be charged without
   * them, and finding that out at the moment a balance runs dry is the worst time to.
   */
  override async startCheckout(request: CheckoutRequest): Promise<HostedCheckout> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      customer: request.providerCustomerId,
      client_reference_id: request.reference,
      metadata: { [REFERENCE]: request.reference, [ORG]: request.orgId },
      payment_intent_data: {
        setup_future_usage: "off_session",
        // Stamped on the intent as well as the session, because the two arrive as
        // different events and either may be the one that reaches us first.
        metadata: { [REFERENCE]: request.reference, [ORG]: request.orgId },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: request.currency.toLowerCase(),
            unit_amount: request.amountCents ?? 0,
            product_data: {
              name: "Idenzy account credit",
              description: "Credit on the account, drawn down by usage.",
            },
          },
        },
      ],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    return { providerSessionId: session.id, url: session.url ?? "" };
  }

  /** The same page with nothing to pay, for a card added before there is anything to spend. */
  override async startCardSetup(request: CheckoutRequest): Promise<HostedCheckout> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "setup",
      customer: request.providerCustomerId,
      // Required on a setup session even though nothing is charged: the currency decides
      // which payment methods may be saved, and Stripe refuses the call without one. It is
      // not inferred from the customer, which is what the first version of this assumed.
      currency: request.currency.toLowerCase(),
      client_reference_id: request.reference,
      metadata: { [REFERENCE]: request.reference, [ORG]: request.orgId },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    return { providerSessionId: session.id, url: session.url ?? "" };
  }

  override async listCards(providerCustomerId: string): Promise<readonly ProviderCard[]> {
    const methods = await this.stripe.paymentMethods.list({
      customer: providerCustomerId,
      type: "card",
      limit: 100,
    });
    return methods.data.map(cardOf).filter((card): card is ProviderCard => card !== null);
  }

  override async removeCard(providerMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(providerMethodId);
  }

  /**
   * Charges a card with nobody present.
   *
   * `off_session: true` tells the bank there is no cardholder to challenge, and a bank that
   * insists anyway comes back as `requires_action` — which on this path is a refusal and
   * not a step, because there is nobody to ask. The caller has to tell a person rather than
   * retry, which is why the outcome carries the state rather than a boolean.
   */
  override async chargeOffSession(charge: OffSessionCharge): Promise<ChargeOutcome> {
    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: charge.amountCents,
        currency: charge.currency.toLowerCase(),
        customer: charge.providerCustomerId,
        payment_method: charge.providerMethodId,
        off_session: true,
        confirm: true,
        metadata: { [REFERENCE]: charge.reference, [ORG]: charge.orgId },
      });
      return {
        providerIntentId: intent.id,
        state: stateOf(intent.status),
        failureCode: intent.last_payment_error?.code ?? null,
        card: null,
      };
    } catch (error: unknown) {
      // A refused card arrives as a thrown `StripeCardError` carrying the intent it was
      // refusing, not as a returned status. Reading the intent back off the error is what
      // keeps the failure a settled top-up rather than an exception nobody can attribute.
      if (error instanceof Stripe.errors.StripeCardError) {
        const intent = error.payment_intent;
        return {
          providerIntentId: intent?.id ?? "",
          state: intent === undefined ? TopUpState.Failed : stateOf(intent.status),
          failureCode: error.code ?? "card_declined",
          card: null,
        };
      }
      throw error;
    }
  }

  /**
   * The signature check, and the one place the raw body matters.
   *
   * A signature covers bytes. A body that has been through `JSON.parse` and back is a
   * different sequence of them, and the check would fail for a reason that looks like a
   * misconfigured secret — so the caller has to hand over what arrived on the wire.
   */
  override readEvent(rawBody: string, signature: string): ProviderEvent {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.settings.webhookSecret,
    );
    const payload = event.data.object as unknown as Readonly<Record<string, unknown>>;
    const metadata = payload["metadata"];
    const stamped =
      typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      id: event.id,
      type: event.type,
      payload,
      orgId: typeof stamped[ORG] === "string" ? stamped[ORG] : null,
      reference:
        typeof stamped[REFERENCE] === "string"
          ? stamped[REFERENCE]
          : typeof payload["client_reference_id"] === "string"
            ? payload["client_reference_id"]
            : null,
    };
  }
}

/**
 * A payment method as something a person can tell apart from another.
 *
 * Null for anything that is not a card. Stripe's `type` union is long and growing, and a
 * row in our `payment_methods` promises a brand, four digits and an expiry — three things
 * a bank debit does not have.
 */
function cardOf(method: Stripe.PaymentMethod): ProviderCard | null {
  const card = method.card;
  if (card === undefined || card === null) return null;
  return {
    providerMethodId: method.id,
    brand: brandOf(card.brand),
    last4: card.last4,
    expiryMonth: card.exp_month,
    expiryYear: card.exp_year,
  };
}

/** Their network names, ours. `other` is honest about the ones we do not name. */
function brandOf(brand: string): CardBrand {
  switch (brand) {
    case "visa":
      return CardBrand.Visa;
    case "mastercard":
      return CardBrand.Mastercard;
    case "amex":
      return CardBrand.Amex;
    case "discover":
      return CardBrand.Discover;
    default:
      return CardBrand.Other;
  }
}

/**
 * Their intent status, ours.
 *
 * `processing` is `pending` and not a state of its own: the money is moving and the answer
 * comes on an event, which is the same thing our `pending` already means. Everything
 * unrecognised is `pending` too, because the alternative is reporting a charge failed on a
 * status Stripe added last week.
 */
function stateOf(status: Stripe.PaymentIntent.Status): TopUpState {
  switch (status) {
    case "succeeded":
      return TopUpState.Succeeded;
    case "canceled":
      return TopUpState.Cancelled;
    case "requires_action":
    case "requires_confirmation":
      return TopUpState.RequiresAction;
    case "requires_payment_method":
      return TopUpState.Failed;
    default:
      return TopUpState.Pending;
  }
}
