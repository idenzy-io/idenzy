/**
 * The Solid binding for `@idenzy/js`: one provider and three primitives.
 *
 * Everything a customer renders is theirs. This package holds the session in a signal and
 * hands it back; it ships no screen, no form and no button, because the sign-in page is the
 * most brand-sensitive surface in most products and it belongs to whoever owns the product
 * (ADR-0002).
 *
 * There is no JSX in this package, and that is a constraint rather than a style. Solid's JSX
 * is compiled by its own Babel plugin and not by `tsc`, so the only thing `tsc` could emit is
 * a `.js` file still full of JSX, which a customer's bundler does not compile inside
 * `node_modules`. `createComponent` is what that plugin emits anyway.
 *
 * There is deliberately no `useToken()`. A token has a lifetime measured in minutes, so a
 * signal holding one is holding something that can expire between the render and the call it
 * was for. `useIdenzy().getToken()` renews on demand, which is why renewal in this SDK is
 * lazy rather than timed.
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
  type Accessor,
  createComponent,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  useContext,
} from "solid-js";

export type { SessionSnapshot };

interface IdenzyContextValue {
  readonly client: Idenzy;
  readonly session: Accessor<SessionSnapshot>;
}

const IdenzyContext = createContext<IdenzyContextValue>();

export interface IdenzyProviderProps extends Omit<SessionStoreOptions, "initial"> {
  /**
   * The client, built once and outside the tree.
   *
   * An `Idenzy` owns the session, the refresh token and the single-flight promise that keeps
   * one rotation from becoming two. Two clients on one page rotating the same token means the
   * second rotation revokes the whole family (ADR-0007). Under SolidStart it is one client
   * per request rather than one per module: a client shared between requests is a session
   * shared between people.
   */
  readonly client: Idenzy;
  /**
   * What a server already worked out, so the first paint is not a guess.
   *
   * Null as well as absent, because null is what a server that could not place the visitor
   * has to return, and under `exactOptionalPropertyTypes` the alternative is a customer
   * spreading the key conditionally to pass on a value they were given. It means the same as
   * absent: nobody knows yet, so the first paint is `loading`.
   *
   * A seed carries no profile. The access token names the user and the session and does not
   * contain the user object, so anything rendering a name on the first paint has to be given
   * one separately.
   */
  readonly initial?: SessionSnapshot | null;
  readonly children: JSX.Element;
}

/**
 * `<IdenzyProvider client={client}>` at the root, then the primitives anywhere below it.
 *
 * A Solid component body runs once, so the store is built once without anything holding it
 * that way: what React needs `useState` for is the default here. The client is read once for
 * the same reason, and a prop that later names a different one throws rather than being
 * ignored, because the quiet version leaves every primitive reporting a session nobody is
 * calling any more.
 *
 * Under SolidStart this renders on the server too. Pass `restore={!isServer}` there together
 * with the seed that render worked out: restoring on the server rotates a refresh cookie the
 * server does not hold, which is one request to the auth API per render, answered signed-out,
 * for nothing. A server render given neither a seed nor a restore starts signed out, which is
 * the flash a seed exists to prevent.
 */
export function IdenzyProvider(props: IdenzyProviderProps): JSX.Element {
  const client = props.client;
  const seed = props.initial ?? undefined;
  const store = new SessionStore(client, {
    ...(props.restore === undefined ? {} : { restore: props.restore }),
    ...(seed === undefined ? {} : { initial: seed }),
  });
  const [session, setSession] = createSignal(store.snapshot());

  onCleanup(
    store.subscribe(() => {
      setSession(store.snapshot());
    }),
  );

  createEffect(() => {
    if (props.client !== client) {
      throw new IdenzyConfigurationError(
        "The Idenzy client changed identity. Build it once outside the tree, or remount the provider when it really has to change.",
      );
    }
  });

  void store.restore();

  return createComponent(IdenzyContext.Provider, {
    value: { client, session },
    get children(): JSX.Element {
      return props.children;
    },
  });
}

/**
 * The client itself, for everything that is a call rather than a value: signing in, signing
 * out, enrolling a passkey, asking for a token.
 */
export function useIdenzy(): Idenzy {
  return context().client;
}

/**
 * The session, as an accessor that updates when it changes and only when it changes.
 *
 * Read `status` rather than testing `user` for null. The three states are distinct and the
 * middle one matters: `loading` is the answer until the first rotation has come back, and
 * treating it as signed out shows a sign-in screen to someone who is already signed in.
 */
export function useSession(): Accessor<SessionSnapshot> {
  return context().session;
}

/**
 * The signed-in user, or null while nobody is and while the answer is still unknown.
 *
 * Null is also the honest answer on a server-rendered first paint of a signed-in user: the
 * token names them and does not carry the profile. Use `useSession` where that matters.
 */
export function useUser(): Accessor<PublicUser | null> {
  const session = context().session;
  return createMemo(() => session().user);
}

/**
 * The provided context, or a message naming the fix.
 *
 * Every primitive goes through this, so a component rendered outside the provider says so at
 * the component that did it. The alternative is an undefined client reaching a flow and
 * failing later, in an await, with the missing provider nowhere in the stack.
 */
function context(): IdenzyContextValue {
  const value = useContext(IdenzyContext);
  if (value === undefined) {
    throw new IdenzyConfigurationError(
      "No Idenzy client in this tree. Wrap the components that use these primitives in <IdenzyProvider client={...}>.",
    );
  }
  return value;
}
