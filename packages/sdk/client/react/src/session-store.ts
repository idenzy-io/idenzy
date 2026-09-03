import type { Idenzy } from "@idenzy/js";
import type { PublicUser } from "@idenzy/protocol/schemas/user";

/**
 * What a component sees, and the reason it has a third status.
 *
 * `@idenzy/js` knows only signed-in and signed-out, which is the truth about the client at
 * any instant. A component needs one more: the moment before the first rotation has come
 * back, when the answer is not yet known. Without it every application renders its signed-out
 * screen for one frame on every load, which is the flash of a sign-in form in front of a user
 * who is already signed in.
 */
export interface SessionSnapshot {
  readonly status: "loading" | "signed-in" | "signed-out";
  readonly user: PublicUser | null;
  readonly sessionId: string | null;
}

const LOADING: SessionSnapshot = { status: "loading", user: null, sessionId: null };
const SIGNED_OUT: SessionSnapshot = { status: "signed-out", user: null, sessionId: null };

/**
 * The `useSyncExternalStore` half of this package, and the only stateful thing in it.
 *
 * Two obligations that store owes React and the client does not. The snapshot has to be
 * referentially stable between changes, because `getSnapshot` is called on every render and a
 * fresh object each time is an infinite loop rather than a slow component. And it must have
 * an answer before anyone has subscribed, because the first render happens before the first
 * effect.
 *
 * It subscribes to the client only while React is listening. A provider that unmounts leaves
 * nothing attached to a client that outlives it, which is the normal case: the client is
 * built once, module scope, and the tree under it comes and goes.
 */
export class SessionStore {
  private snapshot: SessionSnapshot;
  private restored: boolean;
  private readonly listeners = new Set<() => void>();
  private detach: (() => void) | null = null;

  constructor(
    private readonly client: Idenzy,
    restores: boolean,
  ) {
    this.restored = !restores;
    this.snapshot = restores ? LOADING : fromClient(client);
  }

  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    this.attach();
    return () => {
      this.listeners.delete(onChange);
      if (this.listeners.size === 0) this.release();
    };
  };

  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  /**
   * There is no client on a server, so the answer there is the honest one: not known yet.
   *
   * Returning signed-out instead would render the signed-out tree into the HTML and then
   * swap it on hydration, which is the flash this class exists to avoid, moved earlier.
   */
  readonly getServerSnapshot = (): SessionSnapshot => LOADING;

  /**
   * Picks up a session from a previous page load, once per store however often it is called.
   *
   * React 19 runs an effect, cleans it up and runs it again in development, so this is called
   * twice on every mount. Only the guard here makes that free; the rotation underneath is
   * single-flight anyway, which is what keeps two calls from spending one refresh token twice
   * and revoking the family for it (ADR-0007).
   */
  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    try {
      await this.client.restore();
    } finally {
      this.publish(fromClient(this.client));
    }
  }

  private attach(): void {
    this.detach ??= this.client.subscribe(() => {
      // Ignored until the first restore settles, so a client that starts signed-out cannot
      // answer the question before it has been asked.
      if (this.restored) this.publish(fromClient(this.client));
    });
  }

  private release(): void {
    this.detach?.();
    this.detach = null;
  }

  private publish(next: SessionSnapshot): void {
    if (same(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

function fromClient(client: Idenzy): SessionSnapshot {
  const state = client.state();
  return state.status === "signed-out"
    ? SIGNED_OUT
    : { status: "signed-in", user: state.user, sessionId: state.sessionId };
}

/** Compared field by field, so a re-emitted identical state does not re-render the tree. */
function same(a: SessionSnapshot, b: SessionSnapshot): boolean {
  return a.status === b.status && a.sessionId === b.sessionId && a.user === b.user;
}
