import "reflect-metadata";
import { InternalError, RefreshTokenReusedError, ValidationFailedError } from "@idenzy/core/errors";
import { IdenzyCookie, IdenzyHeader, SessionTransport } from "@idenzy/protocol/http/headers";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, type Observable, of, throwError } from "rxjs";
import { describe, expect, it } from "vitest";
import { BROWSER_NAVIGATION } from "../dist/http/browser-navigation.decorator.js";
import { CorsPolicy } from "../dist/http/cors-policy.js";
import { SessionCookieInterceptor } from "../dist/session/session-cookie.interceptor.js";
import { SessionCookies } from "../dist/session/session-cookies.js";
import { SessionTransportGuard } from "../dist/session/session-transport.guard.js";
import { ProjectResolver } from "../dist/tenancy/project-resolver.js";
import { testConfig } from "./fixtures.js";

/**
 * Unit tests with hand-built fakes, which is what PROJECT.md 7.4 asks for and what these
 * classes are shaped for: none of them touches a database, and the properties worth asserting
 * are about headers and about what never appears in a body.
 */
const ALLOWED_ORIGIN = "https://app.acme.test";
const EVIL_ORIGIN = "https://evil.test";
const CSRF = "csrf-token-value";

class FakeReply {
  readonly cookies: string[] = [];

  header(name: string, value: string): this {
    if (name === "set-cookie") this.cookies.push(value);
    return this;
  }
}

interface FakeRequestInit {
  readonly method?: string;
  readonly origin?: string;
  readonly secFetchSite?: string;
  readonly csrfHeader?: string;
  /** The declared header, which is what the guard reads. */
  readonly transport?: string;
  /** The decision the guard already made, which is what the interceptor reads. */
  readonly carried?: string;
  readonly cookie?: string;
  readonly protocol?: string;
  readonly hasAuthDomain?: boolean;
  readonly publicRoute?: boolean;
  readonly resolved?: boolean;
}

function request(init: FakeRequestInit = {}): Record<string, unknown> {
  const headers: Record<string, string> = {};
  if (init.transport !== undefined) headers[IdenzyHeader.SessionTransport] = init.transport;
  if (init.cookie !== undefined) headers["cookie"] = init.cookie;
  if (init.origin !== undefined) headers["origin"] = init.origin;
  if (init.secFetchSite !== undefined) headers["sec-fetch-site"] = init.secFetchSite;
  if (init.csrfHeader !== undefined) headers[IdenzyHeader.Csrf] = init.csrfHeader;
  const resolved = init.resolved ?? true;
  return {
    headers,
    method: init.method ?? "GET",
    ...(init.carried === undefined ? {} : { transport: init.carried }),
    protocol: init.protocol ?? "https",
    publicRoute: init.publicRoute ?? false,
    tenant: resolved ? { projectId: "p" } : undefined,
    project: resolved
      ? { hasAuthDomain: init.hasAuthDomain ?? true, allowedOrigins: [ALLOWED_ORIGIN] }
      : undefined,
  };
}

/** Nest's ExecutionContext, reduced to the accessors these classes actually use. */
function executionContext(req: unknown, reply?: unknown, handler: unknown = noop): never {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => reply }),
    getHandler: () => handler,
    getClass: () => NotDecorated,
  } as never;
}

function noop(): void {}
class NotDecorated {}

/** A handler carrying the @BrowserNavigation marker, without needing a compiled controller. */
function navigationHandler(): unknown {
  const handler = (): void => {};
  Reflect.defineMetadata(BROWSER_NAVIGATION, true, handler);
  return handler;
}

