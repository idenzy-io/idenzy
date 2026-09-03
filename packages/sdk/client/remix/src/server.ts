/**
 * The Remix helper: a verifier a loader or an action calls to find out who the request is from.
 *
 * Remix has no middleware, so unlike the SvelteKit handle and the Astro middleware there is
 * nothing to seed `locals` from. What a root loader returns is the seed, and every other
 * loader in the same request asks the same object and gets the same answer.
 *
 * `@idenzy/remix/server` is the only entry point this package has, and the missing `.` is the
 * point of it. A loader lives in the same file as the component it feeds, so an import at the
 * top of `root.tsx` is one the browser build has to be trusted to drop; a subpath named
 * `server` is a boundary rather than a hope. The browser half is `@idenzy/react`, imported
 * directly, because a re-export of it here would be a second place for the provider to be
 * wired wrongly.
 *
 * What it reads is the access token in the `__Host-idenzy-session` cookie, verified locally
 * against a cached key set, so a page rendered for a signed-in user costs no round trip
 * (PROJECT.md 4.3). An offline verifier cannot see a session revoked in the last few minutes,
 * which is why the default token lifetime is short (PROJECT.md 4.2).
 */
import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier, type VerifiedAccessToken } from "@idenzy/node";

export interface IdenzyServerOptions {
  /**
   * The project a token must name. Required, and it is what separates tenants: one issuer
   * serves every project, so the signature alone is not evidence of whose token this is.
   */
  readonly projectId: string;
  /** Where the tokens say they came from. The auth API's base URL. */
  readonly issuerUrl: string;
  /** Seconds of clock skew tolerated on `exp` and `iat`. Small on purpose. */
  readonly clockToleranceSeconds?: number;
}

/**
 * Verifies the session cookie on a Remix request, and answers the same thing every time it is
 * asked about the same one.
 *
 * Built once, at module scope, in a `.server` module. The JWKS cache lives inside it, and one
 * of these per request would fetch the key set per request.
 */
export class IdenzyServer {
  private readonly verifier: AccessTokenVerifier;
  /**
   * One answer per request, and the reason is correctness before it is cost.
   *
   * Remix runs the loaders of a page in parallel and may run an action before them. Verifying
   * per call means two of them can straddle the token's `exp` and render one page from two
   * different answers, which is a header that says signed in above a body that does not.
   * Keyed weakly on the request, so nothing here outlives the request it belongs to.
   */
  private readonly answered = new WeakMap<Request, Promise<VerifiedAccessToken | null>>();

  constructor(options: IdenzyServerOptions) {
    this.verifier = new AccessTokenVerifier(options);
  }

  /**
   * The seed for the browser, from a root loader:
   * `export const loader = ({ request }) => json({ session: await idenzy.sessionFor(request) })`.
   *
   * Null is not signed out. It means the server could not place this request, which is the
   * normal case for a visitor whose access token expired an hour ago and who still holds a
   * refresh cookie. Seeding with null renders `loading` and the browser settles it; rendering
   * signed-out would put a sign-in form in the HTML for somebody who does not need one.
   */
  async sessionFor(request: Request): Promise<SessionSnapshot | null> {
    const token = await this.verify(request);
    return token === null ? null : seededSession(token.userId, token.sessionId);
  }

  /**
   * The claims themselves, for a customer's own authorisation: `amr`, the factor age behind a
   * step-up check, and whatever their claim template adds.
   *
   * Null rather than throwing, for every reason including an unreachable key set. A loader
   * that threw would put a customer's error boundary in front of every page on the site for
   * the length of a JWKS outage, and the site does not need us in order to render.
   */
  verify(request: Request): Promise<VerifiedAccessToken | null> {
    const held = this.answered.get(request);
    if (held !== undefined) return held;

    const answer = this.verifier
      .verifyRequest(request.headers)
      .catch((): VerifiedAccessToken | null => null);
    this.answered.set(request, answer);
    return answer;
  }
}
