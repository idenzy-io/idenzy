/**
 * The Vue binding for `@idenzy/js`: one plugin and three composables.
 *
 * Everything a customer renders is theirs. This package holds the session in a ref and hands
 * it back; it ships no screen, no form and no button, because the sign-in page is the most
 * brand-sensitive surface in most products and belongs to whoever owns the product
 * (ADR-0002).
 *
 * There is deliberately no `useToken()`. A token has a lifetime measured in minutes, so a ref
 * holding one is holding something that can expire between the render and the call it was
 * for. `useIdenzy().getToken()` renews on demand, which is why renewal in this SDK is lazy.
 */
import type { Idenzy } from "@idenzy/js";
import { IdenzyConfigurationError } from "@idenzy/js/errors";
import {
  type SessionSnapshot,
  SessionStore,
  type SessionStoreOptions,
} from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import {
  type App,
  type ComputedRef,
  computed,
  type InjectionKey,
  inject,
  type Plugin,
  type ShallowRef,
  shallowRef,
} from "vue";

export type { SessionSnapshot };

export interface IdenzyContext {
  readonly client: Idenzy;
  readonly session: Readonly<ShallowRef<SessionSnapshot>>;
}

/**
 * Named rather than anonymous, because a bad injection in Vue is a silent undefined and the
 * key is the only thing that appears in a devtools panel when someone goes looking.
 */
export const IDENZY: InjectionKey<IdenzyContext> = Symbol.for("idenzy");

export interface IdenzyPluginOptions extends SessionStoreOptions {
  /**
   * The client, built once and outside the app.
   *
   * It is passed in rather than built here, and that is not a style preference. An `Idenzy`
   * owns the session, the refresh token and the single-flight promise that keeps one rotation
   * from becoming two; two clients on one page rotating the same token means the second
   * rotation revokes the whole family (ADR-0007).
   */
  readonly client: Idenzy;
}

/**
 * `app.use(createIdenzy({ client }))`, which provides the client and starts the one call an
 * application makes at boot.
 *
 * The subscription lives exactly as long as the app: taken at install, dropped on unmount.
 * A per-component subscription would be the other reasonable choice and buys nothing here,
 * because the ref it would fill is shared anyway.
 */
export function createIdenzy(options: IdenzyPluginOptions): Plugin {
  return {
    install(app: App): void {
      const store = new SessionStore(options.client, options);
      const session = shallowRef<SessionSnapshot>(store.snapshot());
      const stop = store.subscribe(() => {
        session.value = store.snapshot();
      });

      app.onUnmount(stop);
      app.provide(IDENZY, { client: options.client, session });
      void store.restore();
    },
  };
}

/**
 * The client itself, for everything that is a call rather than a value: signing in, signing
 * out, enrolling a passkey, asking for a token.
 */
export function useIdenzy(): Idenzy {
  return context().client;
}

/**
 * The session, as a ref that updates when it changes and only when it changes.
 *
 * Read `status` rather than testing `user` for null. The three states are distinct and the
 * middle one matters: `loading` is the answer until the first rotation has come back, and
 * treating it as signed out shows a sign-in screen to someone who is already signed in.
 */
export function useSession(): Readonly<ShallowRef<SessionSnapshot>> {
  return context().session;
}

/**
 * The signed-in user, or null while nobody is and while the answer is still unknown.
 *
 * Null is also the honest answer on a server-rendered first paint of a signed-in user: the
 * token names them and does not carry the profile. Use `useSession` where that matters.
 */
export function useUser(): ComputedRef<PublicUser | null> {
  const session = context().session;
  return computed(() => session.value.user);
}

/**
 * The provided context, or a message naming the fix.
 *
 * Every composable goes through this, so an app that forgot the plugin says so at the
 * component that asked. The alternative is an undefined client reaching a flow and failing
 * later, in an await, with the missing `app.use` nowhere in the stack.
 */
function context(): IdenzyContext {
  const value = inject(IDENZY, null);
  if (value === null) {
    throw new IdenzyConfigurationError(
      "No Idenzy client in this app. Install the plugin with app.use(createIdenzy({ client })).",
    );
  }
  return value;
}
