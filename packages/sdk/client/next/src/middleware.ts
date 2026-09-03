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
}

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
 */
export function protectRoutes(
  options: ProtectOptions,
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    if (!options.isProtected(request.nextUrl.pathname)) return NextResponse.next();
    const session = await options.idenzy.sessionFor(request);
    if (session !== null) return NextResponse.next();
    return NextResponse.redirect(signInTarget(request, options));
  };
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
