import { Idenzy } from "@idenzy/js";
import type { ApiRequest, ApiResponse, Transport } from "@idenzy/js/http/transport";
import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { createIdenzy } from "../src/idenzy-svelte.js";

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

/** Long enough for the transport, the parse and the store publish behind a restore. */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function client(transport: Transport): Idenzy {
  return new Idenzy(
    { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" },
    { transport },
  );
}

/** Subscribes the way `$session` does, and records everything it is told. */
function watch(store: { subscribe: (run: (value: SessionSnapshot) => void) => () => void }): {
  readonly seen: SessionSnapshot[];
  stop(): void;
} {
  const seen: SessionSnapshot[] = [];
  const stop = store.subscribe((value) => seen.push(value));
  return { seen, stop };
}

describe("the session store", () => {
  it("starts on loading and lands on the session the last page load left behind", async () => {
    const context = createIdenzy({
      client: client(new FakeTransport(() => answer(200, restored()))),
    });
    const watcher = watch(context.session);

    await flush();

    expect(watcher.seen[0]?.status).toBe("loading");
    expect(get(context.session).status).toBe("signed-in");
    watcher.stop();
  });

  it("lands on signed out when the credential is refused", async () => {
    const context = createIdenzy({ client: client(new FakeTransport(refused)) });

    await flush();

    expect(get(context.session).status).toBe("signed-out");
  });

  it("never says loading when told not to restore", () => {
    const transport = new FakeTransport(() => answer(200, restored()));

    const context = createIdenzy({ client: client(transport), restore: false });

    expect(get(context.session).status).toBe("signed-out");
    expect(transport.requests).toHaveLength(0);
  });

  /** Both sides start from the same snapshot, so hydration does not swap the tree. */
  it("starts from a seed the server worked out", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000009");

    const context = createIdenzy({
      client: client(new FakeTransport(refused)),
      restore: false,
      initial: seed,
    });

    expect(get(context.session)).toEqual(seed);
  });

  it("follows a sign-in made through the client", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? answer(200, created()) : refused(),
    );
    const instance = client(transport);
    const context = createIdenzy({ client: instance, restore: false });
    const watcher = watch(context.session);

    await instance.signIn.anonymously();

    expect(get(context.session).status).toBe("signed-in");
    watcher.stop();
  });

  /** Nothing may be left hanging off a client that outlives the page watching it. */
  it("stops telling a subscriber that has gone away", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? answer(200, created()) : refused(),
    );
    const instance = client(transport);
    const context = createIdenzy({ client: instance, restore: false });
    const watcher = watch(context.session);
    watcher.stop();
    const afterStop = watcher.seen.length;

    await instance.signIn.anonymously();

    expect(watcher.seen).toHaveLength(afterStop);
  });
});

describe("the user store", () => {
  it("is null while the answer is unknown and holds the profile once there is one", async () => {
    const context = createIdenzy({
      client: client(new FakeTransport(() => answer(200, restored()))),
    });
    expect(get(context.user)).toBeNull();

    await flush();

    expect(get(context.user)).toEqual(profile());
  });
});
