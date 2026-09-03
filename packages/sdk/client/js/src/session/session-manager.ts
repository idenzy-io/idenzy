import { MissingCredentialsError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import type { SessionCreated } from "@idenzy/protocol/schemas/session";
import { sessionRefreshedSchema } from "@idenzy/protocol/schemas/session";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { IdenzyApiError, IdenzyTransportError } from "../errors.js";
import type { ApiClient } from "../http/api-client.js";
import type { TransportMode } from "../http/transport-mode.js";
import type { RefreshLock } from "./refresh-lock.js";
import type { RefreshTokenStore } from "./refresh-token-store.js";
import { Session } from "./session.js";

/**
 * How close to expiry a token is renewed. Covers a client clock running fast and the flight
 * time of the request the token is about to be attached to, against a five-minute default.
 */
const RENEW_MARGIN_MS = 30_000;

export interface SessionState {
  readonly status: "signed-in" | "signed-out";
  readonly user: PublicUser | null;
  readonly sessionId: string | null;
}

export type SessionListener = (state: SessionState) => void;

/**
 * Holds the session and is the only thing that renews it.
 *
 * Two decisions here are worth more than the code. Refresh is single-flight, because a page
 * that mounts six components on load would otherwise fire six rotations, and rotation is
 * exactly the operation where using a token twice means reuse detection revokes the whole
 * family. The first caller rotates, the rest await the same promise, and the other tabs wait
 * on a lock.
 *
 * And renewal is lazy rather than timed. A background timer keeps a session alive in a tab
 * nobody is looking at, which quietly converts an idle timeout into no timeout at all; asking
 * at the moment a token is needed costs one extra round trip on a stale token and nothing at
 * all the rest of the time.
 */
export class SessionManager {
  private current: Session | null = null;
  private pending: Promise<Session> | null = null;
  /**
   * Set once a rotation has come back refused, and cleared the moment a session is adopted.
   *
   * Without it a signed-out page asks the server again on every call that wants a token, which
   * on a public landing page is a request per component. `restore()` clears it, because that
   * call is a deliberate "check again" and the answer may have changed in another tab.
   */
  private knownSignedOut = false;
  private readonly listeners = new Set<SessionListener>();

  constructor(
    private readonly api: ApiClient,
    private readonly mode: TransportMode,
    private readonly tokens: RefreshTokenStore,
    private readonly clock: Clock,
    private readonly lock: RefreshLock,
  ) {}

  get session(): Session | null {
    return this.current;
  }

  get user(): PublicUser | null {
    return this.current?.user ?? null;
  }

  /** Takes a freshly issued session, storing the refresh token where the mode expects it. */
  adopt(created: SessionCreated): Session {
    this.knownSignedOut = false;
    if (created.refreshToken !== undefined) this.tokens.write(created.refreshToken);
    const session = Session.fromCreated(created);
    this.set(session);
    return session;
  }

  /**
   * A token good for the next request, or null when nobody is signed in.
   *
   * Signing out is a state and not an exception, so a refused credential ends here as null
   * with the listeners told. Anything else, a network failure or a rate limit, is thrown: it
   * is not a state change and must not be able to look like one.
   */
  async getToken(): Promise<string | null> {
    const current = this.current;
    if (current !== null && !current.expiresWithin(RENEW_MARGIN_MS, this.clock.nowMs())) {
      return current.accessToken;
    }
    if (current === null && !this.canRefresh()) return null;
    const renewed = await this.tryRefresh();
    return renewed === null ? null : renewed.accessToken;
  }

  /**
   * The token, or the same refusal the server would have given.
   *
   * Used by everything that acts on an existing account. It throws the class the API throws,
   * so a customer's handler branches on `missing_credentials` without caring whether the
   * request was refused or never sent.
   */
  async requireToken(): Promise<string> {
    const token = await this.getToken();
    if (token === null) throw new MissingCredentialsError();
    return token;
  }

  /**
   * Picks up a session left behind by a previous page load.
   *
   * In cookie mode that is the normal way an application starts: the browser has the cookie
   * and the SDK has nothing, so the first thing it does is rotate and ask for the profile in
   * the same round trip.
   */
  restore(): Promise<Session | null> {
    this.knownSignedOut = false;
    if (!this.canRefresh()) return Promise.resolve(null);
    return this.tryRefresh();
  }

  /**
   * Rotates the refresh token, once for this tab and once across all of them.
   *
   * Two layers, because they solve different halves of the same problem. The promise covers
   * components sharing a tab; the lock covers tabs sharing a cookie, which is the case a
   * promise cannot see and the one that signs a user out of every device (ADR-0007).
   */
  refresh(): Promise<Session> {
    this.pending ??= this.lock
      .run(() => this.rotate())
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /**
   * Ends the session server-side, then locally whatever the server said.
   *
   * The local half runs even when the request fails, because the alternative is an
   * application that shows a signed-in user after they pressed sign out. A token we have
   * already stopped presenting is worth less than that impression.
   */
  async signOut(scope: "current" | "all" = "current"): Promise<void> {
    const presented = this.tokens.read();
    try {
      await this.api.sendVoid({
        method: "POST",
        path: "v1/auth/sign-out",
        body: { scope, ...(presented === null ? {} : { refreshToken: presented }) },
        accessToken: this.current?.accessToken,
      });
    } finally {
      this.clear();
    }
  }

  clear(): void {
    this.knownSignedOut = true;
    this.tokens.clear();
    this.set(null);
  }

  /**
   * Swaps the access token for a newer one on the same session, after a step-up.
   *
   * Nothing else about the session changed, so the refresh token is untouched: rotating the
   * credential that mints tokens because a check only read one would be a rotation nobody
   * asked for, and rotation is the operation where doing it twice revokes the family.
   */
  replaceToken(accessToken: string, expiresAt: Date): Session {
    const current = this.current;
    if (current === null) throw new MissingCredentialsError();
    // No emit: the status, the user and the session id are all the same, and a listener
    // watching for a change would be woken for one that did not happen.
    const next = current.withToken(accessToken, expiresAt);
    this.set(next);
    return next;
  }

  /**
   * Replaces the profile without touching the tokens, for the reads that return a newer one.
   *
   * Always tells the listeners, unlike `set`: the status has not changed, and a changed
   * display name or a newly verified address is exactly what a subscriber is watching for.
   */
  updateUser(user: PublicUser): void {
    if (this.current === null) return;
    this.current = this.current.withUser(user);
    this.emit(this.state());
  }

  /** Called immediately with the current state, so a subscriber never has to ask twice. */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => {
      this.listeners.delete(listener);
    };
  }

  state(): SessionState {
    const current = this.current;
    if (current === null) return { status: "signed-out", user: null, sessionId: null };
    return { status: "signed-in", user: current.user, sessionId: current.id };
  }

  private async tryRefresh(): Promise<Session | null> {
    try {
      return await this.refresh();
    } catch (error: unknown) {
      if (!isRefusal(error)) throw error;
      this.clear();
      return null;
    }
  }

  private async rotate(): Promise<Session> {
    const previous = this.current;
    const presented = this.tokens.read();
    const refreshed = await this.api.send(sessionRefreshedSchema, {
      method: "POST",
      path: "v1/auth/refresh",
      // Asked for only when we have none. The rotation loads the user anyway to check the
      // account may still sign in, so this costs the bytes and saves a second round trip on
      // every page load; a routine rotation should not re-send a profile nothing will read.
      body: {
        includeUser: previous === null,
        ...(presented === null ? {} : { refreshToken: presented }),
      },
    });
    if (refreshed.refreshToken !== undefined) this.tokens.write(refreshed.refreshToken);
    const session = Session.fromRefreshed(refreshed, userFor(refreshed.user, previous));
    this.set(session);
    return session;
  }

  /**
   * Cookie mode may hold a credential this client cannot see, so it always tries.
   *
   * Read at the moment of the call, never cached. A client negotiating its transport starts
   * optimistic, and a cached answer from before the first request would keep asking a server
   * that has already said no.
   */
  private canRefresh(): boolean {
    if (this.knownSignedOut) return false;
    return this.mode.usesCookies || this.tokens.read() !== null;
  }

  private set(session: Session | null): void {
    const before = this.state();
    this.current = session;
    const after = this.state();
    if (before.status === after.status && before.sessionId === after.sessionId) return;
    this.emit(after);
  }

  private emit(state: SessionState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error: unknown) {
        // One subscriber's bug must not stop the others being told, and must not be
        // swallowed either. Rethrown out of band, where it lands in the console as itself.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}

/** The server answered and refused the credential. A 429 or a 500 may still be transient. */
function isRefusal(error: unknown): boolean {
  return error instanceof IdenzyApiError && (error.status === 401 || error.status === 403);
}

function userFor(returned: PublicUser | undefined, previous: Session | null): PublicUser {
  const user = returned ?? previous?.user;
  if (user === undefined) {
    throw new IdenzyTransportError("The refresh did not return the profile it was asked for.");
  }
  return user;
}
