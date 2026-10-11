import { createPrivateKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { Jwk } from "@idenzy/protocol/schemas/discovery";
import { type CryptoKey, SignJWT } from "jose";
import type { KeyEncryption } from "../kms/key-encryption.js";
import { TokenIssuer } from "./token-issuer.js";

/** One project's key material, as the store holds it: public in the clear, private wrapped. */
export interface WrappedSigningKey {
  readonly kid: string;
  readonly publicJwk: Jwk;
  /** PKCS#8, wrapped by the deployment's KMS key with the project id as context. Base64. */
  readonly privateKeyWrapped: string;
}

/**
 * Where projects' signing keys live.
 *
 * A port rather than a repository, so `@idenzy/crypto` depends on no database: the auth API binds
 * it to `project_signing_keys` and a test binds it to a map.
 */
export abstract class SigningKeyStore {
  /**
   * The key new tokens are signed with, created the first time a project needs one.
   *
   * Created on use rather than with the project, so every way a project comes into being — the
   * panel, provisioning, a seed, a project that existed before keys did — gets one without each
   * of them having to remember.
   */
  abstract primary(projectId: string): Promise<WrappedSigningKey>;
  /** Every key a live token might have been signed with, for the project's JWKS. */
  abstract publishable(projectId: string): Promise<readonly Jwk[]>;
}

/**
 * A new signing key for one project: a P-256 pair, the private half wrapped under the project id.
 *
 * Generated here, in the process, and never sent anywhere unwrapped. The kid is random rather
 * than derived from the key, so it says nothing about the key it names.
 */
export async function generateSigningKey(
  projectId: string,
  wrapping: KeyEncryption,
): Promise<WrappedSigningKey> {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string; y?: string };
  const kid = `k_${randomBytes(8).toString("hex")}`;
  const wrapped = await wrapping.wrap(pkcs8, projectId);
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
    privateKeyWrapped: Buffer.from(wrapped).toString("base64"),
  };
}

export interface WrappedEs256IssuerOptions {
  /**
   * How long a project's public keys are held before they are read again.
   *
   * A minute: verifying a token in our own API reads them, and that must not be a query per
   * request. A rotation publishes the next key before it signs with it, so a minute's lag in
   * seeing a new key costs nothing.
   */
  readonly publishedTtlMs?: number;
}

interface Opened {
  readonly key: CryptoKey;
  readonly kid: string;
}

/**
 * ES256 signing with a key per project, which KMS holds the wrapping for (ADR-0021).
 *
 * **Not a KMS call per token.** Signing every token with KMS `asymmetricSign` would put a network
 * call — from a VPS, an internet call — on the hottest path in the product, about 158 times per
 * monthly active user, and a key per project in KMS would be a per-tenant fixed cost. So KMS holds
 * one key per deployment and wraps the per-project signing keys; this unwraps a project's key the
 * first time it mints a token and caches it for the life of the process. Signing after that is
 * local and takes microseconds.
 *
 * What it costs, stated rather than buried: the unwrapped private key is in process memory. That is
 * a weaker posture than a non-exportable HSM key, and not a weaker control: the key material is
 * encrypted at rest, access-controlled, auditable through KMS and rotatable. What the per-project
 * key buys is a boundary: a project's key signs that project's tokens and nothing else, so a
 * verifier holding one project's key set cannot be handed a token minted for another.
 *
 * The cache is unbounded on purpose and bounded in practice: one small key per project this process
 * has served, dropped when it restarts. Evicting would mean a KMS call to reopen a key that is about
 * to be used again, which is the cost this design exists to avoid.
 */
export class WrappedEs256Issuer extends TokenIssuer {
  private readonly opened = new Map<string, Opened>();
  private readonly opening = new Map<string, Promise<Opened>>();
  private readonly published = new Map<string, { keys: readonly Jwk[]; until: number }>();
  private readonly publishing = new Map<string, Promise<readonly Jwk[]>>();
  private readonly publishedTtlMs: number;

  constructor(
    clock: Clock,
    issuer: string,
    ttlSeconds: number,
    private readonly keys: SigningKeyStore,
    private readonly wrapping: KeyEncryption,
    options: WrappedEs256IssuerOptions = {},
  ) {
    super(clock, issuer, ttlSeconds);
    this.publishedTtlMs = options.publishedTtlMs ?? 60_000;
  }

  protected override async sign(
    audience: string,
    header: object,
    payload: object,
  ): Promise<{ jwt: string; kid: string }> {
    const { key, kid } = await this.signingKey(projectOf(audience));
    const jwt = await new SignJWT({ ...payload })
      .setProtectedHeader({ ...header, alg: "ES256", kid } as never)
      .sign(key);
    return { jwt, kid };
  }

  /** Held for `publishedTtlMs`, and read once however many requests ask at the same moment. */
  override publicKeys(projectId: string): Promise<readonly Jwk[]> {
    const held = this.published.get(projectId);
    if (held !== undefined && held.until > this.clock.nowMs()) return Promise.resolve(held.keys);

    const inFlight = this.publishing.get(projectId);
    if (inFlight !== undefined) return inFlight;

    const reading = this.keys
      .publishable(projectId)
      .then((keys) => {
        this.published.set(projectId, { keys, until: this.clock.nowMs() + this.publishedTtlMs });
        return keys;
      })
      .finally(() => {
        this.publishing.delete(projectId);
      });
    this.publishing.set(projectId, reading);
    return reading;
  }

  /**
   * The unwrapped key, opened at most once per project per process.
   *
   * Single-flight: a cold start serving a burst for one project would otherwise make one KMS call
   * per concurrent request, which is both the cost and the latency this design exists to avoid —
   * and it happens exactly when the process is busiest.
   */
  private signingKey(projectId: string): Promise<Opened> {
    const cached = this.opened.get(projectId);
    if (cached !== undefined) return Promise.resolve(cached);

    const inFlight = this.opening.get(projectId);
    if (inFlight !== undefined) return inFlight;

    const opening = this.open(projectId)
      .then((opened) => {
        this.opened.set(projectId, opened);
        return opened;
      })
      .finally(() => {
        this.opening.delete(projectId);
      });
    this.opening.set(projectId, opening);
    return opening;
  }

  private async open(projectId: string): Promise<Opened> {
    const stored = await this.keys.primary(projectId);

    // The project id is the context the key was wrapped under, so a row lifted from another
    // project fails here rather than quietly signing this project's tokens with somebody else's
    // key.
    const pkcs8 = await this.wrapping.unwrap(
      Buffer.from(stored.privateKeyWrapped, "base64"),
      projectId,
    );

    let key: CryptoKey;
    try {
      key = createPrivateKey({
        key: Buffer.from(pkcs8),
        format: "der",
        type: "pkcs8",
      }) as unknown as CryptoKey;
    } catch (cause: unknown) {
      throw new InternalError({
        // The kid, never the bytes. This is the one error in the system whose detail could
        // trivially become the key itself.
        detail: {
          projectId,
          kid: stored.kid,
          reason: "the unwrapped key is not a usable PKCS#8 private key",
        },
        cause,
      });
    }
    return { key, kid: stored.kid };
  }
}

/** The project a token is addressed to. Every audience we mint is a project's public id. */
function projectOf(audience: string): string {
  try {
    return PublicId.parse(IdPrefix.Project, audience).uuid;
  } catch (cause: unknown) {
    throw new InternalError({
      detail: { reason: "a token was addressed to something that is not a project" },
      cause,
    });
  }
}
