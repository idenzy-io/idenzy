/**
 * The Svelte binding for `@idenzy/js`: a context object holding the client and two stores.
 *
 * Stores rather than runes, deliberately. A store is what `$session` auto-subscribes to, it
 * works in Svelte 4 and 5 and in SvelteKit's server render, and its lifecycle is exactly the
 * one this SDK wants: the underlying subscription is taken when the first subscriber arrives
 * and dropped when the last one leaves.
 *
 * There is no component in this package and there will not be. The sign-in page is the most
 * brand-sensitive surface in most products and it belongs to whoever owns the product
 * (ADR-0002).
 */
import type { Idenzy } from "@idenzy/js";
import { IdenzyConfigurationError } from "@idenzy/js/errors";
import {
  type SessionSnapshot,
  SessionStore,
  type SessionStoreOptions,
} from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { getContext, setContext } from "svelte";
import { derived, type Readable, readable } from "svelte/store";

export type { SessionSnapshot };

export interface IdenzyContext {
  readonly client: Idenzy;
  /**
   * Read `status` rather than testing `user` for null. The three states are distinct and the
   * middle one matters: `loading` is the answer until the first rotation has come back, and
   * treating it as signed out shows a sign-in screen to someone already signed in.
   */
  readonly session: Readable<SessionSnapshot>;
  readonly user: Readable<PublicUser | null>;
}

export interface IdenzyOptions extends SessionStoreOptions {
  /**
   * The client, built once and outside the component tree.
   *
   * An `Idenzy` owns the session, the refresh token and the single-flight promise that keeps
   * one rotation from becoming two. Two clients on one page rotating the same token means the
   * second rotation revokes the whole family (ADR-0007). In SvelteKit that means one per load
   * on the server, not one per process: a client shared between requests is a session shared
   * between people.
   */
  readonly client: Idenzy;
}

const IDENZY = Symbol.for("idenzy");

/**
 * The stores, without touching Svelte's context. Call it where a context is not the shape you
 * want, and in tests.
 *
 * Restoring starts here rather than on first subscribe, because a page whose first component
 * mounts a second late should not take a second to find out who is looking at it.
 */
export function createIdenzy(options: IdenzyOptions): IdenzyContext {
  const store = new SessionStore(options.client, options);
  const session = readable(store.snapshot(), (set) => {
    const stop = store.subscribe(() => set(store.snapshot()));
    // The snapshot may have moved between construction and the first subscriber, and a store
    // that starts on a stale value would show it until the next change.
    set(store.snapshot());
    return stop;
  });

  void store.restore();
  return {
    client: options.client,
    session,
    user: derived(session, (current) => current.user),
  };
}

/**
 * `setIdenzy({ client })` in the root layout, `getIdenzy()` anywhere below it.
 *
 * Context rather than a module-level singleton, because a module-level one is shared between
 * requests on a server and a session shared between requests is the worst bug this SDK could
 * have.
 */
export function setIdenzy(options: IdenzyOptions): IdenzyContext {
  const context = createIdenzy(options);
  setContext(IDENZY, context);
  return context;
}

/** The context, or a message naming the fix. */
export function getIdenzy(): IdenzyContext {
  const context = getContext<IdenzyContext | undefined>(IDENZY);
  if (context === undefined) {
    throw new IdenzyConfigurationError(
      "No Idenzy client in this tree. Call setIdenzy({ client }) in a layout above this component.",
    );
  }
  return context;
}
