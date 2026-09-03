import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { protectRoutes } from "../src/middleware.js";
import { IdenzyServer } from "../src/server.js";

const ISSUER = "https://auth.acme.test";
const COLD = "https://auth.cold.test";
const PROJECT = "prj_00000000000000000001";
const SESSION_COOKIE = "__Host-idenzy-session";

let jwks: JSONWebKeySet;
let mint: (options?: { audience?: string; expiresIn?: string }) => Promise<string>;
let idenzy: IdenzyServer;
let cold: IdenzyServer;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" }] };
  mint = (options = {}) =>
    new SignJWT({ sid: "ses_00000000000000000001", amr: ["pwd"] })
      .setProtectedHeader({ alg: "ES256", kid: "k1", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(options.audience ?? PROJECT)
      .setSubject("usr_00000000000000000001")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);

  // Everything answers with the key set except `auth.cold.test`, which is how a verifier
  // that cannot reach our JWKS endpoint at all is built in a test.
  vi.stubGlobal("fetch", (input: URL | string) => {
    if (String(input).includes(COLD)) return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(
      new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } }),
    );
  });
  idenzy = new IdenzyServer({ issuerUrl: ISSUER, projectId: PROJECT });
  cold = new IdenzyServer({ issuerUrl: COLD, projectId: PROJECT });
});

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`https://app.acme.test${path}`, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe("the session on an incoming request", () => {
  it("comes from the access-token cookie, with no call to us at all", async () => {
    const session = await idenzy.sessionFor(request("/", `${SESSION_COOKIE}=${await mint()}`));

    expect(session).toEqual({
      status: "signed-in",
      userId: "usr_00000000000000000001",
      user: null,
      sessionId: "ses_00000000000000000001",
    });
  });

  it("is null for a visitor with no cookie, which is a state and not an error", async () => {
    expect(await idenzy.sessionFor(request("/"))).toBeNull();
  });

  it("is null for an expired token", async () => {
    const stale = await mint({ expiresIn: "-1m" });

    expect(await idenzy.sessionFor(request("/", `${SESSION_COOKIE}=${stale}`))).toBeNull();
  });

  /** One issuer serves every project, so the audience is the only thing separating tenants. */
  it("is null for a valid token minted for another project", async () => {
    const other = await mint({ audience: "prj_00000000000000000002" });

    expect(await idenzy.sessionFor(request("/", `${SESSION_COOKIE}=${other}`))).toBeNull();
  });

  it("hands back the claims for a customer's own authorisation", async () => {
    const verified = await idenzy.verify(new Headers({ authorization: `Bearer ${await mint()}` }));

    expect(verified?.amr).toEqual(["pwd"]);
    expect(verified?.projectId).toBe(PROJECT);
  });

  /**
   * A seed's null already means "the server could not tell", which renders `loading`.
   * Throwing here would be a 500 on every page of a customer's site for the length of an
   * outage, and the site does not need us in order to render.
   */
  it("is null rather than a throw when the key set cannot be fetched at all", async () => {
    const live = `${SESSION_COOKIE}=${await mint()}`;

    await expect(cold.sessionFor(request("/", live))).resolves.toBeNull();
  });

  /**
   * The one method here that does throw, and it has to. Authorisation code told "no claims"
   * when the truth is "cannot tell" refuses the right people for the wrong reason.
   */
  it("still reports an unreachable key set from verify, as itself", async () => {
    const headers = new Headers({ authorization: `Bearer ${await mint()}` });

    await expect(cold.verify(headers)).rejects.toThrow(TypeError);
  });
});

describe("middleware that protects routes", () => {
  const middleware = (): ((request: NextRequest) => Promise<Response>) =>
    protectRoutes({
      idenzy,
      isProtected: (pathname) => pathname.startsWith("/app"),
      signInUrl: "/sign-in",
    });

  it("lets a signed-in visitor through", async () => {
    const response = await middleware()(
      request("/app/settings", `${SESSION_COOKIE}=${await mint()}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends a signed-out visitor to the customer's own page, not one of ours", async () => {
    const response = await middleware()(request("/app/settings"));

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.acme.test");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/app/settings");
  });

  it("leaves everything outside the protected paths alone, signed in or not", async () => {
    const response = await middleware()(request("/pricing"));

    expect(response.headers.get("location")).toBeNull();
  });

  /**
   * The query string of the page somebody was refused is the part most likely to hold
   * something that should not be round-tripped through a redirect they can read.
   */
  it("carries the path back and not the query string", async () => {
    const response = await middleware()(request("/app/settings?invite=secret-token"));

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/app/settings");
    expect(location.search).not.toContain("secret-token");
  });

  /**
   * The failure this gate must not have. Redirecting a signed-in visitor to a sign-in page
   * because our key endpoint is unreachable signs them out for the length of the outage and
   * asks them to fix something that is not broken on their side.
   */
  it("answers 503 rather than a redirect when it cannot judge the token at all", async () => {
    const response = await protectRoutes({
      idenzy: cold,
      isProtected: () => true,
      signInUrl: "/sign-in",
    })(request("/app/settings", `${SESSION_COOKIE}=${await mint()}`));

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("serves the page instead where the customer asked for that explicitly", async () => {
    const response = await protectRoutes({
      idenzy: cold,
      isProtected: () => true,
      signInUrl: "/sign-in",
      onUnverifiable: "allow",
    })(request("/app/settings", `${SESSION_COOKIE}=${await mint()}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  /** An expired token was read and refused, which is a "no" and not a "cannot tell". */
  it("still redirects for a credential it could read and would not accept", async () => {
    const stale = await mint({ expiresIn: "-1m" });

    const response = await middleware()(request("/app/settings", `${SESSION_COOKIE}=${stale}`));

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
  });

  it("keeps the URL clean when the customer asked for no return parameter", async () => {
    const response = await protectRoutes({
      idenzy,
      isProtected: () => true,
      signInUrl: "/sign-in",
      returnTo: null,
    })(request("/app/settings"));

    expect(new URL(response.headers.get("location") ?? "").search).toBe("");
  });
});
