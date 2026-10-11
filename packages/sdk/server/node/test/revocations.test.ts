import { SessionRevokedError } from "@idenzy/core/errors";
import { REVOCATION_SNAPSHOT_TYP } from "@idenzy/protocol/schemas/revocation";
import { SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AccessTokenVerifier } from "../src/idenzy-node.js";
import { StaticJwks } from "../src/jwks.js";
import { RevocationCache } from "../src/revocations.js";
import { ISSUER, PROJECT, type TestIssuer, testIssuer } from "./fixtures.js";

const SESSION = "ses_00000000000000000001";
const USER = "usr_00000000000000000001";

let tokens: TestIssuer;
let signer: (claims: Record<string, unknown>, options?: SnapshotOptions) => Promise<string>;
const caches: RevocationCache[] = [];

interface SnapshotOptions {
  readonly typ?: string;
  readonly audience?: string;
  readonly expiresInSeconds?: number;
}

beforeAll(async () => {
  tokens = await testIssuer();
  signer = async (claims, options = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ retentionSeconds: 360, ...claims })
      .setProtectedHeader({
        alg: "ES256",
        kid: "test-key",
        typ: options.typ ?? REVOCATION_SNAPSHOT_TYP,
      })
      .setIssuer(ISSUER)
      .setAudience(options.audience ?? PROJECT)
      .setIssuedAt(now)
      .setExpirationTime(now + (options.expiresInSeconds ?? 120))
      .sign(await tokens.privateKey());
  };
});

afterEach(() => {
  for (const cache of caches.splice(0)) cache.close();
});

/** Answers one body, and records what it was asked. */
function serving(
  body: () => Promise<string> | string,
  init: { status?: number; etag?: string } = {},
): { fetch: typeof globalThis.fetch; calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (input, requestInit) => {
      calls.push(new Request(String(input), requestInit));
      const status = init.status ?? 200;
      return new Response(status === 304 ? null : await body(), {
        status,
        headers: init.etag === undefined ? {} : { etag: init.etag },
      });
    },
  };
}

async function cacheOver(fetch: typeof globalThis.fetch): Promise<RevocationCache> {
  const cache = new RevocationCache(
    { issuerUrl: ISSUER, projectId: PROJECT, secretKey: "sk_test", fetch },
    new StaticJwks(tokens.jwks),
  );
  caches.push(cache);
  await cache.start();
  return cache;
}

function token(overrides: Partial<{ sessionId: string; userId: string; issuedAt: Date }> = {}) {
  return { sessionId: SESSION, userId: USER, issuedAt: new Date(), ...overrides };
}

describe("what the cache answers", () => {
  it("says revoked for a session in the published set", async () => {
    const cache = await cacheOver(
      serving(() => signer({ sessions: [SESSION], users: [], projectRevokedBefore: null })).fetch,
    );

    expect(cache.isRevoked(token())).toBe(true);
    expect(cache.isRevoked(token({ sessionId: "ses_00000000000000000002" }))).toBe(false);
  });

  /** A refresh mints a new token for the same session, so `iat` moves and `sid` does not. */
  it("keeps a revoked session revoked however recently its token was minted", async () => {
    const cache = await cacheOver(
      serving(() => signer({ sessions: [SESSION], users: [], projectRevokedBefore: null })).fetch,
    );

    expect(cache.isRevoked(token({ issuedAt: new Date(Date.now() + 60_000) }))).toBe(true);
  });

  it("applies a user watermark to tokens issued before it", async () => {
    const watermark = Math.floor(Date.now() / 1000);
    const cache = await cacheOver(
      serving(() =>
        signer({
          sessions: [],
          users: [{ userId: USER, revokedBefore: watermark }],
          projectRevokedBefore: null,
        }),
      ).fetch,
    );

    expect(cache.isRevoked(token({ issuedAt: new Date((watermark - 30) * 1000) }))).toBe(true);
  });

  /**
   * `iat` is second-accurate, so a token minted after the revocation but inside the same
   * second cannot be told from one minted before it. Sparing it under-revokes by under a
   * second; killing it revokes a token issued after the event, which no client can clear.
   */
  it("spares a token issued in the watermark's own second", async () => {
    const watermark = Math.floor(Date.now() / 1000);
    const cache = await cacheOver(
      serving(() =>
        signer({
          sessions: [],
          users: [{ userId: USER, revokedBefore: watermark }],
          projectRevokedBefore: null,
        }),
      ).fetch,
    );

    expect(cache.isRevoked(token({ issuedAt: new Date(watermark * 1000) }))).toBe(false);
  });

  it("keeps a user's latest watermark when the set lists them twice", async () => {
    const watermark = Math.floor(Date.now() / 1000);
    const cache = await cacheOver(
      serving(() =>
        signer({
          sessions: [],
          users: [
            { userId: USER, revokedBefore: watermark },
            { userId: USER, revokedBefore: watermark - 60 },
          ],
          projectRevokedBefore: null,
        }),
      ).fetch,
    );

    expect(cache.isRevoked(token({ issuedAt: new Date((watermark - 30) * 1000) }))).toBe(true);
  });

  it("applies a project watermark to everybody", async () => {
    const watermark = Math.floor(Date.now() / 1000);
    const cache = await cacheOver(
      serving(() => signer({ sessions: [], users: [], projectRevokedBefore: watermark })).fetch,
    );

    expect(
      cache.isRevoked(token({ userId: "usr_other", issuedAt: new Date((watermark - 30) * 1000) })),
    ).toBe(true);
  });
});

