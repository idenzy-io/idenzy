import { ValidationFailedError } from "@idenzy/core/errors";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { type ChallengeStarted, challengeStartedSchema } from "@idenzy/protocol/schemas/auth";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import { SessionFlow } from "./session-flow.js";

/** What an SMS start may carry beyond the number itself. */
export interface SmsOtpOptions {
  /**
   * A CAPTCHA or app-attestation token, if the project requires one (PROJECT.md 4.8).
   *
   * Taken per call rather than configured on the client, because it is single-use and
   * belongs to the challenge the visitor just solved. A stored one would be replayed on
   * the second attempt and refused, which reads as the widget being broken.
   */
  readonly attestation?: string;
}

/**
 * One-time codes, the passwordless path we document first (PROJECT.md 4.7).
 *
 * The flow remembers the challenge it started, so the second call takes the code and nothing
 * else. That is not only ergonomics: the challenge id is the thing a customer would otherwise
 * carry through their own state, and every place it is carried is a place it can be logged.
 *
 * There is one entry point per channel rather than a sign-in and a sign-up, because the
 * endpoint behind them creates the account when the target has none. A customer's form asks
 * for an address or a number and then for a code, and never has to know which of the two
 * just happened.
 *
 * `verify` is one method for both channels and takes no channel of its own. The challenge id
 * already names the row, and the row knows what carried it, so there is nothing here for a
 * caller to get wrong.
 */
export class OtpFlow extends SessionFlow {
  private challengeId: string | null = null;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the client build one.
  constructor(api: ApiClient, sessions: SessionManager) {
    super(api, sessions);
  }

  /** Answers the same way for an address with an account and one without. */
  startEmail(email: string): Promise<ChallengeStarted> {
    return this.remember({ channel: Channel.Email, email });
  }

  /**
   * The same for a phone number, and refused rather than sent where the project does not
   * serve that country, has run out of daily spend, or requires an attestation this call
   * did not carry. Those are `country_not_allowed`, `spend_cap_reached` and
   * `attestation_required`, and a customer's UI decides what each of them says.
   */
  startSms(phone: string, options: SmsOtpOptions = {}): Promise<ChallengeStarted> {
    return this.remember({ channel: Channel.Sms, phone }, options.attestation);
  }

  /** Takes the challenge from the last `start`, or an explicit one across a page load. */
  verify(input: { readonly code: string; readonly challengeId?: string }): Promise<Session> {
    const challengeId = input.challengeId ?? this.challengeId;
    if (challengeId === null || challengeId === undefined) {
      throw new ValidationFailedError({
        message: "No code has been sent yet. Call start first, or pass the challengeId.",
        fields: [{ path: "challengeId", code: "missing" }],
      });
    }
    return this.establish({
      method: "POST",
      path: "v1/auth/otp/verify",
      body: { challengeId, code: input.code },
    });
  }

  private async remember(body: unknown, attestation?: string): Promise<ChallengeStarted> {
    const started = await this.api.send(challengeStartedSchema, {
      method: "POST",
      path: "v1/auth/otp/start",
      body,
      // Conditionally spread rather than conditionally set: with
      // exactOptionalPropertyTypes an explicit undefined does not satisfy an optional.
      ...(attestation === undefined ? {} : { attestation }),
    });
    this.challengeId = started.challengeId;
    return started;
  }
}
