import {
  OauthProviderError,
  OauthStateInvalidError,
  RedirectUriNotAllowedError,
} from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type { ProviderId } from "@idenzy/protocol/enums/providers";

/** What a project configured for one provider. Secrets arrive decrypted. */
export interface ProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: readonly string[];
  /** Provider-specific extras: Apple's team and key ids, a generic OIDC issuer. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** The in-flight state of one authorization, as the store hands it back. */
export interface StoredFlow {
  readonly id: string;
  readonly provider: string;
  readonly codeVerifier: string;
  readonly nonce: string | null;
  readonly redirectUri: string;
  /** Set when the flow was started to attach a provider to an existing session. */
  readonly linkUserId: string | null;
  readonly expiresAt: Date;
  /**
   * The SDK's PKCE challenge for the exchange code this flow will mint. Not to be confused
   * with `codeVerifier`, which is ours for the provider: two PKCE instances, opposite roles.
   */
  readonly clientCodeChallenge: string | null;
}

export interface NewFlow {
  readonly provider: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string | null;
  readonly redirectUri: string;
  readonly linkUserId: string | null;
  readonly expiresAt: Date;
  /**
   * The SDK's PKCE challenge for the exchange code this flow will mint. Not to be confused
   * with `codeVerifier`, which is ours for the provider: two PKCE instances, opposite roles.
   */
  readonly clientCodeChallenge: string | null;
}

/**
 * The in-flight authorization store.
 *
 * `consume` is single use by contract. Returning the same flow twice would make `state`
 * a replayable value rather than a one-shot CSRF token, so the implementation decides it
 * in the database and not in application code.
 */
export interface OAuthFlowStore {
  start(projectId: string, flow: NewFlow): Promise<string>;
  consume(projectId: string, provider: string, state: string, at: Date): Promise<StoredFlow | null>;
}

export interface RedirectAllowlist {
  isAllowed(projectId: string, uri: string): Promise<boolean>;
}

/** What the provider gave us in exchange for the code. */
export interface TokenGrant {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
  readonly expiresAt: Date | null;
}

/** A provider account, normalized. The shape every adapter maps onto. */
export interface ProviderProfile {
  readonly providerUserId: string;
  readonly email: string | null;
  /**
   * Whether the provider itself asserts the address is verified.
   *
   * The single most consequential field in this file. Linking on an address the provider
   * has not verified is the classic IdP account takeover, so an adapter that cannot tell
   * must say false (PROJECT.md 4.6).
   */
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export interface AuthorizationRequest {
  readonly state: string;
  readonly nonce: string | null;
  /** S256 challenge. The verifier stays in the flow store until the exchange. */
  readonly codeChallenge: string;
  /** Our own callback, as registered with the provider. Not the customer's route. */
  readonly callbackUri: string;
}

export interface OAuthCallback {
  readonly provider: string;
  readonly state: string;
  readonly code: string;
  readonly callbackUri: string;
}

export interface CompletedFlow {
  readonly profile: ProviderProfile;
  readonly grant: TokenGrant;
  readonly flow: StoredFlow;
}

/**
 * Base for every social provider (PROJECT.md 4.6, 7.2).
 *
 * `completeFlow` is the reason this class exists. Its ordering is inherited and a
 * subclass cannot reach it: the state is consumed before anything else happens, the
 * redirect target is checked against the project's allowlist, the code is exchanged with
 * the PKCE verifier attached, and only then does provider-specific mapping run. A new
 * adapter is endpoints and a profile mapping, and it cannot omit a security step because
 * it never sees one.
 *
 * The three checks in order, and what each is for:
 *
 * 1. **State.** Consumed from the store, single use. A callback carrying a state we did
 *    not issue, or one already spent, is a forged callback and is refused before the
 *    code is worth anything.
 * 2. **Redirect allowlist.** Re-checked at callback and not only at start, because the
 *    pinned value is what the browser will actually be sent to, and a target that was
 *    removed from the allowlist in between must stop working.
 * 3. **Issuer.** Checked by the OIDC layer against the id_token, which is the mix-up
 *    defence: without it, a code obtained from a provider the attacker controls can be
 *    presented at a provider we trust.
 */
export abstract class OAuthProvider {
  protected constructor(
    protected readonly http: HttpClient,
    protected readonly clock: Clock,
    protected readonly flows: OAuthFlowStore,
    protected readonly allowlist: RedirectAllowlist,
  ) {}

  abstract readonly id: ProviderId;

