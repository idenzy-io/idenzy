import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";

export interface Money {
  readonly amountMicros: number;
  readonly currency: string;
}

/**
 * Everything a fraud decision needs that the number itself does not carry.
 *
 * A bare `projectId` was not enough: the per-IP ceiling needs the caller's address, the
 * attestation check needs the token the client solved for, and an investigation needs
 * the request that asked. Passing them as one object keeps the base's call site fixed
 * when a new signal is added, which matters because that call site is the guarantee.
 */
export interface SendContext {
  readonly projectId: string;
  readonly requestId: string;
  readonly ip: string | null;
  /** A CAPTCHA or app-attestation token the client presented. Null when it sent none. */
  readonly attestation: string | null;
}

export interface FraudGuard {
  assertAllowed(context: SendContext, to: E164PhoneNumber): Promise<void>;
}

export interface SpendCap {
  /** Charges the quote against the cap. Throws rather than returning false: a send that
   *  cannot be paid for must not continue, and a boolean invites a caller to ignore it. */
  reserve(projectId: string, cost: Money): Promise<void>;
  /**
   * Corrects the reservation once the provider says what it charged.
   *
   * Both amounts are passed because the implementation holds no state between the two
   * calls: a database ledger has the day's total and not this send's share of it, so
   * only the caller knows which reservation is being corrected.
   */
  settle(projectId: string, reserved: Money, actual: Money): Promise<void>;
}

export interface PhonePlacement {
  /** ISO 3166-1 alpha-2, or null when the number cannot be placed. */
  readonly country: string | null;
  /**
   * A premium-rate or shared-cost range, where the recipient's carrier is paid per
   * message. Refused whatever the allowlist says: a number nobody can receive a sign-in
   * code on has no honest reason to be in a sign-in form.
   */
  readonly premiumRate: boolean;
}

/**
 * Where a number is, and whether delivering to it pays somebody.
 *
 * Its own port rather than a method on the number, because the answer needs a metadata
 * set that changes on somebody else's schedule, and `@idenzy/core` is in the browser
 * SDK's dependency graph. A value object that dragged a phone-number database into a
 * customer's bundle would be paid for by every page that imports the client.
 *
 * Both facts come back together because they are read together and a second lookup
 * would parse the same number twice. A null country is not allowed by any allowlist: one
 * that admits what it could not identify is not an allowlist.
 */
export interface PhoneGeography {
  place(to: E164PhoneNumber): PhonePlacement;
}

export interface SmsDispatchResult {
  readonly messageId: string;
  readonly actualCost?: Money;
}

/**
 * Port for outbound SMS (PROJECT.md 11.1).
 *
 * The ordering in send() is the whole design and must not be rearranged: fraud checks
 * and the spend reservation happen before any money is spent. SMS pumping is a direct
 * financial attack on us rather than on the customer, so the guarantee belongs in the
 * base class where no adapter can skip it (PROJECT.md 4.8).
 */
export abstract class SmsProvider {
  protected constructor(
    protected readonly fraudGuard: FraudGuard,
    protected readonly spendCap: SpendCap,
  ) {}

  abstract readonly id: string;
  abstract quoteCost(to: E164PhoneNumber): Promise<Money>;
  protected abstract dispatch(
    to: E164PhoneNumber,
    body: string,
    senderId: string,
  ): Promise<SmsDispatchResult>;

  async send(
    context: SendContext,
    to: E164PhoneNumber,
    body: string,
    senderId: string,
  ): Promise<string> {
    await this.fraudGuard.assertAllowed(context, to);
    const quoted = await this.quoteCost(to);
    await this.spendCap.reserve(context.projectId, quoted);
    const result = await this.dispatch(to, body, senderId);
    // Settled after dispatch, never in a finally: a dispatch that threw may still have
    // put a message on the wire, so the reservation stands rather than being released.
    await this.spendCap.settle(context.projectId, quoted, result.actualCost ?? quoted);
    return result.messageId;
  }
}
