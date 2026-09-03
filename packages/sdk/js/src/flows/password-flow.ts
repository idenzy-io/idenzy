import type {
  confirmPasswordResetSchema,
  requestPasswordResetSchema,
  signInWithPasswordSchema,
  signUpWithPasswordSchema,
} from "@idenzy/protocol/schemas/auth";
import type { z } from "zod";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import { SessionFlow } from "./session-flow.js";

export type SignUpWithPasswordInput = z.input<typeof signUpWithPasswordSchema>;
export type SignInWithPasswordInput = z.input<typeof signInWithPasswordSchema>;
export type RequestPasswordResetInput = z.input<typeof requestPasswordResetSchema>;
export type ConfirmPasswordResetInput = z.input<typeof confirmPasswordResetSchema>;

/**
 * Email and password (PROJECT.md 4.5).
 *
 * Both halves of the reset are here and neither returns a session. Requesting one always
 * succeeds, for an address that exists and one that does not, so there is nothing here to
 * branch on and nothing to tell a caller: a UI that showed "no such account" would turn this
 * into the account-enumeration oracle the endpoint is shaped to avoid.
 */
export class PasswordFlow extends SessionFlow {
  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the client build one.
  constructor(api: ApiClient, sessions: SessionManager) {
    super(api, sessions);
  }

  signUp(input: SignUpWithPasswordInput): Promise<Session> {
    return this.establish({ method: "POST", path: "v1/auth/sign-up/password", body: input });
  }

  signIn(input: SignInWithPasswordInput): Promise<Session> {
    return this.establish({ method: "POST", path: "v1/auth/sign-in/password", body: input });
  }

  requestReset(input: RequestPasswordResetInput): Promise<void> {
    return this.api.sendVoid({ method: "POST", path: "v1/auth/password/reset", body: input });
  }

  /**
   * Confirming does not sign the user in, deliberately. Whoever holds the link is not yet
   * known to be the account's owner, and the password they just set is what proves it on the
   * next sign-in.
   */
  confirmReset(input: ConfirmPasswordResetInput): Promise<void> {
    return this.api.sendVoid({
      method: "POST",
      path: "v1/auth/password/reset/confirm",
      body: input,
    });
  }
}
