import { InsufficientScopeError } from "@idenzy/core/errors";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

export const REQUIRES_SECRET_KEY = "idenzy:requires-secret-key";

/** Marks a route as machine-to-machine: a secret key, never a browser credential. */
export const RequireSecretKey = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_SECRET_KEY, true);

/**
 * Refuses a route to anything but a secret key on `Authorization`.
 *
 * `TenantResolutionGuard` has already worked out which credential the request presented,
 * and records the only one that is a machine acting rather than an application being used
 * as `api_key`. This reads that decision instead of parsing the header again, so there is
 * one place that decides what a secret key is.
 *
 * The answer is `insufficient_scope` rather than `missing_credentials`, because the caller
 * did present something we recognised. It tells a customer wiring up a server that their
 * key is the wrong kind, which is the mistake they are actually making, and it confirms
 * nothing to anyone who did not already hold a valid key.
 */
@Injectable()
export class SecretKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_SECRET_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.tenant?.actorType !== "api_key") {
      throw new InsufficientScopeError({ detail: { required: "secret_key" } });
    }
    return true;
  }
}
