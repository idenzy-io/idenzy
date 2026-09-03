import { randomUUID } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import type { Logger } from "@idenzy/core/logging/logger";
import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import {
  type FraudGuard,
  type Money,
  type SmsDispatchResult,
  SmsProvider,
  type SpendCap,
} from "@idenzy/domain/ports/sms-provider";

/** What a development send is priced at, so the cap and the ledger have real numbers. */
const NOTIONAL_COST: Money = { amountMicros: 7_000, currency: "USD" };

/**
 * A transport that delivers nothing and prints everything, for local development.
 *
 * The same bargain as the email logger and for the same reason: an OTP has to reach the
 * developer somehow, and the alternative is a hardcoded code in a test seam that
 * eventually ships. The number and the code go in the log *message* rather than in
 * fields, because fields are allowlisted and a phone number is exactly what that
 * allowlist exists to drop (PROJECT.md 4.13.8). That is why the constructor refuses to
 * build outside development.
 *
 * It quotes a notional cost rather than zero. A free transport would leave the spend cap
 * untested everywhere it is developed, and the first time anybody found out whether the
 * reservation arithmetic worked would be against a provider that charges.
 */
export class LoggingSmsProvider extends SmsProvider {
  override readonly id = "logging";

  constructor(
    fraudGuard: FraudGuard,
    spendCap: SpendCap,
    private readonly logger: Logger,
    environment: string,
  ) {
    super(fraudGuard, spendCap);
    if (environment !== "development") {
      throw new InternalError({
        detail: {
          reason: "the logging sms transport prints message bodies and is development only",
          environment,
        },
      });
    }
  }

  override quoteCost(_to: E164PhoneNumber): Promise<Money> {
    return Promise.resolve(NOTIONAL_COST);
  }

  protected override dispatch(
    to: E164PhoneNumber,
    body: string,
    senderId: string,
  ): Promise<SmsDispatchResult> {
    this.logger.info(
      [
        "",
        "──── sms (development transport, nothing was sent) ────",
        `to:     ${to.value}`,
        `from:   ${senderId}`,
        "",
        body,
        "───────────────────────────────────────────────────────",
      ].join("\n"),
    );
    return Promise.resolve({ messageId: `log_${randomUUID()}` });
  }
}
