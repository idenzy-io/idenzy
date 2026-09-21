import { createPrivateKey } from "node:crypto";
import { InternalError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import type { Jwk } from "@idenzy/protocol/schemas/discovery";
import { type CryptoKey, SignJWT } from "jose";
import type { KeyEncryption } from "../kms/key-encryption.js";
import { TokenIssuer } from "./token-issuer.js";

/** One project's key material, as the store holds it: public in the clear, private wrapped. */
export interface WrappedSigningKey {
  readonly kid: string;
  readonly publicJwk: Jwk;
  /** PKCS#8, wrapped by the cell's KMS key. Base64. */
  readonly privateKeyWrapped: string;
}

/**
 * Everything the issuer needs about one project, fetched once and cached by the caller.
 *
 * A port rather than a repository, so `@idenzy/crypto` depends on no database: the auth API binds
 * it to `ProjectSigningKeyRepository` and a test binds it to a literal.
 */
export abstract class SigningKeyStore {
  /** The key new tokens are signed with. */
  abstract primary(projectId: string): Promise<WrappedSigningKey>;
  /** Every key a live token might have been signed with, for JWKS. */
  abstract publishable(projectId: string): Promise<readonly Jwk[]>;
}

/**
 * ES256 signing with a per-project key that KMS holds the wrapping for (ADR-0017).
 *
 * **The production issuer, and the reason it is not the one §4.2 first described.** That design
 * signed every token with a KMS `asymmetricSign` call against a key per project. Two things broke
 * at once: a key per project is a per-tenant fixed cost, which §5.2 requires to be approximately
 * zero, and a KMS round trip per token — about 158 per monthly active user — is a network call on
 * the hottest path in the product, which from a VPS is an internet call.
 *
 * So KMS holds one key per **cell** and wraps the per-project signing keys. This unwraps a key the
 * first time a project mints a token and caches it for the life of the process; signing after that
 * is local and takes microseconds.
 *
 * What it costs, stated rather than buried: the unwrapped private key is in process memory. That is
 * a weaker posture than a non-exportable HSM key. It is **not** a weaker control — SOC 2, ISO 27001
 * and HIPAA ask for key material encrypted at rest, access-controlled, rotated and audited, and all
 * four hold here. A project that wants the stronger posture is what `compliance_tier` is for.
 *
 * The cache is unbounded on purpose and bounded in practice: one small key per project this process
 * has served, dropped when it restarts. Evicting would mean a KMS call to re-open a key that is
 * about to be used again, which is the cost this design exists to avoid.
 */
export class WrappedEs256Issuer extends TokenIssuer {
  private readonly opened = new Map<string, { key: CryptoKey; kid: string }>();
  private readonly opening = new Map<string, Promise<{ key: CryptoKey; kid: string }>>();

  constructor(
    clock: Clock,
    issuer: string,
    ttlSeconds: number,
    private readonly projectId: string,
    private readonly keys: SigningKeyStore,
    private readonly wrapping: KeyEncryption,
  ) {
    super(clock, issuer, ttlSeconds);
  }

  protected override async sign(
    header: object,
    payload: object,
  ): Promise<{ jwt: string; kid: string }> {
    const { key, kid } = await this.signingKey();
    const jwt = await new SignJWT({ ...payload })
      .setProtectedHeader({ ...header, alg: "ES256", kid } as never)
      .sign(key);
    return { jwt, kid };
  }

  override publicKeys(): Promise<readonly Jwk[]> {
    return this.keys.publishable(this.projectId);
  }

  /**
   * The unwrapped key, opened at most once per project per process.
   *
   * Single-flight: a cold start serving a burst for one project would otherwise make one KMS call
   * per concurrent request, which is both the cost and the latency this design exists to avoid —
   * and it happens exactly when the process is busiest.
   */
  private signingKey(): Promise<{ key: CryptoKey; kid: string }> {
    const cached = this.opened.get(this.projectId);
    if (cached !== undefined) return Promise.resolve(cached);

    const inFlight = this.opening.get(this.projectId);
    if (inFlight !== undefined) return inFlight;

    const opening = this.open()
      .then((opened) => {
        this.opened.set(this.projectId, opened);
        return opened;
      })
      .finally(() => {
        this.opening.delete(this.projectId);
      });
    this.opening.set(this.projectId, opening);
    return opening;
  }

  private async open(): Promise<{ key: CryptoKey; kid: string }> {
    const stored = await this.keys.primary(this.projectId);

    // The project id is the authenticated data the key was wrapped under, so a row lifted from
    // another project's table fails here rather than quietly signing this project's tokens with
    // somebody else's key.
    const pkcs8 = await this.wrapping.unwrap(
      Buffer.from(stored.privateKeyWrapped, "base64"),
      this.projectId,
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
          projectId: this.projectId,
          kid: stored.kid,
          reason: "the unwrapped key is not a usable PKCS#8 private key",
        },
        cause,
      });
    }
    return { key, kid: stored.kid };
  }
}
