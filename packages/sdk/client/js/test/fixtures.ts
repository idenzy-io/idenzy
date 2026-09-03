import { Clock } from "@idenzy/core/time/clock";
import type { SessionCreated } from "@idenzy/protocol/schemas/session";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import type { ApiRequest, ApiResponse, Transport } from "../src/http/transport.js";

/** A clock the test moves. Every expiry in the SDK reads from one of these. */
export class FixedClock extends Clock {
  constructor(private current = new Date("2026-09-03T12:00:00.000Z")) {
    super();
  }

  override now(): Date {
    return this.current;
  }

  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/**
 * Records every request and answers from a handler.
 *
 * The whole SDK is built through constructors, so this is the only substitution any of these
 * tests need: no network, no module mocking, no framework.
 */
export class FakeTransport implements Transport {
  readonly requests: ApiRequest[] = [];
  private handler: (request: ApiRequest) => Promise<ApiResponse> | ApiResponse;

  constructor(handler: (request: ApiRequest) => Promise<ApiResponse> | ApiResponse = notFound) {
    this.handler = handler;
  }

  answerWith(handler: (request: ApiRequest) => Promise<ApiResponse> | ApiResponse): void {
    this.handler = handler;
  }

  send(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    return Promise.resolve(this.handler(request));
  }

  /** Requests whose URL ends with this path, in order. */
  to(path: string): ApiRequest[] {
    return this.requests.filter((request) => request.url.endsWith(path));
  }

  bodyOf(request: ApiRequest): Record<string, unknown> {
    return request.body === undefined ? {} : (JSON.parse(request.body) as Record<string, unknown>);
  }
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body: JSON.stringify(body) };
}

export function errorBody(code: string, message = "no"): unknown {
  return { error: { code, message, requestId: "req_test" } };
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

/**
 * The body a session-creating route answers with.
 *
 * `status` is part of it now: every way in answers a discriminated union, so a fixture
 * without the discriminant is a fixture the SDK correctly refuses to parse.
 */
export function sessionCreated(
  overrides: Partial<SessionCreated> = {},
): SessionCreated & { status: "authenticated" } {
  return {
    status: "authenticated",
    user: user(),
    sessionId: "ses_00000000000000000001",
    accessToken: "access.one",
    accessTokenExpiresAt: "2026-09-03T12:05:00.000Z",
    refreshToken: "refresh.one",
    ...overrides,
  };
}

/** The other half of the union: a sign-in that stopped at a second factor. */
export function mfaRequired(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: "mfa_required",
    challengeId: "chl_00000000000000000009",
    purpose: "sign_in",
    factors: ["totp", "recovery"],
    expiresAt: "2026-09-03T12:05:00.000Z",
    ...overrides,
  };
}

export function sessionRefreshed(overrides: Record<string, unknown> = {}): unknown {
  return {
    sessionId: "ses_00000000000000000001",
    accessToken: "access.two",
    accessTokenExpiresAt: "2026-09-03T12:10:00.000Z",
    refreshToken: "refresh.two",
    ...overrides,
  };
}

function notFound(request: ApiRequest): ApiResponse {
  return json(404, errorBody("not_found", `nothing answers ${request.url}`));
}
