import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";

export interface Money {
  readonly amountMicros: number;
  readonly currency: string;
}

export interface FraudGuard {
  assertAllowed(projectId: string, to: E164PhoneNumber): Promise<void>;
}

export interface SpendCap {
  reserve(projectId: string, cost: Money): Promise<void>;
  settle(projectId: string, actual: Money): Promise<void>;
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
  ): Promise<{ messageId: string; actualCost?: Money }>;

  async send(
    projectId: string,
    to: E164PhoneNumber,
    body: string,
    senderId: string,
  ): Promise<string> {
    await this.fraudGuard.assertAllowed(projectId, to);
    const quoted = await this.quoteCost(to);
    await this.spendCap.reserve(projectId, quoted);
    const result = await this.dispatch(to, body, senderId);
    await this.spendCap.settle(projectId, result.actualCost ?? quoted);
    return result.messageId;
  }
}
