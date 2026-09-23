import { InternalError } from "@idenzy/core/errors";
import {
  type BillingCustomer,
  type ChargeOutcome,
  type ChargeOwner,
  type CheckoutRequest,
  type HostedCheckout,
  type InvoiceRequest,
  type IssuedInvoice,
  type OffSessionCharge,
  PaymentProvider,
  type ProviderCard,
  type ProviderEvent,
} from "@idenzy/domain/ports/payment-provider";
import { TopUpState } from "@idenzy/protocol/enums/billing";

/** What the next off-session charge does. `throw` is a timeout: nobody knows if it charged. */
export type ScriptedCharge =
  | { readonly kind: "answer"; readonly state: TopUpState; readonly failureCode?: string | null }
  | { readonly kind: "throw"; readonly chargedAnyway: boolean };

/**
 * A payment provider that behaves like Stripe where it matters to money, and records what it
 * was asked (ADR-0017).
 *
 * **Idempotency keys are honoured the way Stripe honours them**: a key seen before returns the
 * first answer and charges nothing new, declines included. That is the property the automatic
 * top-up's crash recovery rests on, so a fake that charged again would make every recovery test
 * meaningless. `charges` counts real charges — money that would have left a card — and is what
 * a "never twice" test asserts on.
 *
 * `throw` with `chargedAnyway` models the case that makes this hard: the request reached the
 * provider, the card was charged, and the answer never came back.
 */
export class FakePaymentProvider extends PaymentProvider {
  override readonly id = "stripe";
  cards: ProviderCard[] = [];
  readonly detached: string[] = [];
  /** Every off-session request, retries included. */
  readonly requests: OffSessionCharge[] = [];
  /** Charges that really happened, by intent id. */
  readonly charges = new Map<string, OffSessionCharge>();
  private readonly script: ScriptedCharge[] = [];
  private readonly byKey = new Map<string, ChargeOutcome>();
  private readonly byIntent = new Map<
    string,
    ChargeOutcome & { reference: string; orgId: string }
  >();
  private sequence = 0;
  /** Invoices issued, by our reference. A second call for one reference returns the first. */
  readonly invoices = new Map<string, InvoiceRequest & IssuedInvoice>();
  /** Every issue request, replays included. */
  readonly invoiceRequests: InvoiceRequest[] = [];
  readonly billingEmails = new Map<string, string>();
  /** Makes the next `issueInvoice` fail after creating the invoice, as a timeout would. */
  failNextInvoice = false;

  /** Queues what the next charges do, in order. Unscripted charges succeed. */
  next(...outcomes: ScriptedCharge[]): this {
    this.script.push(...outcomes);
    return this;
  }

  /** Moves a charge on, as the provider would between a request and its webhook. */
  resolve(providerIntentId: string, state: TopUpState, failureCode: string | null = null): void {
    const found = this.byIntent.get(providerIntentId);
    if (found === undefined) throw new InternalError({ detail: { providerIntentId } });
    this.byIntent.set(providerIntentId, { ...found, state, failureCode });
  }

  /** An intent somebody else made, or one of ours, for `chargeOwner`. */
  own(providerIntentId: string, orgId: string, reference: string | null = null): void {
    this.byIntent.set(providerIntentId, {
      providerIntentId,
      state: TopUpState.Succeeded,
      failureCode: null,
      card: null,
      orgId,
      reference: reference ?? "",
    });
  }

  override ensureCustomer(orgId: string): Promise<BillingCustomer> {
    return Promise.resolve({ providerCustomerId: `cus_${orgId.slice(0, 8)}` });
  }

  override startCheckout(request: CheckoutRequest): Promise<HostedCheckout> {
    return Promise.resolve({
      providerSessionId: `cs_${request.reference.slice(0, 8)}`,
      url: "https://checkout.test/pay",
    });
  }

  override startCardSetup(request: CheckoutRequest): Promise<HostedCheckout> {
    return Promise.resolve({
      providerSessionId: `cs_setup_${request.orgId.slice(0, 8)}`,
      url: "https://checkout.test/save",
    });
  }

  override listCards(): Promise<readonly ProviderCard[]> {
    return Promise.resolve(this.cards);
  }

