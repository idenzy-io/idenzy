import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from "node:crypto";
import { Clock } from "@idenzy/core/time/clock";
import type { Jwk } from "@idenzy/protocol/schemas/discovery";
import { createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { KeyEncryption } from "../src/kms/key-encryption.js";
import {
  SigningKeyStore,
  WrappedEs256Issuer,
  type WrappedSigningKey,
} from "../src/tokens/wrapped-es256-issuer.js";

/**
 * The production issuer (ADR-0017), through a real envelope and a real key.
 *
 * Nothing here is stubbed at the crypto boundary: an actual P-256 key pair is generated, actually
 * wrapped with AES-GCM under a key the test holds, and the token that comes out is verified with
 * `jose` against the published JWKS. A test that mocked the signing would prove the plumbing and
 * not that anything it mints can be verified by a customer, which is the only thing that matters.
 */
const PROJECT = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
const OTHER_PROJECT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

class FixedClock extends Clock {
  override now(): Date {
    return new Date("2026-09-15T12:00:00.000Z");
  }
}

/**
 * AES-256-GCM standing in for the cell's KMS key, with the context as additional authenticated
 * data — which is the property the real adapter passes to KMS and the one worth exercising.
 */
class LocalEnvelope extends KeyEncryption {
  private readonly kek = randomBytes(32);

  override wrap(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.kek, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  override unwrap(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    const raw = Buffer.from(ciphertext);
    const decipher = createDecipheriv("aes-256-gcm", this.kek, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Promise.resolve(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]));
  }
}

class MemoryKeys extends SigningKeyStore {
  reads = 0;
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
    const key = this.keys.get(projectId);
    return Promise.resolve(key === undefined ? [] : [key.publicJwk]);
  }
}

async function mintKey(
  envelope: KeyEncryption,
  projectId: string,
  kid: string,
): Promise<WrappedSigningKey> {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string; y?: string };
  return {
    kid,
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x ?? "",
      y: jwk.y ?? "",
      kid,
      alg: "ES256",
      use: "sig",
    },
    privateKeyWrapped: Buffer.from(await envelope.wrap(pkcs8, projectId)).toString("base64"),
  };
}

function issuerFor(
  envelope: KeyEncryption,
  keys: MemoryKeys,
  projectId = PROJECT,
): WrappedEs256Issuer {
  return new WrappedEs256Issuer(
    new FixedClock(),
    "https://auth.acme.test",
    300,
    projectId,
    keys,
    envelope,
  );
}

describe("minting a token with a wrapped key", () => {
  it("produces one a customer can verify against the published JWKS", async () => {
    const envelope = new LocalEnvelope();
    const keys = new MemoryKeys(new Map([[PROJECT, await mintKey(envelope, PROJECT, "k1")]]));
    const issuer = issuerFor(envelope, keys);

    const issued = await issuer.issue({
      sub: "usr_1",
      sid: "ses_1",
      aud: PROJECT,
      amr: ["pwd"],
    });

    // Verified the way a customer's backend verifies: offline, against JWKS, knowing nothing else.
    const jwks = createLocalJWKSet({ keys: [...(await issuer.publicKeys())] as never });
    const { payload, protectedHeader } = await jwtVerify(issued.token, jwks, {
      issuer: "https://auth.acme.test",
      audience: PROJECT,
      // Verified at the same instant it was minted. The issuer takes its time from the injected
      // clock, so checking `exp` against the wall clock would fail whenever the two drift apart —
      // which is a test that breaks by the calendar rather than by the code.
      currentDate: new FixedClock().now(),
    });
    expect(payload["sub"]).toBe("usr_1");
    expect(protectedHeader.kid).toBe("k1");
    expect(protectedHeader.alg).toBe("ES256");
  });

  /**
   * The whole economic argument for this design. If the key were re-opened per token, KMS would be
   * called about 158 times per monthly active user instead of once per process — which is the cost
   * and the latency ADR-0017 exists to avoid.
   */
  it("opens the key once however many tokens it mints", async () => {
    const envelope = new LocalEnvelope();
    const keys = new MemoryKeys(new Map([[PROJECT, await mintKey(envelope, PROJECT, "k1")]]));
    const issuer = issuerFor(envelope, keys);

    for (let i = 0; i < 5; i += 1) {
      await issuer.issue({ sub: `usr_${i}`, sid: "ses_1", aud: PROJECT, amr: ["pwd"] });
    }
    expect(keys.reads).toBe(1);
  });

  it("opens it once under a burst, not once per concurrent request", async () => {
    const envelope = new LocalEnvelope();
    const keys = new MemoryKeys(new Map([[PROJECT, await mintKey(envelope, PROJECT, "k1")]]));
    const issuer = issuerFor(envelope, keys);

    // A cold start serving several requests at once: the single-flight is what stops this being
    // one KMS call each, exactly when the process is busiest.
    await Promise.all(
      [0, 1, 2, 3].map((i) =>
        issuer.issue({ sub: `usr_${i}`, sid: "ses_1", aud: PROJECT, amr: ["pwd"] }),
      ),
    );
    expect(keys.reads).toBe(1);
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
    const envelope = new LocalEnvelope();
    // Wrapped for OTHER_PROJECT, then served to an issuer for PROJECT.
    const foreign = await mintKey(envelope, OTHER_PROJECT, "k1");
    const keys = new MemoryKeys(new Map([[PROJECT, foreign]]));
    const issuer = issuerFor(envelope, keys);

    await expect(
      issuer.issue({ sub: "usr_1", sid: "ses_1", aud: PROJECT, amr: ["pwd"] }),
    ).rejects.toThrowError();
  });
});
