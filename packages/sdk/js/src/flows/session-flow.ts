import { sessionCreatedSchema } from "@idenzy/protocol/schemas/session";
import type { ApiClient, RequestSpec } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";

/**
 * Base for every flow that ends in a session.
 *
 * The inherited part is the ending, and that is the whole reason this class exists. A flow
 * that posted its credentials and returned the body would look like it worked: the customer
 * gets a user object, their form navigates, and the SDK is still signed out. Nobody finds
 * that until the next `getToken()` returns null, which is a different screen and often a
 * different day. Adopting is not a step a subclass can be trusted to remember, so it is not
 * one a subclass is given (PROJECT.md 7.2.5).
 */
export abstract class SessionFlow {
  protected constructor(
    protected readonly api: ApiClient,
    protected readonly sessions: SessionManager,
  ) {}

  /** Template method: post, parse, adopt. Subclasses choose only the route and the body. */
  protected async establish(spec: RequestSpec): Promise<Session> {
    return this.sessions.adopt(await this.api.send(sessionCreatedSchema, spec));
  }
}
