import type { CardBrand, TopUpState } from "@idenzy/protocol/enums/billing";

/** The billing entity a charge is made against, as the provider knows it. */
export interface BillingCustomer {
  readonly providerCustomerId: string;
}

/** A card on file, reduced to what can be displayed and what can be charged. */
export interface ProviderCard {
  readonly providerMethodId: string;
  readonly brand: CardBrand;
  readonly last4: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
}

/** Where to send the browser, and the id that identifies the session when it comes back. */
export interface HostedCheckout {
  readonly providerSessionId: string;
  readonly url: string;
}

export interface CheckoutRequest {
  readonly providerCustomerId: string;
  /**
   * Whose organisation this is, stamped on the provider's object and read back off the
   * event. A webhook arrives with no tenant bound and the row it settles is org-scoped, so
   * something has to say which — and what we put there ourselves, behind a verified
   * signature, is a better answer than a cross-tenant lookup to find out.
   */
  readonly orgId: string;
  /** Integer cents. Absent for a session that only saves a card. */
  readonly amountCents?: number | undefined;
  readonly currency: string;
  /** Ours, echoed back on the webhook, so an event finds the row it belongs to. */
  readonly reference: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface OffSessionCharge {
  readonly providerCustomerId: string;
  readonly orgId: string;
  readonly providerMethodId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly reference: string;
  /**
   * Sent with the request so that asking twice charges once.
   *
   * Derived from our own row and never random: a worker that crashed after the provider
   * charged the card and before it wrote down the answer asks again with the same key, and is
   * handed the first charge back instead of making a second.
   */
  readonly idempotencyKey: string;
}

/** Whose charge an intent is, read from what we stamped on it when we made it. */
export interface ChargeOwner {
  readonly orgId: string;
  readonly reference: string | null;
}

/** What a charge came back as, in our vocabulary rather than the provider's. */
export interface ChargeOutcome {
  readonly providerIntentId: string;
  readonly state: TopUpState;
  readonly failureCode: string | null;
  readonly card: ProviderCard | null;
}

/** One line of an invoice, in integer cents. Negative for a credit applied. */
export interface InvoiceLineRequest {
  /** Ours, so a replay creates the line once. */
  readonly reference: string;
  readonly description: string;
  readonly amountCents: number;
}

/** A month's invoice for an invoiced organisation (ADR-0019), issued on net terms. */
export interface InvoiceRequest {
  readonly providerCustomerId: string;
  readonly orgId: string;
  /** Our invoice row's id, stamped on the provider's invoice so an event finds the row. */
  readonly reference: string;
  /** Our own invoice number, shown on the document beside the provider's. */
  readonly number: string;
  readonly currency: string;
  readonly daysUntilDue: number;
  readonly lines: readonly InvoiceLineRequest[];
}

/** What the provider made of an invoice, once issued. */
export interface IssuedInvoice {
  readonly providerInvoiceId: string;
  /** Where the customer pays it: card or bank transfer, the provider's page. */
  readonly hostedUrl: string | null;
  readonly pdfUrl: string | null;
  readonly issuedAt: Date;
  readonly dueAt: Date | null;
}

/**
 * One event the provider sent us, after its signature has been checked.
 *
 * `id` is the provider's own and is what makes handling idempotent: it is the natural key
 * on `payment_provider_events`, and a provider that retries a delivery sends the same one.
 */
export interface ProviderEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Our own organisation id, as we stamped it. Null on an event we did not originate. */
  readonly orgId: string | null;
  /** Our own row id, as we stamped it. Null for the same reason. */
  readonly reference: string | null;
}

/**
 * Port for taking money (PROJECT.md 5.1).
 *
 * Declared here in the domain and implemented in `providers-payment`, which is the
 * inversion that keeps the package graph acyclic (PROJECT.md 8.3). One implementation
 * today and a port anyway, for the reason `payment_provider_events.provider` is a column
 * rather than an assumption: who takes the money is a commercial decision and not a
 * property of the code that records it.
 *
 * **The card is never ours to see.** Nothing on this interface takes a card number,
 * because nothing in this system may: a hosted checkout is what collects one, and what
 * comes back is a token, a brand and four digits. An implementation that accepted a PAN
 * would put every service that imports this package in scope for PCI DSS.
 *
 * **Nothing here writes to the database.** A provider call and a row are two things that
 * cannot be made atomic — the charge happens at the provider whatever our transaction
 * does — so the ordering is the caller's problem and is solved the way the webhook
 * pipeline solves it: record the intent first, act, then reconcile on the event. An
 * implementation that helpfully persisted anything would hide exactly the window that
 * matters.
 */
export abstract class PaymentProvider {
  abstract readonly id: string;

  /** The provider's billing entity for an organisation, created if it has none. */
  abstract ensureCustomer(
    orgId: string,
    name: string,
    email: string | null,
  ): Promise<BillingCustomer>;

  /** A hosted page that takes a payment and saves the card for later. */
  abstract startCheckout(request: CheckoutRequest): Promise<HostedCheckout>;

  /** A hosted page that saves a card without charging it. */
  abstract startCardSetup(request: CheckoutRequest): Promise<HostedCheckout>;

  /** Cards on file, as the provider holds them. Ours is a cache of this and not the record. */
  abstract listCards(providerCustomerId: string): Promise<readonly ProviderCard[]>;

  /** Takes a card off the customer, so it cannot be charged again. */
  abstract removeCard(providerMethodId: string): Promise<void>;

  /**
   * Charges a saved card with nobody present.
   *
   * The one call that can fail in a way a person cannot answer: a bank asking for 3-D
   * Secure off-session has nobody to ask, so `requires_action` here means the automatic
   * rule could not fire and a person has to be told rather than retried at.
   */
  abstract chargeOffSession(charge: OffSessionCharge): Promise<ChargeOutcome>;

  /** Where a charge has got, asked of the provider rather than waited for on a webhook. */
  abstract chargeStatus(providerIntentId: string): Promise<ChargeOutcome>;

  /**
   * The charge made under one of our references, if the provider has one.
   *
   * For a charge whose answer we never wrote down and can no longer replay: an idempotency key
   * is honoured for a day, and after that the only way to learn whether a card was charged is
   * to search for the reference we stamped on it.
   */
  abstract findCharge(reference: string): Promise<ChargeOutcome | null>;

  /**
   * Whose charge this is, for an event that does not say.
   *
   * A refund, a dispute and a fraud review each name the intent they concern and carry none
   * of our metadata, so the only trusted way from one of them to an organisation is to ask the
   * provider for the intent and read what we stamped on it. Null for an intent we did not make.
   */
  abstract chargeOwner(providerIntentId: string): Promise<ChargeOwner | null>;

  /**
   * Issues an invoice on net terms and sends it to the customer's billing address.
   *
   * Safe to call again for the same reference: an implementation finds the invoice it already
   * made rather than making a second, because the caller replays a draft whose answer it never
   * wrote down — and two invoices for one month is a customer billed twice.
   */
  abstract issueInvoice(invoice: InvoiceRequest): Promise<IssuedInvoice>;

  /** Where the provider sends a customer's invoices. */
  abstract setBillingEmail(providerCustomerId: string, email: string): Promise<void>;

  /**
   * Verifies a webhook's signature and returns what it says.
   *
   * Takes the raw body, never a parsed object: a signature covers bytes, and a payload
   * that has been through `JSON.parse` and back is a different sequence of them.
   */
  abstract readEvent(rawBody: string, signature: string): ProviderEvent;
}
