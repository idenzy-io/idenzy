import { InternalError } from "@idenzy/core/errors";
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

  /**
   * Signs something that is not an access token, with the same project key.
   *
   * `typ` is required and may not be `JWT`. Both kinds of statement carry the same
   * signature from the same key, so the media type is the only thing that stops one being
   * presented where the other is expected (RFC 8725 section 3.11). Verifiers check it.
   *
   * There is deliberately no way to pass `sub` or `sid` through here: a statement that
   * carried them would be an access token in everything but name.
   */
  async issueStatement(
    typ: string,
    audience: string,
    claims: Readonly<Record<string, unknown>>,
    ttlSeconds: number,
  ): Promise<IssuedToken> {
    if (typ === "JWT") {
      throw new InternalError({
        detail: {
          reason: "a statement was typed as an access token",
          rule: "the media type is what separates the two (RFC 8725 section 3.11)",
        },
      });
    }
    // The media type is the second line, not the first. A statement carrying `sub` and
    // `sid` would be an access token in everything but its header, so it cannot be minted
    // at all: a verifier that forgot to check `typ` would then accept it as a credential.
    if ("sub" in claims || "sid" in claims) {
      throw new InternalError({
        detail: {
          reason: "a statement carried the claims that name a session",
          rule: "a statement with sub and sid is an access token in all but its header",
        },
      });
    }
    const issuedAt = Math.floor(this.clock.nowMs() / 1000);
    const expiresAt = issuedAt + ttlSeconds;
    const { jwt, kid } = await this.sign(
      { alg: "ES256", typ },
      { iss: this.issuer, aud: audience, iat: issuedAt, exp: expiresAt, ...claims },
    );
    return { token: jwt, expiresAt: new Date(expiresAt * 1000), keyId: kid };
  }

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
