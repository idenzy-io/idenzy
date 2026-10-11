import { randomBytes } from "node:crypto";
import { Clock } from "@idenzy/core/time/clock";
import type { Jwk } from "@idenzy/protocol/schemas/discovery";
import { createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { KeyEncryption } from "../src/kms/key-encryption.js";
import { LocalKeyEncryption } from "../src/kms/local-key-encryption.js";
import {
  generateSigningKey,
  SigningKeyStore,
  WrappedEs256Issuer,
  type WrappedSigningKey,
} from "../src/tokens/wrapped-es256-issuer.js";

/**
 * The issuer every environment signs with (ADR-0021), through a real envelope and real keys.
 *
 * Nothing here is stubbed at the crypto boundary: actual P-256 pairs are generated, actually
 * wrapped with AES-GCM under a key the test holds, and the tokens that come out are verified with
 * `jose` against the published keys. A test that mocked the signing would prove the plumbing and
 * not that anything it mints can be verified by a customer, which is the only thing that matters.
 */
const ACME = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
const GLOBEX = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const audienceOf = (uuid: string): string => `prj_${uuid.replaceAll("-", "")}`;
const NOW = new Date("2026-09-15T12:00:00.000Z");

class FixedClock extends Clock {
  at = NOW;
  override now(): Date {
    return this.at;
  }
}

class MemoryKeys extends SigningKeyStore {
  reads = 0;
  published = 0;
  constructor(private readonly keys: Map<string, WrappedSigningKey>) {
    super();
  }
  override primary(projectId: string): Promise<WrappedSigningKey> {
    this.reads += 1;
    const key = this.keys.get(projectId);
    if (key === undefined) return Promise.reject(new Error(`no key for ${projectId}`));
    return Promise.resolve(key);
  }
  override publishable(projectId: string): Promise<readonly Jwk[]> {
    this.published += 1;
    const key = this.keys.get(projectId);
    return Promise.resolve(key === undefined ? [] : [key.publicJwk]);
  }
}

async function setUp(): Promise<{
  envelope: KeyEncryption;
  keys: MemoryKeys;
  issuer: WrappedEs256Issuer;
  clock: FixedClock;
}> {
  const envelope = new LocalKeyEncryption(randomBytes(32));
  const keys = new MemoryKeys(
    new Map([
      [ACME, await generateSigningKey(ACME, envelope)],
      [GLOBEX, await generateSigningKey(GLOBEX, envelope)],
    ]),
  );
  const clock = new FixedClock();
  const issuer = new WrappedEs256Issuer(clock, "https://auth.acme.test", 300, keys, envelope);
  return { envelope, keys, issuer, clock };
}

const mint = (issuer: WrappedEs256Issuer, projectId: string, sub = "usr_1") =>
  issuer.issue({ sub, sid: "ses_1", aud: audienceOf(projectId), amr: ["magic_link"] });

describe("minting a token with a wrapped key", () => {
  it("produces one a customer can verify against the project's published keys", async () => {
    const { issuer } = await setUp();
    const issued = await mint(issuer, ACME);

    // Verified the way a customer's backend verifies: offline, against JWKS, knowing nothing else.
    const jwks = createLocalJWKSet({ keys: [...(await issuer.publicKeys(ACME))] as never });
    const { payload, protectedHeader } = await jwtVerify(issued.token, jwks, {
      issuer: "https://auth.acme.test",
      audience: audienceOf(ACME),
      // Verified at the same instant it was minted, so the test breaks by the code and never by
      // the calendar.
      currentDate: NOW,
    });
    expect(payload["sub"]).toBe("usr_1");
    expect(protectedHeader.kid).toMatch(/^k_[0-9a-f]{16}$/);
    expect(protectedHeader.alg).toBe("ES256");
  });

  /**
   * The boundary per-project keys exist for: a verifier holding one project's keys cannot be
   * handed another project's token, whatever audience it was configured with.
   */
  it("signs each project's tokens with that project's key alone", async () => {
    const { issuer } = await setUp();
    const issued = await mint(issuer, GLOBEX);
    const acmeKeys = createLocalJWKSet({ keys: [...(await issuer.publicKeys(ACME))] as never });
    await expect(jwtVerify(issued.token, acmeKeys, { currentDate: NOW })).rejects.toThrow();
  });

  /**
   * The whole economic argument for this design. If the key were reopened per token, KMS would be
   * called about 158 times per monthly active user instead of once per process.
   */
  it("opens a project's key once however many tokens it mints", async () => {
    const { issuer, keys } = await setUp();
    for (let i = 0; i < 5; i += 1) await mint(issuer, ACME, `usr_${i}`);
    expect(keys.reads).toBe(1);
  });

  it("opens it once under a burst, not once per concurrent request", async () => {
    const { issuer, keys } = await setUp();
    // A cold start serving several requests at once: the single-flight is what stops this being
    // one KMS call each, exactly when the process is busiest.
    await Promise.all([0, 1, 2, 3].map((i) => mint(issuer, ACME, `usr_${i}`)));
    expect(keys.reads).toBe(1);
  });

  it("refuses a token addressed to something that is not a project", async () => {
    const { issuer } = await setUp();
    await expect(
      issuer.issue({ sub: "usr_1", sid: "ses_1", aud: "acme", amr: [] }),
    ).rejects.toThrowError();
  });
});

describe("a project's published keys", () => {
  /** Verifying in our own API reads them on every request, which must not be a query each. */
  it("are read once a minute, not once per request", async () => {
    const { issuer, keys, clock } = await setUp();
    await Promise.all([0, 1, 2].map(() => issuer.publicKeys(ACME)));
    await issuer.publicKeys(ACME);
    expect(keys.published).toBe(1);

    clock.at = new Date(NOW.getTime() + 61_000);
    await issuer.publicKeys(ACME);
    expect(keys.published).toBe(2);
  });
});

describe("a key that belongs to another project", () => {
  /**
   * The property the authenticated data buys, and the reason the project id is passed to `wrap`.
   * Without it a row lifted from one project's table into another's would open cleanly and this
   * project would start signing its tokens with somebody else's key — silently, and correctly as
   * far as any verifier could tell.
   */
  it("cannot be opened, so a swapped row fails instead of signing", async () => {
    const envelope = new LocalKeyEncryption(randomBytes(32));
    // Wrapped for GLOBEX, then served as ACME's.
    const foreign = await generateSigningKey(GLOBEX, envelope);
    const keys = new MemoryKeys(new Map([[ACME, foreign]]));
    const issuer = new WrappedEs256Issuer(new FixedClock(), "https://a.test", 300, keys, envelope);

    await expect(mint(issuer, ACME)).rejects.toThrowError();
  });
});
