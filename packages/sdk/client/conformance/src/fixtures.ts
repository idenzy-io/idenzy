/**
 * What the suite builds its cases out of: a fake transport, a user, and the two session
 * responses a binding ever sees.
 *
 * Exported rather than kept private to the suite, so a binding writing a case of its own tests
 * the same session against the same profile as the shared cases do. Every binding still has a
 * copy of these from before the suite existed, and the copies can go as each one is next
 * touched.
 */
import { Idenzy } from "@idenzy/js";
import type { ApiRequest, ApiResponse, Transport } from "@idenzy/js/http/transport";
import type { PublicUser } from "@idenzy/protocol/schemas/user";

/**
 * Records every request and answers from a handler.
 *
 * The whole SDK is built through constructors, so this is the only substitution these tests
 * need: no network, no module mocking, no service worker.
 */
export class FakeTransport implements Transport {
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

/**
 * Takes the request and never answers it.
 *
 * What a binding looks like in the window it exists to handle: the first rotation has left and
 * nothing has come back, so the honest answer is that nobody knows yet. A transport that
 * resolved would make that window depend on how thoroughly a framework's test helper flushes
 * its microtasks, which is the sort of timing a case should not be built on.
 */
export class PendingTransport implements Transport {
  readonly requests: ApiRequest[] = [];

  send(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    return new Promise<ApiResponse>(() => undefined);
  }
}

let clients = 0;

/**
 * A client with no network under it, and a publishable key of its own.
 *
 * The key is unique per client because the cross-tab refresh lock is named after it: two
 * clients for one project queue behind each other deliberately (ADR-0007). Node has
 * `navigator.locks` now, so a case that leaves a rotation in flight would hold that lock and
 * every later case for the same key would wait on it forever, which reads as a binding that
 * never restores rather than as a fixture holding a lock.
 */
export function testClient(transport: Transport): Idenzy {
  clients += 1;
  return new Idenzy(
    { publishableKey: `pk_test_conformance_${clients}`, apiUrl: "https://auth.example.test" },
    { transport },
  );
}

/**
 * A serialised response.
 *
 * Named `answer` rather than `json` on purpose: the `no-unclassified-column` plugin matches a
 * `json(...)` call inside any object property, so a case holding one reads to it as a Drizzle
 * column that escaped `classified()`.
 */
export function answer(status: number, body: unknown): ApiResponse {
  return { status, body: JSON.stringify(body) };
}

/** What the server answers a rotation it will not honour, which is how a page starts signed out. */
export function refused(): ApiResponse {
  return answer(401, {
    error: { code: "invalid_credentials", message: "no", requestId: "req_test" },
  });
}

export function user(overrides: Partial<PublicUser> = {}): PublicUser {
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
    ...overrides,
  };
}

/** A session the client has just been given, as a sign-in call returns it. */
export function sessionCreated(): unknown {
  return {
    status: "authenticated",
    user: user(),
    sessionId: "ses_00000000000000000002",
    accessToken: "access.new",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.new",
  };
}

/** A session picked up from a previous page load, profile included so a boot is one round trip. */
export function sessionRefreshed(): unknown {
  return {
    sessionId: "ses_00000000000000000001",
    accessToken: "access.one",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.one",
    user: user(),
  };
}

export interface SubscriptionCount {
  /** Listeners still attached to the client. */
  readonly active: number;
  /** Listeners attached at any point, so a case can tell "released" from "never subscribed". */
  readonly total: number;
}

/**
 * Counts what a binding has hanging off the client.
 *
 * The alternative is asserting on requests that do not happen after a tree comes down, which
 * passes just as well when the binding stopped for some other reason. A client outlives every
 * view of it: it is built once, at module scope, and the trees mount and unmount around it.
 */
export function countSubscriptions(client: Idenzy): SubscriptionCount {
  const count = { active: 0, total: 0 };
  const original = client.subscribe.bind(client);
  client.subscribe = (listener): (() => void) => {
    count.active += 1;
    count.total += 1;
    const stop = original(listener);
    let stopped = false;
    return () => {
      if (!stopped) {
        stopped = true;
        count.active -= 1;
      }
      stop();
    };
  };
  return count;
}
