import { Idenzy } from "@idenzy/js";
import { IdenzyConfigurationError } from "@idenzy/js/errors";
import type { ApiRequest, ApiResponse, Transport } from "@idenzy/js/http/transport";
import { seededSession } from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { createIdenzy, useIdenzy, useSession, useUser } from "../src/idenzy-vue.js";

class FakeTransport implements Transport {
  readonly requests: ApiRequest[] = [];

  constructor(private readonly handler: (request: ApiRequest) => ApiResponse) {}

  send(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    return Promise.resolve(this.handler(request));
  }

  to(path: string): ApiRequest[] {
    return this.requests.filter((request) => request.url.endsWith(path));
  }
}

function client(transport: Transport): Idenzy {
  return new Idenzy(
    { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" },
    { transport },
  );
}

function json(status: number, body: unknown): ApiResponse {
  return { status, body: JSON.stringify(body) };
}

function refused(): ApiResponse {
  return json(401, {
    error: { code: "invalid_credentials", message: "no", requestId: "req_test" },
  });
}

function user(): PublicUser {
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

function sessionCreated(): unknown {
  return {
    user: user(),
    sessionId: "ses_00000000000000000002",
    accessToken: "access.new",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.new",
  };
}

function sessionRefreshed(): unknown {
  return {
    sessionId: "ses_00000000000000000001",
    accessToken: "access.one",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.one",
    user: user(),
  };
}

/** Renders the status as text, which is all these tests need to see. */
const Status = defineComponent({
  setup() {
    const session = useSession();
    return () => h("span", session.value.status);
  },
});

function mountWith(instance: Idenzy, options: Record<string, unknown> = {}) {
  return mount(Status, {
    global: { plugins: [createIdenzy({ client: instance, ...options })] },
  });
}

describe("useSession", () => {
  it("says loading until the first rotation has come back", () => {
    const wrapper = mountWith(client(new FakeTransport(() => json(200, sessionRefreshed()))));

    expect(wrapper.text()).toBe("loading");
  });

  it("comes back signed in from a session the last page load left behind", async () => {
    const wrapper = mountWith(client(new FakeTransport(() => json(200, sessionRefreshed()))));

    await flushPromises();

    expect(wrapper.text()).toBe("signed-in");
  });

  it("comes back signed out when the credential is refused", async () => {
    const wrapper = mountWith(client(new FakeTransport(refused)));

    await flushPromises();

    expect(wrapper.text()).toBe("signed-out");
  });

  it("never says loading when the plugin was told not to restore", () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));

    const wrapper = mountWith(client(transport), { restore: false });

    expect(wrapper.text()).toBe("signed-out");
    expect(transport.requests).toHaveLength(0);
  });

  it("follows a sign-in made through the client", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const instance = client(transport);
    const wrapper = mountWith(instance);
    await flushPromises();

    await instance.signIn.anonymously();
    await flushPromises();

    expect(wrapper.text()).toBe("signed-in");
  });

  /** Both sides start from the same snapshot, so hydration does not swap the tree. */
  it("renders signed in from a seed the server worked out, before any request", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000009");

    const wrapper = mountWith(client(new FakeTransport(refused)), { initial: seed });

    expect(wrapper.text()).toBe("signed-in");
  });
});

describe("useUser", () => {
  it("is null while the answer is unknown and holds the profile once there is one", async () => {
    const Profile = defineComponent({
      setup() {
        const profile = useUser();
        return () => h("span", profile.value?.email ?? "none");
      },
    });
    const instance = client(new FakeTransport(() => json(200, sessionRefreshed())));
    const wrapper = mount(Profile, {
      global: { plugins: [createIdenzy({ client: instance })] },
    });
    expect(wrapper.text()).toBe("none");

    await flushPromises();

    expect(wrapper.text()).toBe("ada@example.test");
  });
});

describe("using a composable without the plugin", () => {
  it("says so where it happened, rather than failing later in an await", () => {
    const Bare = defineComponent({
      setup() {
        useIdenzy();
        return () => h("span", "never");
      },
    });

    expect(() => mount(Bare)).toThrow(IdenzyConfigurationError);
  });
});

describe("unmounting the app", () => {
  /** Nothing may be left hanging off a client that outlives the app that was watching it. */
  it("lets go of the client", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const instance = client(transport);
    const wrapper = mountWith(instance, { restore: false });

    wrapper.unmount();
    await instance.signIn.anonymously();

    expect(transport.to("v1/auth/anonymous")).toHaveLength(1);
  });
});
