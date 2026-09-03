import { Idenzy } from "@idenzy/js";
import type { ApiRequest, ApiResponse, Transport } from "@idenzy/js/http/transport";
import { seededSession } from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { describe, expect, it } from "vitest";
import { IdenzySession } from "../src/idenzy-angular.js";

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

describe("the session signal", () => {
  it("starts on loading, which is what keeps a sign-in screen off a signed-in user", () => {
    const state = new IdenzySession(client(new FakeTransport(() => answer(200, restored()))));

    expect(state.session().status).toBe("loading");
    state.destroy();
  });

  it("lands on the session the last page load left behind", async () => {
    const state = new IdenzySession(client(new FakeTransport(() => answer(200, restored()))));

    await flush();

    expect(state.session().status).toBe("signed-in");
    expect(state.user()).toEqual(profile());
    state.destroy();
  });

  it("lands on signed out when the credential is refused", async () => {
    const state = new IdenzySession(client(new FakeTransport(refused)));

    await flush();

    expect(state.session().status).toBe("signed-out");
    expect(state.user()).toBeNull();
    state.destroy();
  });

  it("never says loading when told not to restore", () => {
    const transport = new FakeTransport(() => answer(200, restored()));

    const state = new IdenzySession(client(transport), { restore: false });

    expect(state.session().status).toBe("signed-out");
    expect(transport.requests).toHaveLength(0);
    state.destroy();
  });

  /** Both sides start from the same snapshot, so hydration does not swap the tree. */
  it("starts from a seed a server render worked out", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000009");

    const state = new IdenzySession(client(new FakeTransport(refused)), {
      restore: false,
      initial: seed,
    });

    expect(state.session()).toEqual(seed);
    state.destroy();
  });

  it("follows a sign-in made through the client", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? answer(200, created()) : refused(),
    );
    const instance = client(transport);
    const state = new IdenzySession(instance, { restore: false });

    await instance.signIn.anonymously();

    expect(state.session().status).toBe("signed-in");
    state.destroy();
  });

  /** Nothing may be left hanging off a client that outlives the injector watching it. */
  it("stops following the client once destroyed", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? answer(200, created()) : refused(),
    );
    const instance = client(transport);
    const state = new IdenzySession(instance, { restore: false });

    state.destroy();
    await instance.signIn.anonymously();

    expect(state.session().status).toBe("signed-out");
  });
});
