import { type Clock, SystemClock } from "@idenzy/core/time/clock";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { AccountApi } from "./account/account-api.js";
import type { Navigation } from "./browser/navigation.js";
import { WindowNavigation } from "./browser/navigation.js";
import { IdenzyConfig, type IdenzyOptions } from "./config.js";
import { AnonymousFlow } from "./flows/anonymous-flow.js";
import { MagicLinkFlow } from "./flows/magic-link-flow.js";
import { OtpFlow } from "./flows/otp-flow.js";
import { PasswordFlow } from "./flows/password-flow.js";
import { ApiClient } from "./http/api-client.js";
import { FetchTransport, type Transport } from "./http/transport.js";
import { TransportMode } from "./http/transport-mode.js";
import { MfaApi } from "./mfa/mfa-api.js";
import { OAuthFlow } from "./oauth/oauth-flow.js";
import { type PkceStore, SessionStoragePkceStore } from "./oauth/pkce-store.js";
import { PasskeyFlow } from "./passkey/passkey-flow.js";
import { type RefreshLock, WebLocksRefreshLock } from "./session/refresh-lock.js";
import { MemoryRefreshTokenStore, type RefreshTokenStore } from "./session/refresh-token-store.js";
import type { Session } from "./session/session.js";
import {
  type SessionListener,
  SessionManager,
  type SessionState,
} from "./session/session-manager.js";
import { SessionsApi } from "./session/sessions-api.js";
import { SignIn } from "./sign-in.js";
import { SignUp } from "./sign-up.js";

/**
 * The pieces a host or a test replaces.
 *
 * Separate from `IdenzyOptions` because these are collaborators and that is configuration.
 * Everything here has a working default for a browser; the ones worth replacing are the
 * refresh token store on a platform with real secure storage, and navigation on a host where
 * "go to the provider" means opening a system browser rather than replacing the document.
 */
export interface IdenzyInternals {
  readonly transport?: Transport;
  readonly clock?: Clock;
  readonly refreshTokens?: RefreshTokenStore;
  readonly refreshLock?: RefreshLock;
  readonly pkce?: PkceStore;
  readonly navigation?: Navigation;
}

/**
 * The client a customer holds, and the composition root of this SDK.
 *
 * There is one object graph, built here, with every collaborator in a constructor. Nothing in
 * this package reaches for a singleton, which is what lets two clients for two projects exist
 * in one page and what lets a test build the whole thing with no network at all.
 *
 * What it does not contain is any UI. Every method takes values and returns values or throws
 * a coded error, and the screens are the customer's (PROJECT.md 1.1).
 */
export class Idenzy {
  readonly signIn: SignIn;
  readonly signUp: SignUp;
  readonly password: PasswordFlow;
  readonly otp: OtpFlow;
  readonly magicLink: MagicLinkFlow;
  readonly oauth: OAuthFlow;
  readonly passkeys: PasskeyFlow;
  readonly anonymous: AnonymousFlow;
  readonly account: AccountApi;
  readonly sessions: SessionsApi;
  readonly mfa: MfaApi;

  private readonly manager: SessionManager;

  constructor(options: IdenzyOptions, internals: IdenzyInternals = {}) {
    const config = IdenzyConfig.parse(options);
    const mode = new TransportMode(config.sessionTransport);
    const api = new ApiClient(
      config,
      internals.transport ?? new FetchTransport(options.fetch),
      mode,
    );
    this.manager = new SessionManager(
      api,
      mode,
      internals.refreshTokens ?? new MemoryRefreshTokenStore(),
      internals.clock ?? new SystemClock(),
      internals.refreshLock ?? new WebLocksRefreshLock(config.publishableKey),
    );

    this.password = new PasswordFlow(api, this.manager);
    this.otp = new OtpFlow(api, this.manager);
    this.magicLink = new MagicLinkFlow(api, this.manager);
    this.oauth = new OAuthFlow(
      api,
      this.manager,
      internals.pkce ?? new SessionStoragePkceStore(),
      internals.navigation ?? new WindowNavigation(),
    );
    this.passkeys = new PasskeyFlow(api, this.manager);
    this.anonymous = new AnonymousFlow(api, this.manager);
    this.account = new AccountApi(api, this.manager);
    this.sessions = new SessionsApi(api, this.manager);
    this.mfa = new MfaApi(api, this.manager);
    this.signIn = new SignIn(
      this.password,
      this.otp,
      this.magicLink,
      this.oauth,
      this.passkeys,
      this.anonymous,
    );
    this.signUp = new SignUp(this.password);
  }

  get user(): PublicUser | null {
    return this.manager.user;
  }

  get session(): Session | null {
    return this.manager.session;
  }

  /**
   * Picks up a session from a previous page load. Call it once, at start-up.
   *
   * In cookie mode this is how an application comes back signed in: the browser has a cookie
   * this SDK cannot read, so the only way to find out is to rotate it and ask for the profile
   * in the same round trip. In header mode with the default store there is nothing to find,
   * and it answers null without a request.
   */
  restore(): Promise<Session | null> {
    return this.manager.restore();
  }

  /** A token for the customer's own API calls, renewed if it is close to expiry. */
  getToken(): Promise<string | null> {
    return this.manager.getToken();
  }

  /** `all` ends every session the user holds, not only this one. */
  signOut(scope: "current" | "all" = "current"): Promise<void> {
    return this.manager.signOut(scope);
  }

  /** Called immediately with the current state, then on every change. Returns the unsubscribe. */
  subscribe(listener: SessionListener): () => void {
    return this.manager.subscribe(listener);
  }

  state(): SessionState {
    return this.manager.state();
  }
}
