import { AppConfig } from "@idenzy/config/app-config";
import { IDENZY_HEADERS } from "@idenzy/protocol/http/headers";
import { isLoopbackOrigin } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProjectResolver } from "../tenancy/project-resolver.js";
import { Surface, surfaceOf } from "./surface.js";

/** Everything a browser is allowed to send us, plus the two standard ones. */
const ALLOWED_HEADERS = [...IDENZY_HEADERS, "content-type", "authorization"].join(", ");

/**
 * Every verb a controller answers, across both surfaces.
 *
 * `PUT` is on the list because three dashboard routes use it — the claim template, a social
 * provider, and a retention age — and it was once missing. The failure is worth remembering,
 * because it is the argument for reading this list against the routes rather than assuming
 * it: a preflight answered 204 and said PUT was not allowed, so the browser refused to send
 * the request at all. No server log, no status code the panel could report, and a save that
 * looked like a network fault. Those screens had been checked over HTTP, where CORS does not
 * apply, which is exactly the gap that hid it.
 */
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

/** Ten minutes. Long enough to matter, short enough that an allowlist edit takes effect. */
const PREFLIGHT_MAX_AGE = "600";

/**
 * CORS for both surfaces, split across the two places it has to live (PROJECT.md 4.3).
 *
 * **One service, two answers, and conflating them would be the security bug.** The
 * dashboard surface deliberately sends no `Access-Control-Allow-Credentials`: the panel
 * authenticates with a Bearer token it holds in memory, nothing is ambient, so a forged
 * cross-site request carries no credential of ours and there is no CSRF surface to defend.
 * Allowing credentials there would create one where none exists. The auth surface does send
 * it, because cookie mode is exactly the case where ambient credentials exist. These were
 * two services with two policies; merging them into one process without distinguishing the
 * two would have handed the dashboard routes the auth API's answer.
 *
 * `surfaceOf` decides which, from the path. See that file for why it is the path and not a
 * decorator.
 *
 * The awkward fact this design works around is that a preflight `OPTIONS` carries `Origin`
 * but not our publishable-key header, so at preflight time there is often no way to know
 * which project is being addressed. The resolution is to be strict wherever we *can* resolve
 * one and permissive only where we cannot:
 *
 * - On a custom auth domain the `Host` names the project, so a cross-site preflight is
 *   refused outright. That is also the only deployment where cookie mode works and therefore
 *   the only one where ambient credentials exist to abuse.
 * - On the shared API host nothing resolves, so the preflight reflects. It grants nothing:
 *   a preflight only says the browser *may* send the real request, and the real request's
 *   response is where `Access-Control-Allow-Origin` decides whether anything can be read.
 *
 * Enforcement therefore lives on the actual response, not the preflight. A request from an
 * unregistered origin is answered normally and simply gets no CORS headers, so the browser
 * blocks the read. The hard refusal belongs to the CSRF checks, which are scoped to cookie
 * mode where it actually matters.
 */
@Injectable()
export class CorsPolicy {
  constructor(
    private readonly config: AppConfig,
    private readonly resolver: ProjectResolver,
  ) {}

  /**
   * Binds both halves to Fastify.
   *
   * They are Fastify hooks rather than Nest interceptors for two different reasons. The
   * preflight is an explicit route because Nest registers no `OPTIONS` handlers, so a
   * preflight would otherwise fall through to the 404 path, and a security control should not
   * depend on whether root hooks run for an unmatched route. The response decoration is
   * `onSend` because it runs *after* the exception filter: a 401 from tenant resolution has
   * to carry CORS headers too, or the browser reports an opaque network error and the SDK
   * cannot tell the customer their publishable key is wrong.
   */
  bindTo(instance: FastifyInstance): void {
    instance.route({
      method: "OPTIONS",
      url: "/*",
      handler: async (request, reply) => {
        await this.answerPreflight(request, reply);
      },
    });

    instance.addHook("onSend", (request, reply, payload: unknown, done) => {
      this.decorate(request, reply);
      done(null, payload);
    });
  }

  private async answerPreflight(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const origin = originOf(request);
    if (origin === null) {
      // Not a CORS request at all. Answer, but say nothing about who may call us.
      await reply.code(204).send();
      return;
    }

    const surface = surfaceOf(request.url);
    if (!(await this.preflightAllowed(request, surface, origin))) {
      // No CORS headers. The browser refuses to send the real request, which is the earliest
      // point at which a cross-site call can be stopped.
      await reply.code(204).send();
      return;
    }

    reply.header("access-control-allow-origin", origin);
    // The dashboard takes no credentials. See the class docstring.
    if (surface === Surface.Auth) reply.header("access-control-allow-credentials", "true");
    reply
      .header("access-control-allow-methods", ALLOWED_METHODS)
      .header("access-control-allow-headers", ALLOWED_HEADERS)
      .header("access-control-max-age", PREFLIGHT_MAX_AGE)
      .header("vary", "origin, access-control-request-method, access-control-request-headers");
    await reply.code(204).send();
  }

