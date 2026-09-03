import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { protectRoutes } from "../src/middleware.js";
import { IdenzyServer } from "../src/server.js";

const ISSUER = "https://auth.acme.test";
const PROJECT = "prj_00000000000000000001";
const SESSION_COOKIE = "__Host-idenzy-session";

let jwks: JSONWebKeySet;
let mint: (options?: { audience?: string; expiresIn?: string }) => Promise<string>;
let idenzy: IdenzyServer;

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

  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } }),
    ),
  );
  idenzy = new IdenzyServer({ issuerUrl: ISSUER, projectId: PROJECT });
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
