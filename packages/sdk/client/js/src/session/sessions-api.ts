import { type SessionList, sessionListSchema } from "@idenzy/protocol/schemas/session";
import type { ApiClient } from "../http/api-client.js";
import type { SessionManager } from "./session-manager.js";

/**
 * "Your devices", which is a screen every customer builds and none of them should have to
 * assemble from token state.
 *
 * Everything here is scoped to the signed-in user, never to the id in the path: another
 * user's session id answers 404 rather than revoking anything.
 */
export class SessionsApi {
  constructor(
    private readonly api: ApiClient,
    private readonly sessions: SessionManager,
  ) {}

  /** Most recently active first, with the caller's own marked `current`. */
  async list(): Promise<SessionList> {
    return this.api.send(sessionListSchema, {
      method: "GET",
      path: "v1/sessions",
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * Revoking the session in use signs this client out too.
   *
   * The next request would fail anyway; the difference is that an application which kept
   * showing a signed-in user until then would be showing something that has already ended.
   */
  async revoke(id: string): Promise<void> {
    await this.api.sendVoid({
      method: "DELETE",
      path: `v1/sessions/${encodeURIComponent(id)}`,
      accessToken: await this.sessions.requireToken(),
    });
    if (this.sessions.session?.id === id) this.sessions.clear();
  }
}
