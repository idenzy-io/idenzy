import { ValidationFailedError } from "@idenzy/core/errors";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { type ChallengeStarted, challengeStartedSchema } from "@idenzy/protocol/schemas/auth";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import { SessionFlow } from "./session-flow.js";

/**
 * One-time codes over email, the passwordless path we document first (PROJECT.md 4.7).
 *
 * The flow remembers the challenge it started, so the second call takes the code and nothing
 * else. That is not only ergonomics: the challenge id is the thing a customer would otherwise
 * carry through their own state, and every place it is carried is a place it can be logged.
 *
 * There is one entry point rather than a sign-in and a sign-up, because the endpoint behind it
 * creates the account when the address has none. A customer's form asks for an address and
 * then for a code, and never has to know which of the two just happened.
 */
export class EmailOtpFlow extends SessionFlow {
  private challengeId: string | null = null;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the client build one.
  constructor(api: ApiClient, sessions: SessionManager) {
    super(api, sessions);
  }

  /** Answers the same way for an address with an account and one without. */
  async start(email: string): Promise<ChallengeStarted> {
    const started = await this.api.send(challengeStartedSchema, {
      method: "POST",
      path: "v1/auth/otp/start",
      body: { channel: Channel.Email, email },
    });
    this.challengeId = started.challengeId;
    return started;
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
}
