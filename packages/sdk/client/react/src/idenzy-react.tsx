/**
 * The React binding for `@idenzy/js`: one provider and three hooks.
 *
 * Everything a customer renders is theirs. This package holds the session in React's own
 * store and hands back state; it ships no screen, no form and no button, because the sign-in
 * page is the most brand-sensitive surface in most products and it belongs to whoever owns
 * the product (ADR-0002).
 *
 * There is deliberately no `useToken()`. A token has a lifetime measured in minutes, so a
 * hook holding one in render state is holding something that can expire between the render
 * and the call it was for. `useIdenzy().getToken()` renews on demand, at the moment it is
 * needed, which is the whole reason renewal in this SDK is lazy rather than timed.
 */
import type { Idenzy } from "@idenzy/js";
import { IdenzyConfigurationError } from "@idenzy/js/errors";
import { type SessionSnapshot, SessionStore } from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

export type { SessionSnapshot };

interface IdenzyContextValue {
  readonly client: Idenzy;
  readonly store: SessionStore;
}

const IdenzyContext = createContext<IdenzyContextValue | null>(null);

export interface IdenzyProviderProps {
  /**
   * The client, built once and outside the tree.
   *
   * It is a prop rather than a set of options this component would construct, and that is not
   * a style preference. An `Idenzy` owns the session, the refresh token and the single-flight
   * promise that keeps one rotation from becoming two; a render that built a second one would
   * give a page two clients rotating the same token, and the second rotation revokes the
   * whole family (ADR-0007). A value the customer holds cannot be rebuilt by a re-render.
   */
  readonly client: Idenzy;
  /**
   * Whether to pick up a session left by a previous page load. On by default, because the
   * alternative is an application that starts signed out on every refresh.
   *
   * Read once, at mount. Turn it off where something else has already restored, which is what
   * a server-rendered tree holding a session does.
   */
  readonly restore?: boolean;
  /**
   * What the server already worked out, from a session cookie it verified there.
   *
   * Both sides then start from the same snapshot, which is what stops hydration swapping a
   * signed-out tree for a signed-in one in front of the user. `@idenzy/next` passes this;
   * an application rendering only in the browser has nothing to put here.
   */
  readonly initialSession?: SessionSnapshot;
  readonly children: ReactNode;
}

/**
 * Puts one client in the tree, and starts the one call an application makes at boot.
 *
 * It renders nothing of its own. There is no screen, no form and no button anywhere in this
 * package, and there will not be: what a customer gets is the state and the primitives, and
 * the sign-in page stays theirs (ADR-0002).
 */
export function IdenzyProvider({
  client,
  restore = true,
  initialSession,
  children,
}: IdenzyProviderProps): ReactNode {
  const [value] = useState(() => ({
    client,
    store: new SessionStore(client, {
      restore,
      ...(initialSession === undefined ? {} : { initial: initialSession }),
    }),
  }));
  if (value.client !== client) {
    // Silently keeping the first would leave every hook reporting a session from a client
    // nobody is calling any more, which looks like a signed-in user whose requests all fail.
    throw new IdenzyConfigurationError(
      "The Idenzy client changed identity. Build it once outside the tree, or remount the provider with a key when it really has to change.",
    );
  }

  useEffect(() => {
    void value.store.restore();
  }, [value.store]);

  return <IdenzyContext.Provider value={value}>{children}</IdenzyContext.Provider>;
}

/**
 * The client itself, for everything that is a call rather than a value: signing in, signing
 * out, enrolling a passkey, asking for a token.
 *
 * Stable for the life of the provider, so it is safe in a dependency array.
 */
export function useIdenzy(): Idenzy {
  return useIdenzyContext().client;
}

/**
 * The session, re-rendering when it changes and only when it changes.
 *
 * Read `status` rather than testing `user` for null. The three states are distinct and the
 * middle one matters: `loading` is the answer until the first rotation has come back, and a
 * component that treats it as signed out shows a sign-in screen to someone who is already
 * signed in.
 */
export function useSession(): SessionSnapshot {
  const { store } = useIdenzyContext();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.serverSnapshot);
}

/**
 * The signed-in user, or null while nobody is and while the answer is still unknown.
 *
 * For anything that has to tell those two apart, which is most routing, use `useSession`.
 */
export function useUser(): PublicUser | null {
  return useSession().user;
}

/**
 * The context, or a message naming the fix.
 *
 * Every hook goes through this, so a component rendered outside the provider says so once, at
 * the component that did it. The alternative is a null client reaching a flow and failing
 * later, in an await, with the mounting mistake nowhere in the stack.
 */
function useIdenzyContext(): IdenzyContextValue {
  const value = useContext(IdenzyContext);
  if (value === null) {
    throw new IdenzyConfigurationError(
      "No Idenzy client in the tree. Wrap the components that use these hooks in <IdenzyProvider client={...}>.",
    );
  }
  return value;
}
