import type { Clock } from "@idenzy/core/time/clock";
import type { Jwk } from "@idenzy/protocol/schemas/discovery";
import { type CryptoKey, exportJWK, generateKeyPair, SignJWT } from "jose";
import { TokenIssuer } from "./token-issuer.js";

/**
 * ES256 signing with an in-process key.
 *
 * For local development and tests only. Production uses the KMS issuer, where the
 * private key never exists in application memory (PROJECT.md 4.2). Kept in the same
 * hierarchy so the conformance suite runs against both.
 */
export class LocalEs256Issuer extends TokenIssuer {
  private constructor(
    clock: Clock,
    issuer: string,
    ttlSeconds: number,
    private readonly privateKey: CryptoKey,
    private readonly publicJwk: Jwk,
  ) {
    super(clock, issuer, ttlSeconds);
  }

  static async create(clock: Clock, issuer: string, ttlSeconds: number): Promise<LocalEs256Issuer> {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    const publicJwk: Jwk = {
      kty: "EC",
      crv: "P-256",
      x: jwk.x ?? "",
      y: jwk.y ?? "",
      kid: `local-${Date.now()}`,
      alg: "ES256",
      use: "sig",
    };
    return new LocalEs256Issuer(clock, issuer, ttlSeconds, privateKey, publicJwk);
  }

  protected override async sign(
    _header: object,
    payload: object,
  ): Promise<{ jwt: string; kid: string }> {
    const jwt = await new SignJWT(payload as Record<string, unknown>)
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.publicJwk.kid })
      .sign(this.privateKey);
    return { jwt, kid: this.publicJwk.kid };
  }

  override publicKeys(): Promise<readonly Jwk[]> {
    return Promise.resolve([this.publicJwk]);
  }
}
