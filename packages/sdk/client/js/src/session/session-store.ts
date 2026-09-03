import type { PublicUser } from "@idenzy/protocol/schemas/user";
import type { Idenzy } from "../idenzy.js";

/**
 * What a view sees, and the reason it has a third status.
 *
 * `Idenzy` knows only signed-in and signed-out, which is the truth about the client at any
 * instant. A view needs one more: the moment before the first rotation has come back, when
 * the answer is not yet known. Without it every application renders its signed-out screen for
 * one frame on every load, which is a sign-in form flashed at somebody already signed in.
 *
 * `user` can be null while the status is `signed-in`, and only on a server-rendered first
 * paint. The access token names the user and does not carry the profile, so a server that
 * verified a cookie knows `userId` and `sessionId` and would have to fetch to know more.
 */
export interface SessionSnapshot {
  readonly status: "loading" | "signed-in" | "signed-out";
  readonly userId: string | null;
  readonly user: PublicUser | null;
  readonly sessionId: string | null;
}

export interface SessionStoreOptions {
  /**
   * Whether to pick up a session left by a previous page load. On by default, because the
   * alternative is an application that starts signed out on every refresh.
   */
  readonly restore?: boolean;
  /**
   * What a server already worked out, so the first paint is not a guess.
   *
   * A framework that renders on a server verifies the session cookie there and passes the
   * answer here. Both sides then start from the same snapshot, which is what stops hydration
   * from swapping a signed-out tree for a signed-in one in front of the user.
   *
   * Null is an answer and absent is not, and every SSR helper we ship returns the first. Null
   * says a server looked and could not place the visitor, which is the ordinary case for an
   * expired access token over a live refresh cookie: the store holds `loading` and the browser
   * settles it. Absent says nobody consulted a server, so `restore: false` leaves the client's
   * own position standing, and a client holding nothing says signed out.
   */
  readonly initial?: SessionSnapshot | null;
}

export const LOADING_SESSION: SessionSnapshot = Object.freeze({
  status: "loading",
  userId: null,
  user: null,
  sessionId: null,
});

const SIGNED_OUT: SessionSnapshot = Object.freeze({
  status: "signed-out",
  userId: null,
  user: null,
  sessionId: null,
});

/**
 * The framework-agnostic half of every binding we ship.
 *
 * React, Vue, Svelte and Angular each have their own way of holding external state and the
 * same three problems underneath, so this is written once rather than four times. The
 * snapshot is referentially stable between changes, because React reads it on every render
 * and a fresh object each time is an infinite loop rather than a slow component. It has an
 * answer before anything has subscribed, because the first render happens before the first
 * effect. And restoring runs once per store however often it is asked for.
 *
 * It attaches to the client only while something is listening, so a component tree that
 * unmounts leaves nothing hanging off a client that outlives it, which is the normal case:
 * the client is built once, at module scope, and the views come and go.
 */
export class SessionStore {
  private current: SessionSnapshot;
  private readonly initial: SessionSnapshot;
  private restored: boolean;
  /**
   * Whether the client has an opinion yet.
   *
   * Until it does, what it reports is not an answer: a client that has not rotated says
   * signed-out because it has nothing, not because nobody is signed in. That is the whole
   * difference between the seed a server worked out and the client's opening position, and
   * publishing the second over the first is how a server-rendered signed-in page turns into a
   * sign-in screen the moment a component subscribes.
   */
  private looked: boolean;
  private readonly listeners = new Set<() => void>();
  private detach: (() => void) | null = null;

  constructor(
    private readonly client: Idenzy,
    options: SessionStoreOptions = {},
  ) {
    const restores = options.restore ?? true;
    this.initial = options.initial ?? LOADING_SESSION;
    this.restored = !restores;
    this.looked = !restores && options.initial === undefined;
    // The client's own position stands only where `looked` says it is an answer, which is
    // where nothing is going to restore and no server offered one. A null seed is a server
    // that looked and could not tell, so it lands here as `loading` rather than as nothing.
    this.current = options.initial ?? (this.looked ? snapshotOf(client) : LOADING_SESSION);
  }

  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    this.attach();
    return () => {
      this.listeners.delete(onChange);
      if (this.listeners.size === 0) this.release();
    };
  };

  readonly snapshot = (): SessionSnapshot => this.current;

  /**
   * What a server renders: whatever it was seeded with, and otherwise the honest answer that
   * nobody knows yet.
   *
   * Answering signed-out instead would put the signed-out tree in the HTML and swap it on
   * hydration, which is the flash this class exists to prevent, moved earlier.
   */
  readonly serverSnapshot = (): SessionSnapshot => this.initial;

  /**
   * Picks up a session from a previous page load, once per store however often it is called.
   *
   * React 19 runs an effect, cleans it up and runs it again in development, so this is called
   * twice on every mount. The guard is what makes the second call free; the rotation
   * underneath is single-flight anyway, which is what keeps two calls from spending one
   * refresh token twice and revoking the family for it (ADR-0007).
   */
  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    try {
      await this.client.restore();
    } finally {
      this.looked = true;
      this.publish(snapshotOf(this.client));
    }
  }

  /**
   * Starts following the client, skipping the echo.
   *
   * `Idenzy.subscribe` calls its listener immediately, which is what a component wants and
   * what this does not: that first call reports the client's opening position, and before the
   * client has looked, its opening position is not an answer. Every later emission is one,
   * because something happened to cause it.
   *
   * Re-attaching resyncs where the client is known to have an opinion, so a store whose last
   * subscriber left and came back does not show what was true when they left.
   */
  private attach(): void {
    if (this.detach !== null) return;
    let echo = true;
    this.detach = this.client.subscribe(() => {
      if (echo) return;
      this.looked = true;
      this.publish(snapshotOf(this.client));
    });
    echo = false;
    if (this.looked || this.client.session !== null) this.publish(snapshotOf(this.client));
  }

  private release(): void {
    this.detach?.();
    this.detach = null;
  }

  private publish(next: SessionSnapshot): void {
    if (same(this.current, next)) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}

/** The client's own state, in the shape a view reads. */
export function snapshotOf(client: Idenzy): SessionSnapshot {
  const state = client.state();
  if (state.status === "signed-out" || state.user === null) return SIGNED_OUT;
  return {
    status: "signed-in",
    userId: state.user.id,
    user: state.user,
    sessionId: state.sessionId,
  };
}

/**
 * What a server knows from a verified token: who and which session, and no profile.
 *
 * Seeding with this is the point of `SessionStoreOptions.initial`. A view that needs the
 * profile on the first paint has to be given one, because the token does not carry it.
 */
export function seededSession(userId: string, sessionId: string): SessionSnapshot {
  return { status: "signed-in", userId, user: null, sessionId };
}

/** Compared field by field, so a re-emitted identical state does not re-render anything. */
function same(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return (
    a.status === b.status &&
    a.sessionId === b.sessionId &&
    a.userId === b.userId &&
    a.user === b.user
  );
}
