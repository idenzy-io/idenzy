import type { ProviderId } from "@idenzy/protocol/enums/providers";
import { authorizationStartedSchema } from "@idenzy/protocol/schemas/auth";
import type { Navigation } from "../browser/navigation.js";
import { codeFromRedirect } from "../browser/redirect-result.js";
import { SessionFlow } from "../flows/session-flow.js";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import { PkceChallenge } from "./pkce.js";
import type { PkceStore } from "./pkce-store.js";

export interface StartOAuthInput {
  readonly provider: ProviderId | string;
  /** Where we send the browser afterwards. Must already be registered for the project. */
  readonly redirectUri: string;
}

/**
 * Social sign-in from a browser (PROJECT.md 4.6).
 *
 * The URL is asked for over JSON and the navigation is ours, which is what lets this work on
 * the shared API host: a top-level navigation carries no publishable-key header, so a link
 * straight to the start route can only resolve a project by `Host` and therefore only behind
 * a custom auth domain.
 *
 * PKCE is on our own exchange code, not the provider's. The code lands in the customer's URL
 * bar and from there in history, in a `Referer` and in their access logs, so the verifier this
 * browser kept is what makes a copied code worthless.
 */
export class OAuthFlow extends SessionFlow {
  constructor(
    api: ApiClient,
    sessions: SessionManager,
    private readonly pkce: PkceStore,
    private readonly navigation: Navigation,
  ) {
    super(api, sessions);
  }

  /** Sends the browser to the provider. Nothing after this call runs on this page. */
  async signIn(input: StartOAuthInput): Promise<void> {
    this.navigation.assign(await this.authorizationUrl(input));
  }

  /** The same URL without the navigation, for a host that opens its own browser. */
  authorizationUrl(input: StartOAuthInput): Promise<string> {
    return this.authorize(`v1/auth/oauth/${input.provider}/start`, input, undefined);
  }

  /**
   * Attaching a provider to the account already signed in here.
   *
   * The user is taken from the token rather than the request, so the callback links to the
   * caller and not to whoever the provider turns out to be.
   */
  async link(input: StartOAuthInput): Promise<void> {
    this.navigation.assign(await this.linkUrl(input));
  }

  async linkUrl(input: StartOAuthInput): Promise<string> {
    const token = await this.sessions.requireToken();
    return this.authorize(`v1/auth/oauth/${input.provider}/link`, input, token);
  }

  /** Finishes on the customer's own route, or does nothing when there is no code there. */
  completeFromRedirect(): Promise<Session | null> {
    const code = codeFromRedirect(this.navigation.current());
    return code === null ? Promise.resolve(null) : this.exchange(code);
  }

  /** The single-use code from our redirect, spent with the verifier this browser kept. */
  exchange(code: string): Promise<Session> {
    const verifier = this.pkce.take();
    return this.establish({
      method: "POST",
      path: "v1/auth/oauth/exchange",
      body: { code, ...(verifier === null ? {} : { codeVerifier: verifier }) },
    });
  }

  private async authorize(
    path: string,
    input: StartOAuthInput,
    accessToken: string | undefined,
  ): Promise<string> {
    const pkce = await PkceChallenge.create();
    // Saved before the request, not after. The flow the server records is bound to this
    // challenge from the moment it answers, and a verifier stored afterwards is one an
    // interrupted page load can lose while the flow it belongs to is already live.
    this.pkce.save(pkce.verifier);
    const started = await this.api.send(authorizationStartedSchema, {
      method: "POST",
      path,
      body: { redirectUri: input.redirectUri, codeChallenge: pkce.challenge },
      accessToken,
    });
    return started.authorizationUrl;
  }
}