  protected abstract authorizeEndpoint(credentials: ProviderCredentials): string;
  protected abstract tokenEndpoint(credentials: ProviderCredentials): string;
  /** The scopes to request when a project has not chosen its own. */
  protected abstract defaultScopes(): readonly string[];
  /** Provider-shaped profile fetch. Runs only after every check above has passed. */
  protected abstract fetchProfile(
    credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile>;

  /**
   * Where to send the browser to begin.
   *
   * PKCE is unconditional. It is not only for public clients: it binds the code to this
   * flow, so a code intercepted at the redirect is useless without the verifier that
   * never left our database.
   */
  authorizationUrl(credentials: ProviderCredentials, request: AuthorizationRequest): string {
    const url = new URL(this.authorizeEndpoint(credentials));
    const scopes = credentials.scopes.length > 0 ? credentials.scopes : this.defaultScopes();
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", request.callbackUri);
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", request.state);
    url.searchParams.set("code_challenge", request.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (request.nonce !== null) url.searchParams.set("nonce", request.nonce);
    this.decorateAuthorization(url, credentials);
    return url.toString();
  }

  /** Template method. The ordering is the security property; do not override it. */
  async completeFlow(
    projectId: string,
    credentials: ProviderCredentials,
    callback: OAuthCallback,
  ): Promise<CompletedFlow> {
    const flow = await this.flows.consume(
      projectId,
      callback.provider,
      callback.state,
      this.clock.now(),
    );
    if (flow === null) throw new OauthStateInvalidError();
    if (flow.expiresAt <= this.clock.now()) throw new OauthStateInvalidError();

    if (!(await this.allowlist.isAllowed(projectId, flow.redirectUri))) {
      throw new RedirectUriNotAllowedError();
    }

    const grant = await this.exchangeCode(credentials, callback, flow);
    await this.assertGrantIntegrity(credentials, grant, flow);
    const profile = await this.fetchProfile(credentials, grant);
    assertUsable(profile, this.id);

    return { profile, grant, flow };
  }

  /**
   * The authorization code grant, with the PKCE verifier attached.
   *
   * Written once here rather than per adapter, because every provider we support speaks
   * RFC 6749 for this exact call and the one that does not can override `tokenRequest`.
   */
  protected async exchangeCode(
    credentials: ProviderCredentials,
    callback: OAuthCallback,
    flow: StoredFlow,
  ): Promise<TokenGrant> {
    const response = await this.http.json<Readonly<Record<string, unknown>>>({
      url: this.tokenEndpoint(credentials),
      method: "POST",
      headers: this.tokenHeaders(credentials),
      form: await this.tokenRequest(credentials, callback, flow),
    });
    if (response.status >= 400) {
      // The provider's own error code is kept internal. Echoing it would hand a prober a
      // description of our client configuration.
      throw new OauthProviderError({
        detail: { provider: this.id, statusCode: response.status, body: response.data },
      });
    }
    return this.mapGrant(response.data);
  }

  /**
   * Headers on the token request, and empty for almost every provider.
   *
   * The exception is a provider that requires HTTP Basic client authentication rather than
   * credentials in the body: X does, and RFC 6749 forbids presenting both, so such an adapter
   * fills this in and drops `client_secret` from `tokenRequest`.
   */
  protected tokenHeaders(_credentials: ProviderCredentials): Record<string, string> {
    return {};
  }

  protected tokenRequest(
    credentials: ProviderCredentials,
    callback: OAuthCallback,
    flow: StoredFlow,
  ): Promise<Record<string, string>> {
    return Promise.resolve({
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: callback.callbackUri,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code_verifier: flow.codeVerifier,
    });
  }

  protected mapGrant(raw: Readonly<Record<string, unknown>>): TokenGrant {
    const accessToken = typeof raw["access_token"] === "string" ? raw["access_token"] : null;
    if (accessToken === null) {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "token response carried no access_token" },
      });
    }
    const expiresIn = typeof raw["expires_in"] === "number" ? raw["expires_in"] : null;
    return {
      accessToken,
      refreshToken: typeof raw["refresh_token"] === "string" ? raw["refresh_token"] : null,
      idToken: typeof raw["id_token"] === "string" ? raw["id_token"] : null,
      expiresAt: expiresIn === null ? null : this.clock.inSeconds(expiresIn),
    };
  }

  /**
   * The mix-up defence, and a no-op for plain OAuth 2.
   *
   * `OidcProvider` overrides it to verify the id_token signature, issuer, audience and
   * nonce. It is declared here rather than there so the call site is in the inherited
   * ordering: a future non-OIDC provider that needs its own integrity check has a place
   * to put it that runs before the profile is trusted.
   */
  protected assertGrantIntegrity(
    _credentials: ProviderCredentials,
    _grant: TokenGrant,
    _flow: StoredFlow,
  ): Promise<void> {
    return Promise.resolve();
  }

  /** Extra authorization parameters a provider requires. Most need none. */
  protected decorateAuthorization(_url: URL, _credentials: ProviderCredentials): void {}
}

/**
 * A profile with no stable subject is unusable: it is the only thing that makes a
 * returning user the same user, so accepting one without it would create a new account
 * on every sign-in.
 */
function assertUsable(profile: ProviderProfile, provider: string): void {
  if (profile.providerUserId.length === 0) {
    throw new OauthProviderError({
      detail: { provider, reason: "the profile carried no stable subject" },
    });
  }
}
