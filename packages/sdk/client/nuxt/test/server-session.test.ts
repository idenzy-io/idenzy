import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdenzyRuntimeOptions } from "../src/runtime/options.js";
import { seedFromRequest } from "../src/runtime/server-session.js";

const ISSUER = "https://auth.acme.test";
const PROJECT = "prj_00000000000000000001";
const OTHER = "prj_00000000000000000002";
const SESSION_COOKIE = "__Host-idenzy-session";

let jwks: JSONWebKeySet;
let mint: (audience?: string, issuer?: string) => Promise<string>;
let fetches: string[];

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" }] };
  mint = (audience = PROJECT, issuer = ISSUER) =>
    new SignJWT({ sid: "ses_00000000000000000001", amr: ["pwd"] })
      .setProtectedHeader({ alg: "ES256", kid: "k1", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("usr_00000000000000000001")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
});

beforeAll(() => {
  fetches = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    fetches.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } }),
    );
  });
});

afterEach(() => {
  fetches.length = 0;
});

function options(overrides: Partial<IdenzyRuntimeOptions> = {}): IdenzyRuntimeOptions {
  return { publishableKey: "pk_test_abc", apiUrl: ISSUER, projectId: PROJECT, ...overrides };
}

describe("what the server can tell from the request", () => {
  it("seeds the user and the session from a live access-token cookie", async () => {
    const seed = await seedFromRequest(options(), {
      cookie: `${SESSION_COOKIE}=${await mint()}`,
    });

    expect(seed).toEqual({
      status: "signed-in",
      userId: "usr_00000000000000000001",
      user: null,
      sessionId: "ses_00000000000000000001",
    });
  });

  /**
   * Null renders `loading`, not a sign-in screen. The access-token cookie is the short-lived
   * one, so a user whose token expired an hour ago still holds a refresh cookie and is still
   * signed in; rendering them signed-out would put the wrong screen in the HTML.
   */
  it("answers null for a request with no cookie at all", async () => {
    expect(await seedFromRequest(options(), {})).toBeNull();
  });

  it("answers null for a token minted for another project, without throwing", async () => {
    const seed = await seedFromRequest(options({ projectId: OTHER, issuerUrl: ISSUER }), {
      cookie: `${SESSION_COOKIE}=${await mint(PROJECT)}`,
    });

    expect(seed).toBeNull();
  });

  it("does not go looking when no project was configured to check against", async () => {
    const seed = await seedFromRequest(
      { publishableKey: "pk_test_abc", apiUrl: ISSUER },
      { cookie: `${SESSION_COOKIE}=${await mint()}` },
    );

    expect(seed).toBeNull();
    expect(fetches).toHaveLength(0);
  });

  /** Holding the verifier is the whole point: the key set is cached inside it. */
  it("fetches the key set once across requests, because the verifier is held", async () => {
    // Its own issuer, so this is a verifier no earlier test has already built and warmed.
    const issuerUrl = "https://auth.held.test";
    const cookie = { cookie: `${SESSION_COOKIE}=${await mint(PROJECT, issuerUrl)}` };

    const first = await seedFromRequest(options({ issuerUrl }), cookie);
    const second = await seedFromRequest(options({ issuerUrl }), cookie);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(fetches.filter((url) => url.includes("jwks.json"))).toHaveLength(1);
  });
});
