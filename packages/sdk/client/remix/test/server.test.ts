import type { SessionSnapshot } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier } from "@idenzy/node";
import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { IdenzyServer } from "../src/server.js";

const ISSUER = "https://auth.acme.test";
const PROJECT = "prj_00000000000000000001";
const OTHER = "prj_00000000000000000002";
const SESSION_COOKIE = "__Host-idenzy-session";

/** Remix's `LoaderFunctionArgs` and what a loader is, transcribed. */
interface LoaderFunctionArgs {
  request: Request;
  params: Record<string, string | undefined>;
  context: Record<string, unknown>;
}

type LoaderFunction = (
  args: LoaderFunctionArgs,
) => Promise<{ readonly session: SessionSnapshot | null }>;

let jwks: JSONWebKeySet;
let mint: (audience?: string) => Promise<string>;
let reachable: boolean;
let idenzy: IdenzyServer;

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

  reachable = true;
  vi.stubGlobal("fetch", () => {
    if (!reachable) return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(
      new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } }),
    );
  });
  idenzy = new IdenzyServer({ projectId: PROJECT, issuerUrl: ISSUER });
});

afterEach(() => {
  reachable = true;
  vi.restoreAllMocks();
});

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://acme.test/dashboard", { headers });
}

describe("the answer a loader gets", () => {
  it("seeds the user and the session from a live access-token cookie", async () => {
    const session = await idenzy.sessionFor(
      request({ cookie: `${SESSION_COOKIE}=${await mint()}` }),
    );

    expect(session).toEqual({
      status: "signed-in",
      userId: "usr_00000000000000000001",
      user: null,
      sessionId: "ses_00000000000000000001",
    });
  });

  it("hands back the claims for a customer's own authorisation", async () => {
    const verified = await idenzy.verify(request({ cookie: `${SESSION_COOKIE}=${await mint()}` }));

    expect(verified?.amr).toEqual(["pwd"]);
    expect(verified?.projectId).toBe(PROJECT);
  });

  /** An action or a resource route called by a client in header mode, which sends no cookie. */
  it("reads Authorization as well, for a resource route rather than a page", async () => {
    const session = await idenzy.sessionFor(request({ authorization: `Bearer ${await mint()}` }));

    expect(session?.userId).toBe("usr_00000000000000000001");
  });

  /**
   * Null renders `loading`, never a sign-in screen. The access-token cookie is the
   * short-lived one, so a visitor whose token expired an hour ago still holds a refresh
   * cookie and is still signed in.
   */
  it("is null for a request carrying no credential, which is a state and not an error", async () => {
    expect(await idenzy.sessionFor(request())).toBeNull();
  });

  /** One issuer serves every project, so the audience is the only thing separating tenants. */
  it("is null for a valid token minted for another project", async () => {
    const session = await idenzy.sessionFor(
      request({ cookie: `${SESSION_COOKIE}=${await mint(OTHER)}` }),
    );

    expect(session).toBeNull();
  });

  /**
   * A loader that threw would put a customer's error boundary in front of every page on the
   * site for the length of a JWKS outage, and the site does not need us in order to render.
   */
  it("is null rather than a throw when the key set cannot be fetched at all", async () => {
    const cold = new IdenzyServer({ projectId: PROJECT, issuerUrl: "https://auth.cold.test" });
    reachable = false;

    await expect(
      cold.sessionFor(request({ cookie: `${SESSION_COOKIE}=${await mint()}` })),
    ).resolves.toBeNull();
  });
});

describe("one answer per request", () => {
  /**
   * Remix runs a page's loaders in parallel and may run an action before them. Verifying per
   * call lets two of them straddle the token's `exp` and render one page from two different
   * answers, which is a header that says signed in above a body that does not.
   */
  it("verifies once however many loaders ask about the same request", async () => {
    const verifying = vi.spyOn(AccessTokenVerifier.prototype, "verifyRequest");
    const incoming = request({ cookie: `${SESSION_COOKIE}=${await mint()}` });

    const [root, nested, claims] = await Promise.all([
      idenzy.sessionFor(incoming),
      idenzy.sessionFor(incoming),
      idenzy.verify(incoming),
    ]);

    expect(verifying).toHaveBeenCalledTimes(1);
    expect(nested).toEqual(root);
    expect(claims?.sessionId).toBe(root?.sessionId);
  });

  it("gives the next request its own answer", async () => {
    const verifying = vi.spyOn(AccessTokenVerifier.prototype, "verifyRequest");
    const cookie = { cookie: `${SESSION_COOKIE}=${await mint()}` };

    await idenzy.sessionFor(request(cookie));
    await idenzy.sessionFor(request(cookie));

    expect(verifying).toHaveBeenCalledTimes(2);
  });
});

describe("the loader it is called from", () => {
  /** Compile-time as much as anything: this is the whole of a root loader. */
  it("returns the seed a root loader hands the browser", async () => {
    const loader: LoaderFunction = async ({ request: incoming }) => ({
      session: await idenzy.sessionFor(incoming),
    });

    const data = await loader({
      request: request({ cookie: `${SESSION_COOKIE}=${await mint()}` }),
      params: {},
      context: {},
    });

    expect(data.session?.status).toBe("signed-in");
  });
});
