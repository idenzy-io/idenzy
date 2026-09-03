/**
 * The Astro helper: middleware that answers "who is this request from" before a page renders.
 *
 * The whole package is server code, and it needs no subpath to say so: Astro middleware runs
 * only on the server, and `src/middleware.ts` is never part of a client bundle.
 *
 * There is no client half here and there will not be one. An Astro island is React, Vue,
 * Svelte, Solid or none of them, so the browser binding is whichever of ours the customer
 * already chose, given the seed this middleware worked out. That is the same reason there is
 * no component: we ship no authentication UI in any framework (ADR-0002).
 *
 * What it reads is the access token in the `__Host-idenzy-session` cookie, verified locally
 * against a cached key set, so a page rendered for a signed-in user costs no round trip
 * (PROJECT.md 4.3). An offline verifier cannot see a session revoked in the last few minutes,
 * which is why the default token lifetime is short (PROJECT.md 4.2).
 */
import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier, type VerifiedAccessToken } from "@idenzy/node";
import type { RevocationCache } from "@idenzy/node/revocations";

export interface IdenzyMiddlewareOptions {
  /**
   * The project a token must name. Required, and it is what separates tenants: one issuer
   * serves every project, so the signature alone is not evidence of whose token this is.
   */
  readonly projectId: string;
  /** Where the tokens say they came from. The auth API's base URL. */
  readonly issuerUrl: string;
  /** Seconds of clock skew tolerated on `exp` and `iat`. Small on purpose. */
  readonly clockToleranceSeconds?: number;
  /**
   * An in-process copy of the project's revocation set, if the customer built one (ADR-0009).
   *
   * Passed in rather than built here, for the same reason the browser client is: it holds a
   * secret key and a polling timer, and it has a `start` and a `close` that belong to whoever
   * owns the process. One per server, at module scope alongside the middleware.
   *
   * With it, a session revoked in the last few minutes is refused here rather than staying
   * valid until its access token expires, which is the standing cost of verifying offline.
   */
  readonly revocations?: RevocationCache;
}

/**
 * What the middleware puts on `Astro.locals.idenzy`.
 *
 * Both halves of one answer. `session` is the seed an island is given, and `token` is the
 * claim set a customer's own authorisation reads: `amr`, the factor age behind a step-up
 * check, and whatever their claim template adds.
 *
 * Null is not signed out. It means the server could not place this request, which is the
 * normal case for a visitor whose access token expired an hour ago and who still holds a
 * refresh cookie. An island seeded with null renders `loading` and then finds out.
 */
export interface IdenzyServerSession {
  readonly session: SessionSnapshot | null;
  readonly token: VerifiedAccessToken | null;
}

/**
 * The part of Astro's `APIContext` this touches, declared here rather than imported.
 *
 * `astro` is a build tool, and this needs two properties of one object. Declaring them keeps
 * a hundred-package dependency out of a lockfile that is a supply-chain control (PROJECT.md
 * 7.6), and the middleware stays assignable to Astro's own `MiddlewareHandler` because it is
 * generic in its context.
 *
 * `locals.idenzy` is required rather than optional, so an application that has not declared
 * it in `src/env.d.ts` is told so where it installs the middleware rather than where it reads
 * the value.
 */
export interface IdenzyApiContext {
  readonly request: { readonly headers: Headers };
  locals: { idenzy: IdenzyServerSession };
}

/** Structurally Astro's `MiddlewareHandler`, and assignable to it. */
export type IdenzyMiddleware = <Context extends IdenzyApiContext>(
  context: Context,
  next: () => Promise<Response>,
) => Promise<Response>;

/** Nobody was named, whatever the reason. Frozen because every miss returns this one object. */
const UNKNOWN: IdenzyServerSession = Object.freeze({ session: null, token: null });

/**
 * `export const onRequest = createIdenzyMiddleware({ projectId, issuerUrl })` in
 * `src/middleware.ts`, and every page below it reads `Astro.locals.idenzy`.
 *
 * Built once, at module scope, and the reason is the verifier it closes over: the key set is
 * cached inside it, and one of these per request would fetch the key set per request.
 *
 * There is no route guard here and there will not be one. Where an unauthenticated visitor
 * should land is a product decision, and in Astro it is two lines the customer owns:
 * `if (!Astro.locals.idenzy.session) return Astro.redirect("/sign-in")`. We have no sign-in
 * page to send anyone to in any case (ADR-0002).
 */
export function createIdenzyMiddleware(options: IdenzyMiddlewareOptions): IdenzyMiddleware {
  const verifier = new AccessTokenVerifier(options);
  return async (context, next) => {
    context.locals.idenzy = await sessionFrom(verifier, context.request.headers);
    return await next();
  };
}

/**
 * Never throws, and that is the whole design of it.
 *
 * Middleware that threw would answer 500 for every page on the site for the length of a JWKS
 * outage. `UNKNOWN` renders `loading` and lets the browser settle it with the refresh cookie
 * the server never had, which is the honest answer and the one that keeps the site up.
 */
async function sessionFrom(
  verifier: AccessTokenVerifier,
  headers: Headers,
): Promise<IdenzyServerSession> {
  try {
    const token = await verifier.verifyRequest(headers);
    return { session: seededSession(token.userId, token.sessionId), token };
  } catch {
    return UNKNOWN;
  }
}
