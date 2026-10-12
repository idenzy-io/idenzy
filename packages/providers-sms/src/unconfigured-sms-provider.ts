import { SignInMethodDisabledError } from "@idenzy/core/errors";
import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import {
  type FraudGuard,
  type Money,
  type SendContext,
  type SmsDispatchResult,
  SmsProvider,
  type SpendCap,
} from "@idenzy/domain/ports/sms-provider";

/**
 * The SMS provider of a deployment that sends no text messages.
 *
 * A deployment without an SMS transport is a normal one — a project that signs people in by email
 * and providers never needs it — so it starts, and the SMS ways in answer that they are not
 * available here. It refuses before the fraud guard or the spend cap is consulted, so a request
 * that cannot be sent costs nothing and counts against nobody.
 */
export class UnconfiguredSmsProvider extends SmsProvider {
  override readonly id = "unconfigured";

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the module build one.
  constructor(fraudGuard: FraudGuard, spendCap: SpendCap) {
    super(fraudGuard, spendCap);
  }

  override send(
    _context: SendContext,
    _to: E164PhoneNumber,
    _body: string,
    _senderId: string,
  ): Promise<string> {
    return Promise.reject(refusal());
  }

  override quoteCost(_to: E164PhoneNumber): Promise<Money> {
    return Promise.reject(refusal());
  }

  protected override dispatch(): Promise<SmsDispatchResult> {
    return Promise.reject(refusal());
  }
}

function refusal(): SignInMethodDisabledError {
  return new SignInMethodDisabledError({
    message: "Text messages are not available on this deployment.",
    detail: { channel: "sms" },
  });
}