describe("choosing how a session is carried", () => {
  /**
   * The real CorsPolicy and a real Reflector rather than stand-ins: the cross-site checks ask
   * it about the allowlist, and a fake would let the two disagree about what "allowed" means.
   */
  const guard = (config = testConfig()) =>
    new SessionTransportGuard(
      config,
      new SessionCookies(config),
      new CorsPolicy(config, new ProjectResolver(null as never)),
      new Reflector(),
    );

  it("defaults to header mode, so nothing that worked before changes", () => {
    const req = request();
    guard().canActivate(executionContext(req));
    expect(req["transport"]).toBe(SessionTransport.Header);
    expect(req["refreshCookie"]).toBeUndefined();
  });

  it("reads the refresh cookie only when cookie mode was declared", () => {
    const cookie = `${IdenzyCookie.Refresh}=the-token`;
    const asHeader = request({ cookie });
    guard().canActivate(executionContext(asHeader));
    // The cookie is present and is deliberately ignored: header mode reads the body only.
    expect(asHeader["refreshCookie"]).toBeUndefined();

    const asCookie = request({ transport: SessionTransport.Cookie, cookie });
    guard().canActivate(executionContext(asCookie));
    expect(asCookie["refreshCookie"]).toBe("the-token");
  });

  it("picks the right cookie out of a jar containing a decoy", () => {
    const req = request({
      transport: SessionTransport.Cookie,
      cookie: `idenzy-refresh=stolen; ${IdenzyCookie.Refresh}=real; other=x`,
    });
    guard().canActivate(executionContext(req));
    // A name without the __Host- prefix is a different cookie, and anyone can set one.
    expect(req["refreshCookie"]).toBe("real");
  });

  it("refuses cookie mode over plain http in production", () => {
    const production = testConfig({ IDENZY_ENV: "production" });
    expect(() =>
      guard(production).canActivate(
        executionContext(request({ transport: SessionTransport.Cookie, protocol: "http" })),
      ),
    ).toThrow(expect.objectContaining({ code: "session_transport_unavailable" }));
  });

  it("refuses cookie mode without a verified auth domain in production", () => {
    // SameSite is a site rule, so on the shared API host the browser would never send the
    // cookie back. Saying so beats issuing one that silently does nothing.
    const production = testConfig({ IDENZY_ENV: "production" });
    expect(() =>
      guard(production).canActivate(
        executionContext(request({ transport: SessionTransport.Cookie, hasAuthDomain: false })),
      ),
    ).toThrow(expect.objectContaining({ code: "session_transport_unavailable" }));
  });

  it("fails closed if it ever runs before the tenant is resolved", () => {
    // The eligibility check reads the resolved project. Skipping quietly would grant cookie
    // mode blind, so a mis-ordered guard has to break loudly instead.
    expect(() =>
      guard().canActivate(
        executionContext(request({ transport: SessionTransport.Cookie, resolved: false })),
      ),
    ).toThrow(InternalError);
  });
});

