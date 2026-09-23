import { AppConfig } from "@idenzy/config/app-config";
import {
  CsrfCheckFailedError,
  InternalError,
  OriginNotAllowedError,
  SessionTransportUnavailableError,
} from "@idenzy/core/errors";
import { hashToken, safeCompareHex } from "@idenzy/crypto/tokens/random";
import { IdenzyCookie, IdenzyHeader, SessionTransport } from "@idenzy/protocol/http/headers";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { BROWSER_NAVIGATION } from "../http/browser-navigation.decorator.js";
import { CorsPolicy } from "../http/cors-policy.js";
import { Surface, surfaceOf } from "../http/surface.js";
import { SessionCookies } from "./session-cookies.js";

/** Methods that change something. GET and HEAD carry no ambient risk worth this cost. */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

declare module "fastify" {
  interface FastifyRequest {
    /** Header mode unless the client asked otherwise. Decided once, here. */
    transport?: SessionTransport;
    /** The refresh token from the cookie jar, read only in cookie mode. */
    refreshCookie?: string;
  }
}

/**
 * Decides how this request carries its session, and refuses cookie mode where it cannot work
 * (PROJECT.md 4.3).
 *
 * Declared per request rather than configured per project, because one project serves a web
 * app and a mobile app that cannot want the same thing. Letting the client choose is safe:
 * cookie mode gets you strictly less than header mode does, since the refresh token leaves
 * the response body entirely, so there is nothing to gain by lying.
 *
 * The refusal is the part worth arguing for. A `__Host-` cookie the browser will silently
 * drop looks to the customer exactly like a sign-in that does nothing, so asking for cookie
 * mode where it cannot work is answered plainly and the SDK falls back to header mode.
 *
 * Cookie mode cannot work without a custom auth domain, and the reason is `SameSite`. It is a
 * *site* rule, not an origin one: `app.customer.com` to `auth.customer.com` is same-site and
 * the cookie flows, while `app.customer.com` to our shared API host is cross-site and it never
 * will. Localhost is the development exception, where everything is same-site by accident.
 */
