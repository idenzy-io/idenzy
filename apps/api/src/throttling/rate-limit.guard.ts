import { RateLimitStrategy } from "@idenzy/cache/rate-limit-strategy";
import { RateLimitedError } from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ClientIpResolver } from "./client-ip.js";
import { RATE_LIMIT, type RateLimitSpec } from "./rate-limit.decorator.js";

/** A project that could not be resolved still gets limited, under one shared bucket. */
const NO_PROJECT = "unresolved";

/**
 * Applies the per-route limits declared by `@RateLimit` (PROJECT.md 4.5, 4.9).
 *
 * Registered globally and opt-in, and positioned after tenant resolution so a limit can be
 * scoped to the project it was spent against. That scoping is not cosmetic: without it two
 * customers behind one corporate NAT share a bucket, and the busier one locks the other out
 * of their own product.
 *
 * The two dimensions are checked in a deliberate order. The address limit runs first
 * because it needs nothing from the body and refuses a flood at its cheapest point; the
 * subject limit runs second, and only when the request actually names one.
 *
 * Both fail **open**, through `check` rather than `checkStrictly`. A Valkey outage must not
 * become a total authentication outage, and the base class fixes that trade in one place.
 * It is the opposite of the choice `SmsFraudGuard` makes with the same strategy, and the
 * difference is what the failure costs: a sign-in we could not count is a sign-in, and an
 * SMS we could not count is a bill.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitStrategy,
    private readonly clientIp: ClientIpResolver,
    private readonly logger: Logger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<RateLimitSpec | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (spec === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const projectId = request.tenant?.projectId ?? NO_PROJECT;

    // Derived rather than declared, so two routes cannot be given the same name by
    // accident and quietly end up sharing one ceiling.
    const scope = `${context.getClass().name}.${context.getHandler().name}`;

    await this.enforce(scope, "ip", `${projectId}:${this.clientIp.for(request)}`, spec.ip);

    if (spec.subject !== undefined) {
      const subject = this.subjectOf(request, spec.subject.from);
      if (subject !== null) {
        // Hashed, because this key would otherwise make a Valkey dump a list of the
        // addresses of everyone who has tried to sign in. The limiter only ever compares.
        await this.enforce(
          `${scope}:subject`,
          "subject",
          `${projectId}:${hashToken(subject)}`,
          spec.subject,
        );
      }
    }

    return true;
  }

  private async enforce(
    scope: string,
    dimension: "ip" | "subject",
    identifier: string,
    rule: { readonly limit: number; readonly windowSeconds: number },
  ): Promise<void> {
    const decision = await this.limiter.check(scope, identifier, rule);
    if (decision.allowed) return;

    // Logged at the refusal and not at every request: this is the security signal, and
    // the identifier is deliberately absent from it — it is an address or a hash, and
    // neither is declared loggable (PROJECT.md 4.13.8).
    this.logger.warn("rate limit reached", {
      component: "rate-limit",
      outcome: "refused",
      scope,
      dimension,
    });

    throw new RateLimitedError(decision.retryAfterSeconds, {
      detail: { scope, dimension },
    });
  }

  /** First field that is present and non-empty. Case-folded, since an address is not. */
  private subjectOf(request: FastifyRequest, from: readonly string[]): string | null {
    const body = request.body;
    if (typeof body !== "object" || body === null) return null;

    for (const field of from) {
      const value = (body as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim().toLowerCase();
      }
    }
    return null;
  }
}