describe("moving the refresh token out of the body", () => {
  const config = testConfig();
  const cookies = new SessionCookies(config);
  const interceptor = new SessionCookieInterceptor(cookies);

  const created = {
    sessionId: "ses_abc",
    accessToken: "header.payload.signature",
    accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    refreshToken: "refresh-value",
    user: { id: "usr_abc" },
  };

  function intercept(
    req: Record<string, unknown>,
    reply: FakeReply,
    handler: () => Observable<unknown>,
  ): Promise<unknown> {
    return firstValueFrom(
      interceptor.intercept(executionContext(req, reply), { handle: handler } as never),
    );
  }

  it("strips the refresh token from the body and sets it as a cookie", async () => {
    const reply = new FakeReply();
    const body = (await intercept(request({ carried: SessionTransport.Cookie }), reply, () =>
      of(created),
    )) as Record<string, unknown>;

    // The key is deleted, not blanked: a client cannot tell from the shape that a token was
    // ever there, and nothing can serialise it back as null.
    expect("refreshToken" in body).toBe(false);
    expect(body["accessToken"]).toBe(created.accessToken);
    expect(reply.cookies.some((c) => c.startsWith(`${IdenzyCookie.Refresh}=refresh-value`))).toBe(
      true,
    );
  });

  it("leaves header mode entirely alone", async () => {
    const reply = new FakeReply();
    const body = (await intercept(request(), reply, () => of(created))) as Record<string, unknown>;

    expect(body["refreshToken"]).toBe("refresh-value");
    expect(reply.cookies).toHaveLength(0);
  });

  it("expires the cookies when a sign-out succeeds with no body", async () => {
    const reply = new FakeReply();
    await intercept(request({ carried: SessionTransport.Cookie }), reply, () => of(undefined));
    expect(reply.cookies).toHaveLength(3);
    for (const cookie of reply.cookies) expect(cookie).toContain("Max-Age=0");
  });

  it("clears the cookie when the credential turns out to be dead", async () => {
    const reply = new FakeReply();
    await expect(
      intercept(request({ carried: SessionTransport.Cookie }), reply, () =>
        throwError(() => new RefreshTokenReusedError()),
      ),
    ).rejects.toMatchObject({ code: "refresh_token_reused" });

    // The assertion that matters: the error still propagates, and the browser is told to
    // stop presenting a token that will only ever look like an attack from now on.
    expect(reply.cookies).toHaveLength(3);
    for (const cookie of reply.cookies) expect(cookie).toContain("Max-Age=0");
  });

  it("leaves the cookie in place for an error that does not mean the credential is dead", async () => {
    const reply = new FakeReply();
    await expect(
      intercept(request({ carried: SessionTransport.Cookie }), reply, () =>
        throwError(() => new ValidationFailedError()),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(reply.cookies).toHaveLength(0);
  });
});

describe("the cookies themselves", () => {
  const cookies = new SessionCookies(testConfig());

  it("emits __Host- cookies with no Domain, which is what the prefix guarantees", () => {
    const reply = new FakeReply();
    cookies.issue(reply as never, {
      refreshToken: "refresh-value",
      accessToken: "header.payload.signature",
      accessTokenTtlSeconds: 300,
    });

    const refresh = reply.cookies.find((c) => c.startsWith(IdenzyCookie.Refresh));
    expect(refresh).toContain("HttpOnly");
    expect(refresh).toContain("Secure");
    expect(refresh).toContain("SameSite=Lax");
    expect(refresh).toContain("Path=/");
    // The absence is the assertion. __Host- forbids Domain, and that is precisely what stops
    // a sibling subdomain writing a cookie this host will read.
    expect(refresh).not.toContain("Domain=");

    const session = reply.cookies.find((c) => c.startsWith(IdenzyCookie.Session));
    expect(session).toContain("header.payload.signature");
    expect(session).toContain("Max-Age=300");
    expect(session).toContain("HttpOnly");
  });

  it("refuses to emit a value that would need escaping", () => {
    // Outside the base64url and JWT alphabets is a bug upstream, not something to quietly
    // percent-encode: an SSR helper reads the session cookie verbatim.
    expect(() =>
      cookies.issue(new FakeReply() as never, {
        refreshToken: "has spaces; and=semicolons",
        accessToken: "fine",
        accessTokenTtlSeconds: 300,
      }),
    ).toThrow(InternalError);
  });
});

describe("refusing a cross-site request before anything is consumed", () => {
  const config = testConfig();
  const guard = new SessionTransportGuard(
    config,
    new SessionCookies(config),
    new CorsPolicy(config, new ProjectResolver(null as never)),
    new Reflector(),
  );

  const session = {
    carried: SessionTransport.Cookie,
    transport: SessionTransport.Cookie,
    cookie: `${IdenzyCookie.Refresh}=live-token; ${IdenzyCookie.Csrf}=${CSRF}`,
  };

  it("refuses an unregistered origin, and leaves the refresh token alone", () => {
    const req = request({ ...session, method: "POST", origin: EVIL_ORIGIN, csrfHeader: CSRF });
    expect(() => guard.canActivate(executionContext(req))).toThrow(
      expect.objectContaining({ code: "origin_not_allowed" }),
    );
    // The assertion that matters. If this ran after consumption, an attacker could sign a
    // victim out of every device by making their browser send one forged request.
    expect(req["refreshCookie"]).toBeUndefined();
  });

  it("refuses an allowlisted origin that cannot echo the csrf cookie", () => {
    const req = request({ ...session, method: "POST", origin: ALLOWED_ORIGIN });
    expect(() => guard.canActivate(executionContext(req))).toThrow(
      expect.objectContaining({ code: "csrf_check_failed" }),
    );
  });

  it("refuses a mismatched csrf value", () => {
    const req = request({
      ...session,
      method: "POST",
      origin: ALLOWED_ORIGIN,
      csrfHeader: "not-the-cookie",
    });
    expect(() => guard.canActivate(executionContext(req))).toThrow(
      expect.objectContaining({ code: "csrf_check_failed" }),
    );
  });

  it("still refuses a cross-site fetch that happens to carry a correct csrf header", () => {
    // Proves the checks are ANDed rather than alternatives. An attacker who somehow read the
    // token still does not get past Fetch Metadata.
    const req = request({
      ...session,
      method: "POST",
      origin: ALLOWED_ORIGIN,
      csrfHeader: CSRF,
      secFetchSite: "cross-site",
    });
    expect(() => guard.canActivate(executionContext(req))).toThrow(
      expect.objectContaining({ code: "csrf_check_failed" }),
    );
  });

  it("accepts the real thing", () => {
    const req = request({
      ...session,
      method: "POST",
      origin: ALLOWED_ORIGIN,
      csrfHeader: CSRF,
      secFetchSite: "same-site",
    });
    expect(guard.canActivate(executionContext(req))).toBe(true);
    expect(req["refreshCookie"]).toBe("live-token");
  });

  it("refuses login CSRF, where there is no session cookie to echo yet", () => {
    // An attacker who makes a victim's browser complete a sign-in as the attacker plants
    // their own session, and everything the victim does next happens in that account.
    // Origin carries this on its own, because script cannot forge it.
    const req = request({
      carried: SessionTransport.Cookie,
      transport: SessionTransport.Cookie,
      method: "POST",
      origin: EVIL_ORIGIN,
    });
    expect(() => guard.canActivate(executionContext(req))).toThrow(
      expect.objectContaining({ code: "origin_not_allowed" }),
    );
  });

  it("exempts a route the browser reaches by navigating", () => {
    // Apple form-posts its callback with Origin: https://appleid.apple.com. A blanket origin
    // check would break Sign in with Apple; the one-shot state defends these instead.
    const req = request({
      carried: SessionTransport.Cookie,
      transport: SessionTransport.Cookie,
      method: "POST",
      origin: "https://appleid.apple.com",
    });
    expect(guard.canActivate(executionContext(req, undefined, navigationHandler()))).toBe(true);
  });

  it("leaves header mode alone, so a mobile client with no Origin still works", () => {
    const req = request({ method: "POST" });
    expect(guard.canActivate(executionContext(req))).toBe(true);
  });

  it("does not demand an origin for a read", () => {
    const req = request({ ...session, method: "GET" });
    expect(guard.canActivate(executionContext(req))).toBe(true);
  });
});
