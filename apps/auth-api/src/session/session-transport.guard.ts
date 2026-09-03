import { AppConfig } from "@idenzy/config/app-config";
import { InternalError, SessionTransportUnavailableError } from "@idenzy/core/errors";
import { IdenzyCookie, IdenzyHeader, SessionTransport } from "@idenzy/protocol/http/headers";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SessionCookies } from "./session-cookies.js";

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
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.publicRoute === true) return true;

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
    const presented = this.cookies.read(request, IdenzyCookie.Refresh);
    if (presented !== undefined) request.refreshCookie = presented;
    return true;
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
