import { REVOCATION_SNAPSHOT_TYP } from "@idenzy/protocol/schemas/revocation";
import { type CryptoKey, exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { IdenzyRuntimeOptions } from "../src/runtime/options.js";
import { seedFromRequest } from "../src/runtime/server-session.js";

const ISSUER = "https://auth.acme.test";
const PROJECT = "prj_00000000000000000001";
const OTHER = "prj_00000000000000000002";
const SESSION = "ses_00000000000000000001";
const SESSION_COOKIE = "__Host-idenzy-session";

let jwks: JSONWebKeySet;
let signingKey: CryptoKey;
let mint: (audience?: string, issuer?: string) => Promise<string>;
let fetches: string[];

/** What reached the revocation endpoint, so a test can check how it authenticated. */
const polled: { url: string; authorization: string | null }[] = [];

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" }] };
  signingKey = privateKey;
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
  vi.stubGlobal("fetch", async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    fetches.push(url);
    // The revocation set is polled from the same origin as the key set, so one stub has to
    // answer both. A snapshot is signed on demand rather than held, because its `exp` is what
    // decides whether the cache believes it.
    if (url.includes("v1/revocations")) {
      polled.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(await snapshot([SESSION], new URL(url).origin));
    }
    return new Response(JSON.stringify(jwks), {
      headers: { "content-type": "application/json" },
    });
  });
});

/**
 * A real signed snapshot, because the cache checks the signature, the media type and `aud`
 * before believing any of it. Signed for whichever issuer asked, since these tests give a
 * test its own issuer URL to get a verifier no earlier one has warmed.
 */
async function snapshot(sessions: readonly string[], issuer: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    sessions: [...sessions],
    users: [],
    projectRevokedBefore: null,
    retentionSeconds: 360,
  })
    .setProtectedHeader({ alg: "ES256", kid: "k1", typ: REVOCATION_SNAPSHOT_TYP })
    .setIssuer(issuer)
    .setAudience(PROJECT)
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(signingKey);
}

afterEach(() => {
  fetches.length = 0;
  polled.length = 0;
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

describe("the revocation set, which this module builds because its options are serialised", () => {
  /**
   * The default. A customer who configured no secret key gets what they had before: a package
   * whose only outbound call is for the key set.
   */
  it("polls nothing at all without a secret key", async () => {
    const issuerUrl = "https://auth.no-secret.test";
    const cookie = { cookie: `${SESSION_COOKIE}=${await mint(PROJECT, issuerUrl)}` };

    const seed = await seedFromRequest(options({ issuerUrl }), cookie);

    expect(seed).not.toBeNull();
    expect(fetches.filter((url) => url.includes("v1/revocations"))).toHaveLength(0);
  });

  /**
   * Null and not signed-out, which is the same answer an expired token gets. The browser holds
   * the refresh cookie this server never had, and a revoked session's family is revoked with
   * it, so the rotation it tries next is what settles this honestly.
   */
  it("seeds null once the set names the session, with the token still perfectly valid", async () => {
    const issuerUrl = "https://auth.revoked.test";
    const cookie = { cookie: `${SESSION_COOKIE}=${await mint(PROJECT, issuerUrl)}` };
    const config = options({ issuerUrl });
    const server = { secretKey: "sk_test_abc" };

    // The first call builds the cache and starts it without waiting, so the poll it kicks off
    // lands a tick or two later. Until it does the cache reads stale and answers "not
    // revoked", which is the documented fail-open rather than a race this test is papering
    // over: it is what a deployment sees for its first few requests after a restart.
    await seedFromRequest(config, cookie, server);

    await vi.waitFor(async () => {
      expect(await seedFromRequest(config, cookie, server)).toBeNull();
    });
  });

  /** The set is a project's, so reaching it is authenticated as that project. */
  it("presents the secret key to the endpoint, and to nothing else", async () => {
    const issuerUrl = "https://auth.authorised.test";
    const cookie = { cookie: `${SESSION_COOKIE}=${await mint(PROJECT, issuerUrl)}` };

    await seedFromRequest(options({ issuerUrl }), cookie, { secretKey: "sk_test_abc" });
    await vi.waitFor(() => expect(polled.length).toBeGreaterThan(0));

    expect(polled[0]).toEqual({
      url: `${issuerUrl}/v1/revocations`,
      authorization: "Bearer sk_test_abc",
    });
    // The key set is public and is fetched by the same process. A secret key on that request
    // would be sent to a CDN edge and cached by it.
    expect(fetches.some((url) => url.includes("jwks.json"))).toBe(true);
    expect(polled.every((call) => call.url.includes("v1/revocations"))).toBe(true);
  });
});