describe("a snapshot it should not believe", () => {
  /**
   * The same project key signs access tokens. Without the media type check an access token
   * would parse as a snapshot, and a caller could then choose whose sessions this process
   * thinks are revoked (RFC 8725 section 3.11).
   */
  it("refuses one typed as an access token", async () => {
    const cache = await cacheOver(
      serving(() =>
        signer({ sessions: [SESSION], users: [], projectRevokedBefore: null }, { typ: "JWT" }),
      ).fetch,
    );

    expect(cache.status().stale).toBe(true);
    expect(cache.isRevoked(token())).toBe(false);
  });

  /** One issuer serves every project, so the audience is what separates tenants. */
  it("refuses one minted for another project", async () => {
    const cache = await cacheOver(
      serving(() =>
        signer(
          { sessions: [SESSION], users: [], projectRevokedBefore: null },
          { audience: "prj_00000000000000000002" },
        ),
      ).fetch,
    );

    expect(cache.status().stale).toBe(true);
  });

  it("refuses one that is not shaped like a snapshot", async () => {
    const cache = await cacheOver(serving(() => signer({ nonsense: true })).fetch);

    expect(cache.status().stale).toBe(true);
  });
});

describe("when we cannot be reached", () => {
  /**
   * The documented fail-open. The exposure that returns is the one the customer had before
   * they turned this on, a revocation waiting for the token to expire. Throwing instead would
   * turn an outage of ours into one of theirs on every request.
   */
  it("starts, reports stale and revokes nothing", async () => {
    const cache = await cacheOver(() => Promise.reject(new TypeError("fetch failed")));

    expect(cache.status().stale).toBe(true);
    expect(cache.status().lastSuccessAt).toBeNull();
    expect(cache.isRevoked(token())).toBe(false);
  });

  it("stops trusting a snapshot once it has expired", async () => {
    const cache = await cacheOver(
      serving(() =>
        signer(
          { sessions: [SESSION], users: [], projectRevokedBefore: null },
          { expiresInSeconds: -1 },
        ),
      ).fetch,
    );

    // Signed by us, readable, and past its expiry. Anything on the path can serve an old
    // copy, so an expiry is what turns a withheld snapshot into a visible state.
    expect(cache.status().stale).toBe(true);
    expect(cache.isRevoked(token())).toBe(false);
  });
});

describe("polling", () => {
  it("sends the secret key, because the set is not public", async () => {
    const served = serving(() => signer({ sessions: [], users: [], projectRevokedBefore: null }));
    await cacheOver(served.fetch);

    expect(served.calls[0]?.headers.get("authorization")).toBe("Bearer sk_test");
  });

  it("asks the auth API for the project's own set", async () => {
    const served = serving(() => signer({ sessions: [], users: [], projectRevokedBefore: null }));
    await cacheOver(served.fetch);

    expect(served.calls[0]?.url).toBe(`${ISSUER}/v1/revocations`);
  });
});

describe("a verifier holding one", () => {
  it("refuses a token whose session has been revoked", async () => {
    const cache = await cacheOver(
      serving(() => signer({ sessions: [SESSION], users: [], projectRevokedBefore: null })).fetch,
    );
    const verifier = new AccessTokenVerifier(
      { issuerUrl: ISSUER, projectId: PROJECT, revocations: cache },
      new StaticJwks(tokens.jwks),
    );

    await expect(verifier.verify(await tokens.mint())).rejects.toBeInstanceOf(SessionRevokedError);
  });

  /** A revoked session is a different answer from a token that was never ours. */
  it("still accepts a token whose session is not in the set", async () => {
    const cache = await cacheOver(
      serving(() => signer({ sessions: [], users: [], projectRevokedBefore: null })).fetch,
    );
    const verifier = new AccessTokenVerifier(
      { issuerUrl: ISSUER, projectId: PROJECT, revocations: cache },
      new StaticJwks(tokens.jwks),
    );

    await expect(verifier.verify(await tokens.mint())).resolves.toMatchObject({
      sessionId: SESSION,
    });
  });
});