  override removeCard(providerMethodId: string): Promise<void> {
    this.detached.push(providerMethodId);
    this.cards = this.cards.filter((card) => card.providerMethodId !== providerMethodId);
    return Promise.resolve();
  }

  override async chargeOffSession(charge: OffSessionCharge): Promise<ChargeOutcome> {
    // A real request yields to the event loop, and a concurrency test needs this one to.
    await Promise.resolve();
    this.requests.push(charge);
    const replay = this.byKey.get(charge.idempotencyKey);
    if (replay !== undefined) return this.current(replay.providerIntentId);

    const step = this.script.shift() ?? { kind: "answer", state: TopUpState.Succeeded };
    if (step.kind === "throw") {
      if (step.chargedAnyway) this.record(charge, TopUpState.Succeeded, null);
      throw new InternalError({ detail: { reason: "provider timed out" } });
    }
    return this.record(charge, step.state, step.failureCode ?? null);
  }

  override chargeStatus(providerIntentId: string): Promise<ChargeOutcome> {
    return Promise.resolve(this.current(providerIntentId));
  }

  override findCharge(reference: string): Promise<ChargeOutcome | null> {
    for (const intent of this.byIntent.values()) {
      if (intent.reference === reference)
        return Promise.resolve(this.current(intent.providerIntentId));
    }
    return Promise.resolve(null);
  }

  override chargeOwner(providerIntentId: string): Promise<ChargeOwner | null> {
    const found = this.byIntent.get(providerIntentId);
    return Promise.resolve(
      found === undefined
        ? null
        : { orgId: found.orgId, reference: found.reference === "" ? null : found.reference },
    );
  }

  override async issueInvoice(request: InvoiceRequest): Promise<IssuedInvoice> {
    await Promise.resolve();
    this.invoiceRequests.push(request);
    const existing = this.invoices.get(request.reference);
    if (existing !== undefined) return existing;

    this.sequence += 1;
    const issuedAt = new Date("2026-10-01T09:00:00Z");
    const issued: IssuedInvoice = {
      providerInvoiceId: `in_fake_${String(this.sequence)}`,
      hostedUrl: `https://invoice.test/${String(this.sequence)}`,
      pdfUrl: `https://invoice.test/${String(this.sequence)}.pdf`,
      issuedAt,
      dueAt: new Date(issuedAt.getTime() + request.daysUntilDue * 86_400_000),
    };
    this.invoices.set(request.reference, { ...request, ...issued });
    if (this.failNextInvoice) {
      this.failNextInvoice = false;
      throw new InternalError({ detail: { reason: "provider timed out after creating it" } });
    }
    return issued;
  }

  override setBillingEmail(providerCustomerId: string, email: string): Promise<void> {
    this.billingEmails.set(providerCustomerId, email);
    return Promise.resolve();
  }

  override readEvent(rawBody: string): ProviderEvent {
    // No signature to check; what it must not do is invent the stamps, since the whole point
    // of them is that they came back from the provider unchanged.
    // Safe: tests hand this their own serialised ProviderEvent.
    return JSON.parse(rawBody) as ProviderEvent;
  }

  private record(
    charge: OffSessionCharge,
    state: TopUpState,
    failureCode: string | null,
  ): ChargeOutcome {
    this.sequence += 1;
    const providerIntentId = `pi_fake_${String(this.sequence)}`;
    const outcome: ChargeOutcome = { providerIntentId, state, failureCode, card: null };
    this.byKey.set(charge.idempotencyKey, outcome);
    this.byIntent.set(providerIntentId, {
      ...outcome,
      orgId: charge.orgId,
      reference: charge.reference,
    });
    if (state === TopUpState.Succeeded) this.charges.set(providerIntentId, charge);
    return outcome;
  }

  private current(providerIntentId: string): ChargeOutcome {
    const found = this.byIntent.get(providerIntentId);
    if (found === undefined) throw new InternalError({ detail: { providerIntentId } });
    return {
      providerIntentId: found.providerIntentId,
      state: found.state,
      failureCode: found.failureCode,
      card: null,
    };
  }
}
