import { Idenzy } from "@idenzy/js";
import { IdenzyConfigurationError } from "@idenzy/js/errors";
import type { ApiRequest, ApiResponse, Transport } from "@idenzy/js/http/transport";
import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { type Accessor, createComponent, createRoot, createSignal, type JSX } from "solid-js";
import { describe, expect, it } from "vitest";
import {
  IdenzyProvider,
  type IdenzyProviderProps,
  useIdenzy,
  useSession,
  useUser,
} from "../src/idenzy-solid.js";

class FakeTransport implements Transport {
  readonly requests: ApiRequest[] = [];

  constructor(private readonly handler: (request: ApiRequest) => ApiResponse) {}

  send(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    return Promise.resolve(this.handler(request));
  }
}

function answer(status: number, body: unknown): ApiResponse {
  return { status, body: JSON.stringify(body) };
}

function refused(): ApiResponse {
  return answer(401, {
    error: { code: "invalid_credentials", message: "no", requestId: "req_test" },
  });
}

function profile(): PublicUser {
  return {
    id: "usr_00000000000000000001",
    email: "ada@example.test",
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    displayName: "Ada",
    avatarUrl: null,
    metadataPublic: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    lastSignInAt: null,
  };
}

function restored(): unknown {
  return {
    sessionId: "ses_00000000000000000001",
    accessToken: "access.one",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.one",
    user: profile(),
  };
}

function created(): unknown {
  return {
    user: profile(),
    sessionId: "ses_00000000000000000002",
    accessToken: "access.new",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.new",
  };
}

function client(transport: Transport): Idenzy {
  return new Idenzy(
    { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" },
    { transport },
  );
}

/** Long enough for the transport, the parse and the publish behind a restore. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Consumed {
  readonly session: Accessor<SessionSnapshot>;
  readonly user: Accessor<PublicUser | null>;
  readonly client: Idenzy;
}

interface Mounted extends Consumed {
  dispose(): void;
}

/**
 * Renders the provider around one consumer, which is all a context test needs a tree for.
 *
 * The children are behind a getter because Solid's `Provider` resolves them inside its own
 * owner, and that owner is what carries the context. Evaluating them at the call site instead
 * would run every primitive outside the provider and test nothing that a customer does.
 */
function mount(props: Omit<IdenzyProviderProps, "children">): Mounted {
  let seen: Consumed | undefined;
  const consumer = (): JSX.Element => {
    seen = { session: useSession(), user: useUser(), client: useIdenzy() };
    return null;
  };

  const dispose = createRoot((disposeRoot) => {
    createComponent(IdenzyProvider, {
      ...props,
      get children(): JSX.Element {
        return createComponent(consumer, {});
      },
    });
    return disposeRoot;
  });

  return { ...seen!, dispose };
}

describe("the session accessor", () => {
  it("starts on loading, which is what keeps a sign-in screen off a signed-in user", () => {
    const mounted = mount({ client: client(new FakeTransport(() => answer(200, restored()))) });

    expect(mounted.session().status).toBe("loading");
    mounted.dispose();
  });

  it("lands on the session the last page load left behind", async () => {
    const mounted = mount({ client: client(new FakeTransport(() => answer(200, restored()))) });

    await flush();

    expect(mounted.session().status).toBe("signed-in");
    expect(mounted.user()).toEqual(profile());
    mounted.dispose();
  });

  it("lands on signed out when the credential is refused", async () => {
    const mounted = mount({ client: client(new FakeTransport(refused)) });

    await flush();

    expect(mounted.session().status).toBe("signed-out");
    expect(mounted.user()).toBeNull();
    mounted.dispose();
  });

  it("never says loading when told not to restore", () => {
    const transport = new FakeTransport(() => answer(200, restored()));

    const mounted = mount({ client: client(transport), restore: false });

    expect(mounted.session().status).toBe("signed-out");
    expect(transport.requests).toHaveLength(0);
    mounted.dispose();
  });

  /** Both sides start from the same snapshot, so hydration does not swap the tree. */
  it("starts from a seed a server render worked out", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000009");

    const mounted = mount({
      client: client(new FakeTransport(refused)),
      restore: false,
      initial: seed,
    });

    expect(mounted.session()).toEqual(seed);
    mounted.dispose();
  });

  /**
   * What a server returns for a visitor it could not place. It means the same as no seed at
   * all, so the first paint is `loading` and the browser settles it.
   */
  it("takes the null a server could not answer with as no seed at all", () => {
    const mounted = mount({
      client: client(new FakeTransport(() => answer(200, restored()))),
      initial: null,
    });

    expect(mounted.session().status).toBe("loading");
    mounted.dispose();
  });

  it("follows a sign-in made through the client", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? answer(200, created()) : refused(),
    );
    const instance = client(transport);
    const mounted = mount({ client: instance, restore: false });

    await instance.signIn.anonymously();

    expect(mounted.session().status).toBe("signed-in");
    expect(mounted.user()).toEqual(profile());
    mounted.dispose();
  });

  /** Nothing may be left hanging off a client that outlives the tree watching it. */
  it("stops following the client once the tree is disposed", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? answer(200, created()) : refused(),
    );
    const instance = client(transport);
    const mounted = mount({ client: instance, restore: false });

    mounted.dispose();
    await instance.signIn.anonymously();

    expect(mounted.session().status).toBe("signed-out");
  });
});

describe("the provider", () => {
  it("hands the client itself through, for the calls rather than the state", () => {
    const instance = client(new FakeTransport(refused));

    const mounted = mount({ client: instance, restore: false });

    expect(mounted.client).toBe(instance);
    mounted.dispose();
  });

  /**
   * A second client would rotate the same refresh token, and the second rotation revokes the
   * family (ADR-0007). Solid runs a component body once, so the swap is invisible unless
   * something goes looking for it.
   */
  it("refuses a client swapped underneath it rather than ignoring the new one", () => {
    const first = client(new FakeTransport(refused));
    const second = client(new FakeTransport(refused));
    const [current, setCurrent] = createSignal(first);
    const dispose = createRoot((disposeRoot) => {
      createComponent(IdenzyProvider, {
        get client(): Idenzy {
          return current();
        },
        restore: false,
        get children(): JSX.Element {
          return null;
        },
      });
      return disposeRoot;
    });

    expect(() => setCurrent(second)).toThrow(IdenzyConfigurationError);
    dispose();
  });

  it("says which provider is missing when a primitive is used outside the tree", () => {
    createRoot((dispose) => {
      expect(() => useSession()).toThrow(IdenzyConfigurationError);
      dispose();
    });
  });
});
