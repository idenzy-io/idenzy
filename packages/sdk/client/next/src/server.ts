import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier, type VerifiedAccessToken } from "@idenzy/node";
import type { RevocationCache } from "@idenzy/node/revocations";
import { ErrorCode } from "@idenzy/protocol/errors/codes";

export interface IdenzyServerOptions {
  /**
   * The project a token must name. Required, and it is what separates tenants: one issuer
   * serves every project, so the signature alone is not evidence of whose token this is.
   */
  readonly projectId: string;
  /** Where the tokens say they came from. The auth API's base URL. */
  readonly issuerUrl: string;
  /**
   * An in-process copy of the project's revocation set, if the customer built one (ADR-0009).
   *
   * Passed in rather than built here, for the same reason the browser client is: it holds a
   * secret key and a polling timer, and it has a `start` and a `close` that belong to whoever
   * owns the process. One per server, at module scope alongside this.
   *
   * With it, a session revoked in the last few minutes is refused here rather than staying
   * valid until its access token expires, which is the standing cost of verifying offline.
   */
  readonly revocations?: RevocationCache;
}

/**
 * What Next adds to this SDK, which is a server that can answer "who is this" with no
 * network call at all.
 *
 * The access token rides in a `__Host-` cookie in cookie mode, so a Server Component, a Route
 * Handler and middleware all have it in hand. Verifying it locally is what makes a page
 * rendered for a signed-in user cost nothing, and the trade is stated where it is made: a
 * revoked session stays verifiable until the token expires, which is why that lifetime is
 * short (PROJECT.md 4.2).
 *
 * Built once, at module scope, and shared. The JWKS cache lives inside it, and one of these
 * per request would fetch the key set per request.
 */
export class IdenzyServer {
  private readonly verifier: AccessTokenVerifier;

  constructor(options: IdenzyServerOptions) {
    this.verifier = new AccessTokenVerifier(options);
  }

  /**
   * The session on the incoming request, in a Server Component, Route Handler or Server
   * Action. Null when there is no readable token, which is every signed-out visitor.
   *
   * `next/headers` is imported here rather than at the top of the file because it exists only
   * in that context: importing it eagerly would break this module for middleware, which is
   * the other place a Next application needs exactly this answer.
   */
  async session(): Promise<SessionSnapshot | null> {
    const { headers } = await import("next/headers");
    return this.sessionFor({ headers: await headers() });
  }

  /**
   * The same, where the request is already in hand. Middleware and Route Handlers.
   *
   * Never throws, unlike `verify`, and the difference is what each answer is for. This one
   * returns a seed, and a seed's null already means "the server could not tell", which
   * renders `loading` and lets the browser settle it against the refresh cookie the server
   * never had. Throwing instead would put a 500 on every page of a customer's site for the
   * length of a JWKS outage, and the site does not need us in order to render.
   */
  async sessionFor(request: { readonly headers: Headers }): Promise<SessionSnapshot | null> {
    try {
      const verified = await this.verify(request.headers);
      return verified === null ? null : seededSession(verified.userId, verified.sessionId);
    } catch {
      return null;
    }
  }

  /**
   * The claims themselves, for a customer's own authorisation: `amr`, the factor age behind a
   * step-up check, and whatever their claim template adds.
   *
   * Null rather than throwing, because "nobody is signed in" is a state a page renders and
   * not an exception it handles. A revoked session is null here too, where a set is attached:
   * it is a credential read and refused, which is the same answer as a bad one. A verification
   * that failed for any other reason, a key set that could not be fetched, comes back as
   * itself: authorisation code told "no claims" when the truth is "cannot tell" would refuse
   * the right people for the wrong reason. This is the one method here that throws, and
   * `protectRoutes` is built on it for that reason.
   */
  async verify(headers: Headers): Promise<VerifiedAccessToken | null> {
    try {
      return await this.verifier.verifyRequest(headers);
    } catch (error: unknown) {
      if (isCredentialProblem(error)) return null;
      throw error;
    }
  }
}

/**
 * A missing or unacceptable credential, which is a state. Anything else, and an outage is the
 * one that matters, is not: answering "signed out" during a JWKS outage would sign out every
 * visitor to a customer's site for the length of it.
 *
 * A revoked session belongs here and the placement is load-bearing. It is a credential that
 * was read and refused, which is a definite no; letting it out of `verify` as a throw would
 * reach `protectRoutes` as "cannot tell", answering 503 to somebody who should be sent to
 * sign in, and under `onUnverifiable: "allow"` waving the revoked session through. The one
 * case the revocation set exists to catch would be the one case that stopped being checked.
 */
function isCredentialProblem(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === ErrorCode.MissingCredentials ||
      error.code === ErrorCode.AccessTokenInvalid ||
      error.code === ErrorCode.SessionRevoked)
  );
}
