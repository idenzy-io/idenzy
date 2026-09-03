import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createIdenzyHandle,
  type IdenzyRequestEvent,
  type IdenzyServerSession,
} from "../src/server.js";

const ISSUER = "https://auth.acme.test";
const PROJECT = "prj_00000000000000000001";
const OTHER = "prj_00000000000000000002";
const SESSION_COOKIE = "__Host-idenzy-session";

/**
 * SvelteKit's `Handle` and the event it carries, transcribed.
 *
 * This package declares the two properties it touches rather than depending on
 * `@sveltejs/kit`, so what is checked here is the part that would break silently: an event
 * with more on it than we ask for, and a `resolve` with an extra optional argument, still
 * satisfy the handle we hand back.
 */
interface KitRequestEvent {
  request: Request;
  url: URL;
  params: Partial<Record<string, string>>;
  route: { id: string | null };
  isDataRequest: boolean;
  setHeaders(headers: Record<string, string>): void;
  locals: { idenzy: IdenzyServerSession };
}

type KitHandle = (input: {
  event: KitRequestEvent;
  resolve: (
    event: KitRequestEvent,
    options?: { transformPageChunk?: (input: { html: string }) => string },
  ) => Response | Promise<Response>;
}) => Response | Promise<Response>;

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

function handle(): KitHandle {
  return createIdenzyHandle({ projectId: PROJECT, issuerUrl: ISSUER });
}

/** What SvelteKit hands a handle: an event whose `locals` starts empty. */
function event(headers: Record<string, string> = {}): KitRequestEvent {
  return {
    request: new Request("https://app.acme.test/app/settings", { headers }),
    url: new URL("https://app.acme.test/app/settings"),
    params: {},
    route: { id: "/app/settings" },
    isDataRequest: false,
    setHeaders: () => undefined,
    locals: {} as KitRequestEvent["locals"],
  };
}

function pass(): (incoming: KitRequestEvent) => Response {
  return () => new Response("rendered");
}

describe("the handle a hooks.server.ts installs", () => {
  it("seeds the user and the session from a live access-token cookie", async () => {
    const incoming = event({ cookie: `${SESSION_COOKIE}=${await mint()}` });

    await handle()({ event: incoming, resolve: pass() });

    expect(incoming.locals.idenzy.session).toEqual({
      status: "signed-in",
      userId: "usr_00000000000000000001",
      user: null,
      sessionId: "ses_00000000000000000001",
    });
  });

  it("carries the claims through for a customer's own authorisation", async () => {
    const incoming = event({ cookie: `${SESSION_COOKIE}=${await mint()}` });

    await handle()({ event: incoming, resolve: pass() });

    expect(incoming.locals.idenzy.token?.amr).toEqual(["pwd"]);
    expect(incoming.locals.idenzy.token?.projectId).toBe(PROJECT);
  });

  /** A `+server.ts` route called by a client in header mode, which sends no cookie. */
  it("reads Authorization as well, for an API route rather than a page", async () => {
    const incoming = event({ authorization: `Bearer ${await mint()}` });

    await handle()({ event: incoming, resolve: pass() });

    expect(incoming.locals.idenzy.session?.userId).toBe("usr_00000000000000000001");
  });

  /**
   * Null renders `loading`, never a sign-in screen. The access-token cookie is the
   * short-lived one, so a visitor whose token expired an hour ago still holds a refresh
   * cookie and is still signed in; putting the signed-out tree in the HTML would show them a
   * sign-in form the next request proves they do not need.
   */
  it("leaves both halves null for a request carrying no credential", async () => {
    const incoming = event();

    await handle()({ event: incoming, resolve: pass() });

    expect(incoming.locals.idenzy).toEqual({ session: null, token: null });
  });

  /** One issuer serves every project, so the audience is the only thing separating tenants. */
  it("leaves both halves null for a valid token minted for another project", async () => {
    const incoming = event({ cookie: `${SESSION_COOKIE}=${await mint(OTHER)}` });

    await handle()({ event: incoming, resolve: pass() });

    expect(incoming.locals.idenzy.session).toBeNull();
  });

  it("hands the event to resolve and returns what it answered, untouched", async () => {
    const incoming = event({ cookie: `${SESSION_COOKIE}=${await mint()}` });
    const seen: KitRequestEvent[] = [];
    const answer = new Response("rendered", { status: 201 });

    const response = await handle()({
      event: incoming,
      resolve: (received) => {
        seen.push(received);
        return answer;
      },
    });

    expect(seen).toEqual([incoming]);
    expect(response).toBe(answer);
  });

  /**
   * The one that matters for availability. A handle that threw would answer 500 for every
   * page on the site for the length of a JWKS outage, and the site does not need us to render.
   */
  it("still renders the page when the key set cannot be fetched at all", async () => {
    const incoming = event({ cookie: `${SESSION_COOKIE}=${await mint()}` });
    reachable = false;

    const response = await handle()({ event: incoming, resolve: pass() });

    expect(response.status).toBe(200);
    expect(incoming.locals.idenzy.session).toBeNull();
  });

  /** Holding the verifier is the whole point of building the handle at module scope. */
  it("fetches the key set once across requests, because one handle holds one verifier", async () => {
    const installed = handle();
    const cookie = { cookie: `${SESSION_COOKIE}=${await mint()}` };

    const first = event(cookie);
    const second = event(cookie);
    await installed({ event: first, resolve: pass() });
    await installed({ event: second, resolve: pass() });

    expect(second.locals.idenzy.session).toEqual(first.locals.idenzy.session);
    expect(fetches.filter((url) => url.includes("jwks.json"))).toHaveLength(1);
  });
});

describe("the type it hands back", () => {
  /**
   * Compile-time only. The handle is generic in its event so that SvelteKit's `RequestEvent`,
   * which has far more on it than `IdenzyRequestEvent` asks for, still satisfies the
   * `resolve` callback it is passed back into.
   */
  it("is assignable to SvelteKit's own Handle", () => {
    const installed: KitHandle = createIdenzyHandle({ projectId: PROJECT, issuerUrl: ISSUER });
    const minimal: IdenzyRequestEvent = event();

    expect(typeof installed).toBe("function");
    expect(minimal.request.headers.get("cookie")).toBeNull();
  });
});
