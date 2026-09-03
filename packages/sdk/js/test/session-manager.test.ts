import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { SessionTransport } from "@idenzy/protocol/http/headers";
import { beforeEach, describe, expect, it } from "vitest";
import { IdenzyConfig } from "../src/config.js";
import { ApiClient } from "../src/http/api-client.js";
import type { CookieJar } from "../src/http/cookie-jar.js";
import { MemoryRefreshTokenStore } from "../src/session/refresh-token-store.js";
import { SessionManager, type SessionState } from "../src/session/session-manager.js";
import {
  errorBody,
  FakeTransport,
  FixedClock,
  json,
  sessionCreated,
  sessionRefreshed,
} from "./fixtures.js";

const NO_COOKIES: CookieJar = { read: () => undefined };

function build(transport: FakeTransport, mode: SessionTransport = SessionTransport.Header) {
  const config = IdenzyConfig.parse({
    publishableKey: "pk_test_abc",
    apiUrl: "https://auth.acme.test",
    sessionTransport: mode,
  });
  const clock = new FixedClock();
  const tokens = new MemoryRefreshTokenStore();
  const api = new ApiClient(config, transport, NO_COOKIES);
  return { clock, tokens, sessions: new SessionManager(api, config, tokens, clock) };
}

let transport: FakeTransport;

beforeEach(() => {
  transport = new FakeTransport(() => json(200, sessionRefreshed()));
});

describe("holding a session", () => {
  it("keeps the refresh token out of the object the application is handed", () => {
    const { sessions, tokens } = build(transport);
    const session = sessions.adopt(sessionCreated());

    expect(JSON.stringify(session)).not.toContain("refresh.one");
    expect(tokens.read()).toBe("refresh.one");
  });

  it("returns the token it holds while it still has time left", async () => {
    const { sessions } = build(transport);
    sessions.adopt(sessionCreated());

    expect(await sessions.getToken()).toBe("access.one");
    expect(transport.requests).toHaveLength(0);
  });

  it("renews before expiry rather than at it, because the request has to arrive too", async () => {
    const { sessions, clock } = build(transport);
    sessions.adopt(sessionCreated());
    // Four and a half minutes into a five-minute token: still valid, inside the margin.
    clock.advance(279);

    expect(await sessions.getToken()).toBe("access.two");
  });

  it("answers without a request when there is nothing to refresh with", async () => {
    const { sessions } = build(transport);

    expect(await sessions.getToken()).toBeNull();
    expect(transport.requests).toHaveLength(0);
  });
});

describe("refreshing", () => {
  /**
   * The one that matters. A second rotation with the same token is exactly what reuse
   * detection revokes a family for, so a page mounting several components must produce one
   * request and not one per component.
   */
  it("rotates once for however many callers ask at the same moment", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.answerWith(async () => {
      await held;
      return json(200, sessionRefreshed());
    });

    const { sessions, clock } = build(transport);
    sessions.adopt(sessionCreated());
    clock.advance(600);

    const waiting = Promise.all([
      sessions.getToken(),
      sessions.getToken(),
      sessions.getToken(),
      sessions.getToken(),
    ]);
    release();

    expect(await waiting).toEqual(["access.two", "access.two", "access.two", "access.two"]);
    expect(transport.to("v1/auth/refresh")).toHaveLength(1);
  });

  it("presents the stored token and asks for no profile it already has", async () => {
    const { sessions, clock } = build(transport);
    sessions.adopt(sessionCreated());
    clock.advance(600);
    await sessions.getToken();

    const body = transport.bodyOf(transport.to("v1/auth/refresh")[0]!);
    expect(body).toEqual({ includeUser: false, refreshToken: "refresh.one" });
  });

  it("asks for the profile when it is starting from a cookie and nothing else", async () => {
    transport.answerWith(() =>
      json(200, sessionRefreshed({ user: sessionCreated().user, refreshToken: undefined })),
    );
    const { sessions } = build(transport, SessionTransport.Cookie);

    const restored = await sessions.restore();

    expect(transport.bodyOf(transport.to("v1/auth/refresh")[0]!)).toEqual({ includeUser: true });
    expect(restored?.user.id).toBe("usr_00000000000000000001");
  });

  it("signs out when the credential is refused, and says so once", async () => {
    transport.answerWith(() => json(401, errorBody(ErrorCode.RefreshTokenReused)));
    const { sessions, clock, tokens } = build(transport);
    const states: SessionState[] = [];
    sessions.subscribe((state) => states.push(state));
    sessions.adopt(sessionCreated());
    clock.advance(600);

    expect(await sessions.getToken()).toBeNull();
    expect(tokens.read()).toBeNull();
    expect(states.map((state) => state.status)).toEqual(["signed-out", "signed-in", "signed-out"]);
  });

  it("does not sign anyone out because a refresh was rate limited", async () => {
    transport.answerWith(() => json(429, errorBody(ErrorCode.RateLimited)));
    const { sessions, clock } = build(transport);
    sessions.adopt(sessionCreated());
    clock.advance(600);

    await expect(sessions.getToken()).rejects.toMatchObject({ code: ErrorCode.RateLimited });
    expect(sessions.session).not.toBeNull();
  });

  it("tries in cookie mode even with nothing stored, and stays quiet in header mode", async () => {
    transport.answerWith(() => json(401, errorBody(ErrorCode.MissingCredentials)));

    expect(await build(transport, SessionTransport.Cookie).sessions.restore()).toBeNull();
    expect(transport.to("v1/auth/refresh")).toHaveLength(1);

    expect(await build(transport, SessionTransport.Header).sessions.restore()).toBeNull();
    expect(transport.to("v1/auth/refresh")).toHaveLength(1);
  });
});

describe("signing out", () => {
  it("drops the local session even when the request fails", async () => {
    transport.answerWith(() => json(500, errorBody(ErrorCode.Internal)));
    const { sessions, tokens } = build(transport);
    sessions.adopt(sessionCreated());

    await expect(sessions.signOut()).rejects.toMatchObject({ code: ErrorCode.Internal });
    expect(sessions.session).toBeNull();
    expect(tokens.read()).toBeNull();
  });
});
