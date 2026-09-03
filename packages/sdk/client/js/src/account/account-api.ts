import {
  type EmailChangeConfirmed,
  emailChangeConfirmedSchema,
} from "@idenzy/protocol/schemas/auth";
import { type PublicUser, publicUserSchema } from "@idenzy/protocol/schemas/user";
import type { ApiClient } from "../http/api-client.js";
import type { SessionManager } from "../session/session-manager.js";

/**
 * The signed-in user's own profile and address (PROJECT.md 4.5).
 *
 * Requesting a verification or a change needs a session, because both are actions on your own
 * account. Confirming either does not, and that asymmetry is deliberate: the link is usually
 * opened in a different browser from the one that asked, and demanding a session there would
 * break the flow for most users to protect a token that is already single use and short lived.
 */
export class AccountApi {
  constructor(
    private readonly api: ApiClient,
    private readonly sessions: SessionManager,
  ) {}

  /** Also refreshes the held profile, so a subscriber sees the same user this returned. */
  async me(): Promise<PublicUser> {
    const user = await this.api.send(publicUserSchema, {
      method: "GET",
      path: "v1/users/me",
      accessToken: await this.sessions.requireToken(),
    });
    this.sessions.updateUser(user);
    return user;
  }

  async requestEmailVerification(): Promise<void> {
    await this.api.sendVoid({
      method: "POST",
      path: "v1/users/me/email/verification",
      accessToken: await this.sessions.requireToken(),
    });
  }

  confirmEmailVerification(token: string): Promise<void> {
    return this.api.sendVoid({
      method: "POST",
      path: "v1/users/me/email/verification/confirm",
      body: { token },
    });
  }

  async requestEmailChange(newEmail: string): Promise<void> {
    await this.api.sendVoid({
      method: "POST",
      path: "v1/users/me/email",
      body: { newEmail },
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * `applied` stays false until both addresses have confirmed, so a customer's UI can say the
   * other confirmation is still outstanding rather than claiming the address has moved.
   */
  confirmEmailChange(token: string): Promise<EmailChangeConfirmed> {
    return this.api.send(emailChangeConfirmedSchema, {
      method: "POST",
      path: "v1/users/me/email/confirm",
      body: { token },
    });
  }
}