@Injectable()
export class SessionTransportGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    private readonly cookies: SessionCookies,
    private readonly cors: CorsPolicy,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.publicRoute === true) return true;

    /*
     * The dashboard surface has no session transport to declare. It authenticates with a
     * Bearer token the panel holds, never with a `__Host-` cookie — those are locked to the
     * auth API's own hostname and cannot reach a management route even when both are served
     * by this one process. Leaving `request.transport` unset is what keeps
     * `SessionCookieInterceptor` inert there too, since it acts only on cookie mode.
     *
     * The other three global guards need no such line: each is opt-in on metadata no
     * management route carries.
     */
    const surface = surfaceOf(request.url);
    if (surface === Surface.Dashboard || surface === Surface.Operator) return true;

    const transport = this.declared(request);
    request.transport = transport;
    if (transport === SessionTransport.Header) return true;

    // Fails closed rather than skipping: if this ever runs before tenant resolution, the
    // eligibility check below would silently pass and cookie mode would be granted blind.
    if (request.tenant === undefined || request.project === undefined) {
      throw new InternalError({
        detail: { reason: "the transport guard ran before the tenant was resolved" },
      });
    }
    this.assertEligible(request);
    // Checked before the credential is stashed, not after: nothing downstream should be able
    // to reach a token on a request that was going to be refused anyway.
    const presented = this.cookies.read(request, IdenzyCookie.Refresh);
    this.assertNotCrossSite(context, request, presented);
    if (presented !== undefined) request.refreshCookie = presented;
    return true;
  }

  /**
   * The cross-site checks, and they run before anything is consumed.
   *
   * That ordering is the point. A forged request that burned the victim's refresh token
   * would trip reuse detection, which means an attacker could sign someone out of every
   * device by making their browser send one request. Refusing first costs the attacker
   * nothing and the victim nothing.
   *
   * Header mode is skipped rather than passed. Nothing is ambient there, and a mobile client
   * sends no `Origin` at all, so applying these would break the transport that does not need
   * them.
   *
   * Coverage is wider than refresh and sign-out. Every route that *writes* the cookie is a
   * login-CSRF target: an attacker who makes a victim's browser complete a sign-in as the
   * attacker plants their own session, and everything the victim does afterwards happens in
   * the attacker's account. Those routes have no CSRF cookie yet, so `Origin` carries them,
   * which is sufficient because script cannot forge it.
   */
  private assertNotCrossSite(
    context: ExecutionContext,
    request: FastifyRequest,
    presented: string | undefined,
  ): void {
    if (!UNSAFE.has(request.method)) return;
    // A top-level navigation or a provider's form post. Apple posts its callback with
    // `Origin: https://appleid.apple.com`, so an Origin check here would break Sign in with
    // Apple. These are defended by a one-shot state and a single-use code instead.
    if (this.isBrowserNavigation(context)) return;

    const origin = request.headers.origin;
    const allowed = request.project?.allowedOrigins ?? [];
    if (typeof origin !== "string" || !this.cors.originAllowed(origin, allowed)) {
      throw new OriginNotAllowedError({ detail: { origin: origin ?? null } });
    }

    // Fail closed when present, silent when absent: Fetch Metadata is a second signal and
    // never the only one, so an older browser that omits it is not refused.
    const site = request.headers["sec-fetch-site"];
    if (typeof site === "string" && (site === "cross-site" || site === "none")) {
      throw new CsrfCheckFailedError({ detail: { secFetchSite: site } });
    }

    // Only once a session is actually being presented. The sign-in routes have no CSRF
    // cookie to echo yet, and demanding one there would make sign-in impossible.
    if (presented === undefined) return;
    this.assertDoubleSubmit(request);
  }

  /**
   * Double-submit, made sound by the `__Host-` prefix.
   *
   * Plain double-submit is defeated by cookie tossing, where a sibling subdomain writes a
   * cookie the target host will read. `__Host-` forbids `Domain` and pins the cookie to the
   * exact host that set it, so there is no sibling that can write this one. That is why the
   * prefix is load-bearing rather than decorative.
   *
   * Compared as digests so the comparison is constant time over a fixed length, whatever the
   * two values turn out to be.
   */
  private assertDoubleSubmit(request: FastifyRequest): void {
    const cookie = this.cookies.read(request, IdenzyCookie.Csrf);
    const header = request.headers[IdenzyHeader.Csrf];
    if (cookie === undefined || typeof header !== "string" || header.length === 0) {
      throw new CsrfCheckFailedError({ detail: { reason: "missing" } });
    }
    if (!safeCompareHex(hashToken(cookie), hashToken(header))) {
      throw new CsrfCheckFailedError({ detail: { reason: "mismatch" } });
    }
  }

  private isBrowserNavigation(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(BROWSER_NAVIGATION, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private declared(request: FastifyRequest): SessionTransport {
    const declared = request.headers[IdenzyHeader.SessionTransport];
    return declared === SessionTransport.Cookie ? SessionTransport.Cookie : SessionTransport.Header;
  }

  /**
   * Outside development, cookie mode needs HTTPS and a verified auth domain.
   *
   * `trustProxy` is on, so `request.protocol` reflects `X-Forwarded-Proto` and reads the
   * scheme the browser actually used rather than the one the load balancer speaks to us over.
   */
  private assertEligible(request: FastifyRequest): void {
    if (!this.config.isProduction) return;
    if (request.protocol !== "https") {
      throw new SessionTransportUnavailableError({ detail: { reason: "insecure_transport" } });
    }
    if (request.project?.hasAuthDomain !== true) {
      throw new SessionTransportUnavailableError({ detail: { reason: "no_auth_domain" } });
    }
  }
}
