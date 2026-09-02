import type { Clock } from "@idenzy/core/time/clock";
import type { Jwk } from "@idenzy/protocol/schemas/discovery";

export interface AccessTokenClaims {
  readonly sub: string;
  readonly sid: string;
  readonly aud: string;
  readonly amr: readonly string[];
  readonly acr?: string;
  /** Factor verification age: when the second factor was last proven. */
  readonly fva?: number;
  readonly custom?: Readonly<Record<string, unknown>>;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
  readonly keyId: string;
}

/**
 * Mints access tokens for one project (PROJECT.md 4.2).
 *
 * The base owns claim assembly and lifetime so no implementation can quietly issue a
 * token with a missing `sid` or an unbounded expiry. Subclasses only sign bytes, which
 * is the one part that differs between KMS and a local key.
 */
export abstract class TokenIssuer {
  protected constructor(
    protected readonly clock: Clock,
    protected readonly issuer: string,
    protected readonly ttlSeconds: number,
  ) {}

  protected abstract sign(header: object, payload: object): Promise<{ jwt: string; kid: string }>;

  /** Public keys for the JWKS endpoint. Two during a rotation overlap. */
  abstract publicKeys(): Promise<readonly Jwk[]>;

  /** Template method: claims and lifetime are inherited, signing is not. */
  async issue(claims: AccessTokenClaims): Promise<IssuedToken> {
    const issuedAt = Math.floor(this.clock.nowMs() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;

    const { jwt, kid } = await this.sign(
      { alg: "ES256", typ: "JWT" },
      {
        iss: this.issuer,
        sub: claims.sub,
        sid: claims.sid,
        aud: claims.aud,
        iat: issuedAt,
        exp: expiresAt,
        amr: [...claims.amr],
        ...(claims.acr === undefined ? {} : { acr: claims.acr }),
        ...(claims.fva === undefined ? {} : { fva: claims.fva }),
        ...claims.custom,
      },
    );

    return { token: jwt, expiresAt: new Date(expiresAt * 1000), keyId: kid };
  }
}
