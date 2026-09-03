import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createIdenzyMiddleware,
  type IdenzyApiContext,
  type IdenzyServerSession,
} from "../src/idenzy-astro.js";

const ISSUER = "https://auth.acme.test";
const PROJECT = "prj_00000000000000000001";
const OTHER = "prj_00000000000000000002";
const SESSION_COOKIE = "__Host-idenzy-session";

/**
 * Astro's `MiddlewareHandler` and the context it carries, transcribed.
 *
 * This package declares the two properties it touches rather than depending on `astro`, so
 * what is checked here is the part that would break silently: a context with far more on it
 * than we ask for, and a `next` that takes a rewrite payload we never pass, still satisfy the
 * middleware we hand back.
 */
interface AstroApiContext {
  request: Request;
  url: URL;
  params: Record<string, string | undefined>;
  clientAddress: string;
  redirect(path: string, status?: number): Response;
  locals: { idenzy: IdenzyServerSession };
}

type AstroMiddlewareHandler = (
  context: AstroApiContext,
  next: (rewritePayload?: string | Request | URL) => Promise<Response>,
) => Promise<Response> | Response | Promise<void> | void;

let jwks: JSONWebKeySet;
let mint: (audience?: string) => Promise<string>;
let fetches: string[];
let reachable: boolean;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" }] };
  mint = (audience = PROJECT) =>
    new SignJWT({ sid: "ses_00000000000000000001", amr: ["pwd"] })
      .setProtectedHeader({ alg: "ES256", kid: "k1", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setSubject("usr_00000000000000000001")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  fetches = [];
  reachable = true;
  vi.stubGlobal("fetch", (input: URL | string) => {
    fetches.push(String(input));
    if (!reachable) return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(
      new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } }),
    );
  });
});

afterEach(() => {
  fetches.length = 0;
  reachable = true;
});

function middleware(): AstroMiddlewareHandler {
  return createIdenzyMiddleware({ projectId: PROJECT, issuerUrl: ISSUER });
}

/** What Astro hands middleware: a context whose `locals` starts empty. */
function context(headers: Record<string, string> = {}): AstroApiContext {
  return {
    request: new Request("https://acme.test/dashboard", { headers }),
    url: new URL("https://acme.test/dashboard"),
    params: {},
    clientAddress: "203.0.113.9",
    redirect: (path) => new Response(null, { status: 302, headers: { location: path } }),
    locals: {} as AstroApiContext["locals"],
  };
}

function render(): () => Promise<Response> {
  return () => Promise.resolve(new Response("rendered"));
}

describe("the middleware a src/middleware.ts installs", () => {
  it("seeds the user and the session from a live access-token cookie", async () => {
    const incoming = context({ cookie: `${SESSION_COOKIE}=${await mint()}` });

    await middleware()(incoming, render());

    expect(incoming.locals.idenzy.session).toEqual({
      status: "signed-in",
      userId: "usr_00000000000000000001",
      user: null,
      sessionId: "ses_00000000000000000001",
    });
  });

  it("carries the claims through for a customer's own authorisation", async () => {
    const incoming = context({ cookie: `${SESSION_COOKIE}=${await mint()}` });

    await middleware()(incoming, render());

    expect(incoming.locals.idenzy.token?.amr).toEqual(["pwd"]);
    expect(incoming.locals.idenzy.token?.projectId).toBe(PROJECT);
  });

  /** An endpoint under `src/pages/api`, called by a client in header mode. */
  it("reads Authorization as well, for an endpoint rather than a page", async () => {
    const incoming = context({ authorization: `Bearer ${await mint()}` });

    await middleware()(incoming, render());

    expect(incoming.locals.idenzy.session?.userId).toBe("usr_00000000000000000001");
  });

  /**
   * Null renders `loading`, never a sign-in screen. The access-token cookie is the
   * short-lived one, so a visitor whose token expired an hour ago still holds a refresh
   * cookie and is still signed in.
   */
  it("leaves both halves null for a request carrying no credential", async () => {
    const incoming = context();

    await middleware()(incoming, render());

    expect(incoming.locals.idenzy).toEqual({ session: null, token: null });
  });

  /** One issuer serves every project, so the audience is the only thing separating tenants. */
  it("leaves both halves null for a valid token minted for another project", async () => {
    const incoming = context({ cookie: `${SESSION_COOKIE}=${await mint(OTHER)}` });

    await middleware()(incoming, render());

    expect(incoming.locals.idenzy.session).toBeNull();
  });

  it("returns what the page rendered, untouched", async () => {
    const incoming = context({ cookie: `${SESSION_COOKIE}=${await mint()}` });
    const answer = new Response("rendered", { status: 201 });

    const response = await middleware()(incoming, () => Promise.resolve(answer));

    expect(response).toBe(answer);
  });

  /**
   * The one that matters for availability. Middleware that threw would answer 500 for every
   * page on the site for the length of a JWKS outage, and the site does not need us to render.
   */
  it("still renders the page when the key set cannot be fetched at all", async () => {
    const incoming = context({ cookie: `${SESSION_COOKIE}=${await mint()}` });
    reachable = false;

    const response = await middleware()(incoming, render());

    expect((response as Response).status).toBe(200);
    expect(incoming.locals.idenzy.session).toBeNull();
  });

  /** Holding the verifier is the whole point of building the middleware at module scope. */
  it("fetches the key set once across requests, because one handler holds one verifier", async () => {
    const installed = middleware();
    const headers = { cookie: `${SESSION_COOKIE}=${await mint()}` };

    const first = context(headers);
    const second = context(headers);
    await installed(first, render());
    await installed(second, render());

    expect(second.locals.idenzy.session).toEqual(first.locals.idenzy.session);
    expect(fetches.filter((url) => url.includes("jwks.json"))).toHaveLength(1);
  });
});

describe("the type it hands back", () => {
  /**
   * Compile-time only. The middleware is generic in its context so that Astro's `APIContext`,
   * which has far more on it than `IdenzyApiContext` asks for, still satisfies it.
   */
  it("is assignable to Astro's own MiddlewareHandler", () => {
    const installed: AstroMiddlewareHandler = createIdenzyMiddleware({
      projectId: PROJECT,
      issuerUrl: ISSUER,
    });
    const minimal: IdenzyApiContext = context();

    expect(typeof installed).toBe("function");
    expect(minimal.request.headers.get("cookie")).toBeNull();
  });
});
