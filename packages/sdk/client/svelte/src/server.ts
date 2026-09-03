/**
 * The SvelteKit half: a `handle` that answers "who is this request from" before a route runs.
 *
 * Server-only, and behind its own entry point (`@idenzy/svelte/server`) so `@idenzy/node` and
 * the JWKS machinery under it never reach a browser bundle. Nothing here is code a client
 * should be shipped.
 *
 * What it reads is the access token in the `__Host-idenzy-session` cookie, verified locally
 * against a cached key set, so a page rendered for a signed-in user costs no round trip
 * (PROJECT.md 4.3). The trade is stated where it is made: an offline verifier cannot see a
 * session revoked in the last few minutes, which is why the default token lifetime is short
 * (PROJECT.md 4.2).
 */
import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier, type VerifiedAccessToken } from "@idenzy/node";
import type { RevocationCache } from "@idenzy/node/revocations";

export interface IdenzyHandleOptions {
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
   * owns the process. One per server, at module scope alongside the handle.
   *
   * With it, a session revoked in the last few minutes is refused here rather than staying
   * valid until its access token expires, which is the standing cost of verifying offline.
   */
  readonly revocations?: RevocationCache;
}

/**
 * What the handle puts on `event.locals.idenzy`.
 *
 * Both halves of one answer. `session` is the seed a load function hands the browser, and
 * `token` is the claim set a customer's own authorisation reads: `amr`, the factor age behind
 * a step-up check, and whatever their claim template adds.
 *
 * Null is not signed out. It means the server could not place this request, which is the
 * normal case for a visitor whose access token expired an hour ago and who still holds a
 * refresh cookie. Seeding the browser with null renders `loading`, and the browser finds out.
 */
export interface IdenzyServerSession {
  readonly session: SessionSnapshot | null;
  readonly token: VerifiedAccessToken | null;
}

/**
 * The part of SvelteKit's `RequestEvent` this touches, declared here rather than imported.
 *
 * `@sveltejs/kit` is a build tool whose type surface arrives with `vite` and a Svelte plugin
 * behind it, and this needs two properties of one object. Declaring them keeps the dependency
 * out of a lockfile that is a supply-chain control (PROJECT.md 7.6), and the handle stays
 * assignable to SvelteKit's own `Handle` because it is generic in the event.
 *
 * `locals.idenzy` is required rather than optional, so an application that has not declared
 * it in `src/app.d.ts` is told so where it installs the handle rather than where it reads the
 * value.
 */
export interface IdenzyRequestEvent {
  readonly request: { readonly headers: Headers };
  locals: { idenzy: IdenzyServerSession };
}

/** Structurally SvelteKit's `Handle`, and assignable to it. */
export type IdenzyHandle = <Event extends IdenzyRequestEvent>(input: {
  event: Event;
  resolve: (event: Event) => Response | Promise<Response>;
}) => Promise<Response>;

/** Nobody was named, whatever the reason. Frozen because every miss returns this one object. */
const UNKNOWN: IdenzyServerSession = Object.freeze({ session: null, token: null });

/**
 * `export const handle = createIdenzyHandle({ projectId, issuerUrl })` in `hooks.server.ts`.
 *
 * Built once, at module scope, and the reason is the verifier it closes over: the key set is
 * cached inside it, and one of these per request would fetch the key set per request.
 *
 * There is no route guard here and there will not be one. Where an unauthenticated visitor
 * should land is a product decision, and in SvelteKit it is two lines the customer owns:
 * `if (!event.locals.idenzy.session) redirect(303, "/sign-in")`. We have no sign-in page to
 * send anyone to in any case (ADR-0002).
 */
export function createIdenzyHandle(options: IdenzyHandleOptions): IdenzyHandle {
  const verifier = new AccessTokenVerifier(options);
  return async ({ event, resolve }) => {
    event.locals.idenzy = await sessionFrom(verifier, event.request.headers);
    return await resolve(event);
  };
}

/**
 * Never throws, and that is the whole design of it.
 *
 * A handle that threw would answer 500 for every page on the site for the length of a JWKS
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
