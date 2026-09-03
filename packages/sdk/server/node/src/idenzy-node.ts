/**
 * The server half: verifying a token a browser sent, without asking us whether it is good.
 *
 * A customer's API and a server-rendered page both need the same thing, an answer to "who is
 * this request from", and both can have it offline. The access token is a standard ES256 JWT
 * signed by a key we publish, so this is the check any off-the-shelf library performs; what
 * this package adds is knowing which claims are ours and refusing the ones that are not.
 *
 * Offline is a trade and it is stated plainly: a revoked session stays verifiable until its
 * access token expires, which is why the default lifetime is short. Anything that must see a
 * revocation the instant it happens has to ask, and that is the revocation set (PROJECT.md
 * 4.2), which this package does not consume yet.
 */
import { AccessTokenInvalidError, MissingCredentialsError } from "@idenzy/core/errors";
import { projectIdSchema } from "@idenzy/protocol/schemas/common";
import { errors as joseErrors, jwtVerify } from "jose";
import { type JwksSource, RemoteJwks } from "./jwks.js";
import { accessTokenFrom, type RequestHeaders } from "./request.js";

/** Public ids, exactly as they appear in the token. Decoding them is the caller's job. */
export interface VerifiedAccessToken {
  readonly userId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly amr: readonly string[];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /**
   * Age in seconds of the most recent second-factor proof, or null where there was none.
   * Null means "no restriction can be satisfied", never "no restriction applies".
   */
  readonly factorVerifiedSecondsAgo: number | null;
  /** The whole payload, for the claims a project adds to its own tokens. */
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface AccessTokenVerifierOptions {
  /** The `iss` these tokens carry, which is the auth API's base URL. */
  readonly issuerUrl: string;
  /**
   * The project the token must name, and the reason this is not optional.
   *
   * One issuer serves every project on a deployment, so `iss` and the signing key are shared
   * and `aud` is the only thing separating tenants. A verifier that skipped it would accept a
   * perfectly valid token minted for somebody else's project.
   */
  readonly projectId: string;
  /** Seconds of clock skew tolerated on `exp` and `iat`. Small on purpose. */
  readonly clockToleranceSeconds?: number;
}

/**
 * Verifies our access tokens against the keys we publish.
 *
 * Built once and held: the JWKS source behind it caches, and a verifier per request would
 * fetch the key set per request.
 */
export class AccessTokenVerifier {
  private readonly issuerUrl: string;
  private readonly projectId: string;
  private readonly tolerance: number;
  private readonly keys: JwksSource;

  constructor(options: AccessTokenVerifierOptions, keys?: JwksSource) {
    this.issuerUrl = options.issuerUrl;
    this.projectId = assertProjectId(options.projectId);
    this.tolerance = options.clockToleranceSeconds ?? 5;
    this.keys = keys ?? new RemoteJwks(options.issuerUrl);
  }

  /**
   * The claims, or the refusal the auth API would have given.
   *
   * Expiry is not separated out here, unlike on the client. A server holding an expired token
   * has nothing to do about it: rotating is the browser's job and the answer to this request
   * is the same either way.
   */
  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.keys.resolver(), {
        issuer: this.issuerUrl,
        audience: this.projectId,
        algorithms: ["ES256"],
        clockTolerance: this.tolerance,
        requiredClaims: ["sub", "sid", "iat", "exp"],
        // The project key signs more than access tokens, and a signature alone does not
        // say which kind of statement is in hand (RFC 8725 section 3.11).
        typ: "JWT",
      });
      return read(payload);
    } catch (error: unknown) {
      // A key set we could not fetch is an outage, not a bad token, and reporting it as one
      // would sign every user out of a customer's application for the length of it. An
      // unknown `kid` is the opposite: `jose` has already refetched by then, so the key
      // really is not ours.
      if (error instanceof AccessTokenInvalidError || isKeySetUnavailable(error)) throw error;
      throw new AccessTokenInvalidError({ cause: error });
    }
  }

  /**
   * The same, reading the token out of the request first.
   *
   * `Authorization` if there is one, the `__Host-idenzy-session` cookie otherwise, which is
   * what makes a server-rendered page for a signed-in user cost no round trip.
   */
  async verifyRequest(headers: RequestHeaders): Promise<VerifiedAccessToken> {
    const token = accessTokenFrom(headers);
    if (token === null) throw new MissingCredentialsError();
    return await this.verify(token);
  }
}

function assertProjectId(value: string): string {
  if (!projectIdSchema.safeParse(value).success) {
    throw new AccessTokenInvalidError({
      detail: { reason: "projectId is not a project id", value },
    });
  }
  return value;
}

/** `jose` has already checked these exist; this reads them at the types we promise. */
function read(payload: Record<string, unknown>): VerifiedAccessToken {
  const { sub, sid, aud, amr, fva, iat, exp } = payload;
  if (typeof sub !== "string" || typeof sid !== "string" || typeof aud !== "string") {
    throw new AccessTokenInvalidError({ detail: { reason: "missing subject claims" } });
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new AccessTokenInvalidError({ detail: { reason: "missing lifetime claims" } });
  }
  return {
    userId: sub,
    sessionId: sid,
    projectId: aud,
    amr: Array.isArray(amr) ? amr.filter((value) => typeof value === "string") : [],
    issuedAt: new Date(iat * 1000),
    expiresAt: new Date(exp * 1000),
    factorVerifiedSecondsAgo: typeof fva === "number" ? fva : null,
    claims: payload,
  };
}

/**
 * The JWKS endpoint could not be read at all: timed out, answered with something that is not
 * a key set, or never answered. `jose` rethrows whatever `fetch` gave it for the last of
 * those, so a network failure is recognised by shape rather than by class.
 */
function isKeySetUnavailable(error: unknown): boolean {
  return (
    error instanceof joseErrors.JWKSTimeout ||
    error instanceof joseErrors.JWKSInvalid ||
    error instanceof TypeError
  );
}
