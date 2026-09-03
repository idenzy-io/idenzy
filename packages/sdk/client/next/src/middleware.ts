import type { VerifiedAccessToken } from "@idenzy/node";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { IdenzyServer } from "./server.js";

export interface ProtectOptions {
  /** The verifier, built once at module scope so its key set is cached across requests. */
  readonly idenzy: IdenzyServer;
  /**
   * Which paths need a session. A predicate rather than a list, because Next's own `matcher`
   * already narrows what middleware runs on and duplicating it here would mean two places to
   * change and one of them silently wrong.
   */
  readonly isProtected: (pathname: string) => boolean;
  /** Where a signed-out visitor goes. A page in the customer's app, never one of ours. */
  readonly signInUrl: string;
  /**
   * The query parameter carrying where they were going, so the sign-in page can send them
   * back. Set it to null to send them nowhere and keep the URL clean.
   */
  readonly returnTo?: string | null;
  /**
   * What to do when the token could not be judged at all, which in practice means our JWKS
   * endpoint was unreachable. Not the same as a bad token and not the same as no token.
   *
   * `refuse`, the default, answers 503 with a `Retry-After`. It fails closed, and it
   * deliberately does not redirect: sending a signed-in visitor to a sign-in page during an
   * outage is the "sign everybody out for the length of it" failure the whole verifier is
   * written to avoid, and it asks them to fix something that is not broken on their side.
   *
   * `allow` is the explicit loose choice, for a customer who would rather serve the page.
   * It is defensible because this gate is not an authorisation decision in the first place:
   * it proves a token exists and has not expired, and anything that must be certain has to
   * ask the API. It is still a decision to make on purpose, which is why it has a name.
   */
  readonly onUnverifiable?: "refuse" | "allow";
}

/** Cannot tell, as distinct from "no" and from "yes". */
const UNVERIFIABLE = "unverifiable";

/**
 * Middleware that keeps signed-out visitors off the pages that need a session.
 *
 * It redirects to a page in the customer's application. We have no sign-in page to send
 * anyone to and will not have one (ADR-0002), and the destination is a product decision in
 * any case: some applications want a modal, some a route, some a marketing page.
 *
 * What it checks is the access token in the `__Host-idenzy-session` cookie, verified locally.
 * That is a fast gate and not an authorisation decision: it proves the request carries a
 * token this project issued and has not expired, and it cannot see a session revoked in the
 * last few minutes. Anything that must be certain has to ask the API, which every
 * authenticated call to it already does.
 *
 * It is built on `verify` rather than `sessionFor` because a gate needs three answers where
 * a seed needs two. A seed collapses "no credential" and "cannot judge the credential" into
 * null, and renders `loading` either way; a gate that did the same would send every
 * signed-in visitor to a sign-in page for the length of a JWKS outage. `onUnverifiable` is
 * the third answer, and 503 is its default.
 */
export function protectRoutes(
  options: ProtectOptions,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    if (!options.isProtected(request.nextUrl.pathname)) return NextResponse.next();
    const verified = await judge(options, request);
    if (verified === UNVERIFIABLE) return unverifiable(options);
    if (verified !== null) return NextResponse.next();
    return NextResponse.redirect(signInTarget(request, options));
  };
}

/**
 * The claims, null for a credential that was read and refused, and `UNVERIFIABLE` for one
 * that could not be judged at all. `IdenzyServer.verify` already draws that second line by
 * throwing, which is what makes it the right method to build a gate on.
 */
async function judge(
  options: ProtectOptions,
  request: NextRequest,
): Promise<VerifiedAccessToken | null | typeof UNVERIFIABLE> {
  try {
    return await options.idenzy.verify(request.headers);
  } catch {
    return UNVERIFIABLE;
  }
}

/**
 * A refusal that says "us", not "you".
 *
 * `Retry-After` is 30 seconds because that is the order of the cooldown `jose` puts on
 * refetching a key set, so a client honouring it comes back roughly when there is a chance
 * of a different answer.
 */
function unverifiable(options: ProtectOptions): NextResponse {
  if (options.onUnverifiable === "allow") return NextResponse.next();
  return new NextResponse(null, { status: 503, headers: { "retry-after": "30" } });
}

/**
 * The sign-in URL, resolved against the request so a relative path works, and carrying where
 * the visitor was going.
 *
 * `search` and `hash` are dropped from the return value on purpose. A path is enough to send
 * somebody back, and the query string of the page they were refused is the part most likely
 * to hold something that should not be round-tripped through a redirect they can read.
 */
function signInTarget(request: NextRequest, options: ProtectOptions): URL {
  const target = new URL(options.signInUrl, request.nextUrl.origin);
  const parameter = options.returnTo === undefined ? "next" : options.returnTo;
  if (parameter !== null) target.searchParams.set(parameter, request.nextUrl.pathname);
  return target;
}