  /**
   * Strict when the Host names a project, permissive when nothing does.
   *
   * A resolution failure here is not an error worth surfacing: the request has not been made
   * yet and the caller learns nothing either way, so an unknown Host simply falls back to
   * reflecting.
   */
  private async preflightAllowed(
    request: FastifyRequest,
    surface: Surface,
    origin: string,
  ): Promise<boolean> {
    // The dashboard's allowlist is one configured origin and is known without a lookup,
    // because this surface is addressed by our own panel and by nothing else.
    if (surface === Surface.Dashboard) return this.dashboardAllowed(origin);
    if (surface === Surface.Operator) return this.operatorAllowed(origin);
    if (surface === Surface.Public) return true;

    const host = request.headers.host;
    if (host === undefined) return true;
    try {
      const project = await this.resolver.byHost(host);
      return this.originAllowed(origin, project.allowedOrigins);
    } catch {
      return true;
    }
  }

  /**
   * Decorates the real response, which is the only place the browser's gate actually is.
   *
   * Four cases, and the order matters. Public routes get a wildcard and no credentials,
   * because a JWKS document varying by origin is uncacheable at the CDN and a project's key
   * set exists to be cached hard. A resolved project gets its allowlist enforced. An
   * unresolved project on an error gets the origin echoed, so the SDK can read our error code
   * rather than an opaque failure. Everything else gets nothing.
   */
  private decorate(request: FastifyRequest, reply: FastifyReply): void {
    const origin = originOf(request);
    if (origin === null) return;

    const surface = surfaceOf(request.url);
    if (surface === Surface.Dashboard || surface === Surface.Operator) {
      // Nothing here may sit in a shared cache either: it is one customer's dashboard data, or
      // every customer's operator data.
      reply.header("cache-control", "no-store");
      appendVary(reply, "origin");
      const allowed =
        surface === Surface.Operator ? this.operatorAllowed(origin) : this.dashboardAllowed(origin);
      if (allowed) {
        reply
          .header("access-control-allow-origin", origin)
          .header("access-control-expose-headers", "retry-after");
      }
      return;
    }

    if (surface === Surface.Public || request.publicRoute === true) {
      reply.header("access-control-allow-origin", "*");
      return;
    }

    // Nothing tenant-scoped may sit in a shared cache. Set before the early returns below,
    // because it is true whether or not the origin turns out to be allowed.
    reply.header("cache-control", "no-store");
    appendVary(reply, "origin");

    const project = request.project;
    if (project === undefined) {
      // Tenant resolution threw. Echoing the origin is what lets the SDK read the error code;
      // the body is one of ours and contains nothing the caller did not already send.
      if (reply.statusCode >= 400) this.allow(reply, origin);
      return;
    }
    if (this.originAllowed(origin, project.allowedOrigins)) this.allow(reply, origin);
  }

  private allow(reply: FastifyReply, origin: string): void {
    reply
      .header("access-control-allow-origin", origin)
      .header("access-control-allow-credentials", "true")
      .header("access-control-expose-headers", "retry-after");
  }

  /**
   * Exact match, with one environment-gated exception for loopback development.
   *
   * Loopback is code rather than data so it cannot be provisioned on, and it includes
   * `*.localhost`, which is how several applications on one laptop keep a cookie jar each.
   *
   * Public because the cross-site checks ask the same question about the same list, and two
   * copies of an allowlist rule is one copy too many.
   */
  originAllowed(origin: string, allowed: readonly string[]): boolean {
    if (allowed.includes(origin)) return true;
    return !this.config.isProduction && isLoopbackOrigin(origin);
  }

  /**
   * The one origin the panel is served from, plus loopback outside production.
   *
   * Loopback is in code rather than in configuration on purpose, as it is above: a
   * deployment cannot be talked into trusting `http://localhost` by setting a variable.
   */
  private dashboardAllowed(origin: string): boolean {
    if (origin === this.config.get("DASHBOARD_ORIGIN")) return true;
    return !this.config.isProduction && isLoopbackOrigin(origin);
  }

  /**
   * The operator console's one origin, plus loopback outside production. Never the dashboard's:
   * a page on the customer-facing origin must not be able to call operator routes, so the two
   * allowlists are separate even though they have the same shape.
   */
  private operatorAllowed(origin: string): boolean {
    if (origin === this.config.get("OPERATOR_ORIGIN")) return true;
    return !this.config.isProduction && isLoopbackOrigin(origin);
  }
}

function originOf(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin.length > 0 ? origin : null;
}

/** Appends rather than sets, so a `Vary` another handler already chose is not discarded. */
function appendVary(reply: FastifyReply, value: string): void {
  const current = reply.getHeader("vary");
  if (typeof current !== "string" || current.length === 0) {
    reply.header("vary", value);
    return;
  }
  const present = current.toLowerCase().split(/\s*,\s*/);
  if (!present.includes(value)) reply.header("vary", `${current}, ${value}`);
}
