import { AccessTokenInvalidError, SessionExpiredError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import type { TokenIssuer } from "./token-issuer.js";

export interface VerifiedAccessToken {
  /** Public ids, exactly as they appear in the token. Decoding them is the caller's job. */
  readonly subject: string;
  readonly sessionId: string;
  readonly audience: string;
  readonly amr: readonly string[];
  readonly expiresAt: Date;
}

/**
 * Verifies an access token we issued (PROJECT.md 4.2).
 *
 * A customer verifies our tokens offline against JWKS, and so do we: this is the same
 * check any off-the-shelf library performs, which is the point of being a standards
 * compliant provider rather than inventing a token format.
 */
export abstract class TokenVerifier {
  /**
   * The token's claims, if it is a live token for `projectId` (the uuid).
   *
   * The project comes from the caller — the request's tenant — and never from the token: the
   * keys it is checked against are that project's, and its audience must be that project. A
   * token minted for another project fails on both, the key first.
   */
  abstract verify(token: string, projectId: string): Promise<VerifiedAccessToken>;
}

/**
 * Verifies against the keys the local issuer holds.
 *
 * Correct for a single-process deployment and for tests. Once keys live in KMS the key
 * set comes from the cached JWKS document instead, which is the same code with a
 * different source of keys.
 */
export class IssuerTokenVerifier extends TokenVerifier {
  constructor(
    private readonly issuer: TokenIssuer,
    private readonly issuerUrl: string,
  ) {
    super();
  }

  override async verify(token: string, projectId: string): Promise<VerifiedAccessToken> {
    const keys = { keys: [...(await this.issuer.publicKeys(projectId))] } as JSONWebKeySet;
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
        issuer: this.issuerUrl,
        audience: PublicId.encode(IdPrefix.Project, projectId).value,
        algorithms: ["ES256"],
        // The same key signs revocation snapshots, so the media type is the only thing
        // separating them from an access token (RFC 8725 section 3.11).
        typ: "JWT",
      });
      return read(payload);
    } catch (error: unknown) {
      // jose distinguishes expiry from every other failure, and so must we: a client
      // refreshes an expired token and starts over on an invalid one.
      if (isExpiry(error)) throw new SessionExpiredError({ cause: error });
      throw new AccessTokenInvalidError({ cause: error });
    }
  }
}

function isExpiry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ERR_JWT_EXPIRED"
  );
}

/** Claims we mint ourselves, so a missing one means the token is not one of ours. */
function read(payload: Record<string, unknown>): VerifiedAccessToken {
  const { sub, sid, aud, amr, exp } = payload;
  if (typeof sub !== "string" || typeof sid !== "string" || typeof aud !== "string") {
    throw new AccessTokenInvalidError({ detail: { reason: "missing subject claims" } });
  }
  if (typeof exp !== "number") {
    throw new AccessTokenInvalidError({ detail: { reason: "missing expiry" } });
  }
  return {
    subject: sub,
    sessionId: sid,
    audience: aud,
    amr: Array.isArray(amr) ? amr.filter((value) => typeof value === "string") : [],
    expiresAt: new Date(exp * 1000),
  };
}
