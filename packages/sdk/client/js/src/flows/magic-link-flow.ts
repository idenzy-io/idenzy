import {
  type ChallengeStarted,
  challengeStartedSchema,
  type startMagicLinkSchema,
} from "@idenzy/protocol/schemas/auth";
import type { z } from "zod";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import { SessionFlow } from "./session-flow.js";

export type StartMagicLinkInput = z.input<typeof startMagicLinkSchema>;

/**
 * Magic links, and the two halves happen in different browsers (PROJECT.md 4.7).
 *
 * That is the whole shape of this class. `start` runs where the form is, the link is opened
 * wherever the mail was read, and `exchange` runs on the customer's own route with the code
 * we redirected to it. Nothing is remembered between them, because there is often no
 * "between them": the tab that asked may be closed, and a verifier held there would make the
 * ordinary case fail. That is also why this flow carries no PKCE and OAuth does.
 *
 * `redirectUri` must already be registered for the project. It is pinned to the token when
 * the mail is sent, so the destination cannot change between sending and clicking.
 */
export class MagicLinkFlow extends SessionFlow {
  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the client build one.
  constructor(api: ApiClient, sessions: SessionManager) {
    super(api, sessions);
  }

  start(input: StartMagicLinkInput): Promise<ChallengeStarted> {
    return this.api.send(challengeStartedSchema, {
      method: "POST",
      path: "v1/auth/magic-link/start",
      body: input,
    });
  }

  /** Called on the landing route with the `code` query parameter we sent it. */
  exchange(code: string): Promise<Session> {
    return this.establish({
      method: "POST",
      path: "v1/auth/magic-link/exchange",
      body: { code },
    });
  }
}
