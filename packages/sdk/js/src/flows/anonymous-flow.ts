import type { upgradeAnonymousSchema } from "@idenzy/protocol/schemas/auth";
import type { z } from "zod";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import { SessionFlow } from "./session-flow.js";

export type UpgradeAnonymousInput = z.input<typeof upgradeAnonymousSchema>;

/**
 * Anonymous sessions, and the upgrade that keeps the account (PROJECT.md 3.1).
 *
 * The upgrade returns a new session rather than reusing the current one, so the `amr` claim
 * stops saying `anon` for an account that now has a password. The user id and everything
 * hanging off it survive; the credential is what changes.
 */
export class AnonymousFlow extends SessionFlow {
  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the client build one.
  constructor(api: ApiClient, sessions: SessionManager) {
    super(api, sessions);
  }

  signIn(): Promise<Session> {
    return this.establish({ method: "POST", path: "v1/auth/anonymous" });
  }

  async upgrade(input: UpgradeAnonymousInput): Promise<Session> {
    return this.establish({
      method: "POST",
      path: "v1/auth/anonymous/upgrade",
      body: input,
      accessToken: await this.sessions.requireToken(),
    });
  }
}
