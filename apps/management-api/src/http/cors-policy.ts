import { AppConfig } from "@idenzy/config/app-config";
import { IDENZY_HEADERS } from "@idenzy/protocol/http/headers";
import { Injectable } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Everything the panel sends us, plus the two standard ones. */
const ALLOWED_HEADERS = [...IDENZY_HEADERS, "content-type", "authorization"].join(", ");
const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

/** Ten minutes, matching auth-api: long enough to matter, short enough to re-read. */
const PREFLIGHT_MAX_AGE = "600";

/** Loopback in development only, and as code rather than data so it cannot be provisioned on. */
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * CORS for the management API, and it is deliberately much simpler than auth-api's.
 *
 * Two differences, and both are consequences of what this service is rather than
 * shortcuts. It is addressed only by our own dashboard, never by a customer's browser, so
 * the allowlist is one configured origin instead of a per-project table — and the preflight
 * knows the answer, because it does not have to resolve a tenant it cannot see.
 *
 * **It sends no `Access-Control-Allow-Credentials`, and that is the security-relevant
 * half.** Every request here authenticates with a Bearer token the panel holds in memory;
 * nothing is ambient. A cross-site request forged by another page carries no credential of
 * ours and can do nothing, so there is no CSRF surface to defend — and allowing
 * credentials would create one where none exists. The `__Host-` session cookies cannot
 * reach this host anyway: they are locked to the auth API's own hostname.
 *
 * The refusal is silent by design, as it is one service over. A request from an
 * unregistered origin is answered normally and simply gets no CORS headers, so the browser
 * blocks the read. Nothing is leaked by the status code.
 */
@Injectable()
export class CorsPolicy {
  constructor(private readonly config: AppConfig) {}

  /**
   * Whether a browser at this origin may read our answers.
   *
   * The configured dashboard origin, plus loopback outside production. Loopback is in code
   * and not in configuration on purpose: a deployment cannot be talked into trusting
   * `http://localhost` by setting an environment variable.
   */
  allowed(origin: string): boolean {
    if (origin === this.config.get("DASHBOARD_ORIGIN")) return true;
    return !this.config.isProduction && LOCALHOST.test(origin);
  }

  /**
   * Bound to Fastify rather than to Nest, for the reasons auth-api's is.
   *
   * The preflight route has to exist outside the guard chain, or an `OPTIONS` would be
   * authenticated and refused before it could answer. The response hook is `onSend` so it
   * runs after the exception filter: a 401 has to carry CORS headers too, or the browser
   * reports an opaque network error and the panel cannot tell anybody what went wrong.
   */
  bindTo(instance: FastifyInstance): void {
    instance.route({
      method: "OPTIONS",
      url: "/*",
      handler: async (request, reply) => {
        const origin = request.headers.origin;
        if (typeof origin === "string" && this.allowed(origin)) {
          this.allow(reply, origin);
          reply
            .header("access-control-allow-headers", ALLOWED_HEADERS)
            .header("access-control-allow-methods", ALLOWED_METHODS)
            .header("access-control-max-age", PREFLIGHT_MAX_AGE);
        }
        await reply.status(204).send();
      },
    });

    instance.addHook("onSend", (request: FastifyRequest, reply: FastifyReply, payload, done) => {
      const origin = request.headers.origin;
      if (typeof origin === "string" && this.allowed(origin)) this.allow(reply, origin);
      done(null, payload);
    });
  }

  /**
   * No `access-control-allow-credentials`. See the class note: this API carries no ambient
   * credential, and saying otherwise would invite one.
   */
  private allow(reply: FastifyReply, origin: string): void {
    reply
      .header("access-control-allow-origin", origin)
      .header("vary", "origin")
      .header("access-control-expose-headers", "retry-after");
  }
}
