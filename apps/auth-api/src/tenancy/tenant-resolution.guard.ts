import { MissingCredentialsError } from "@idenzy/core/errors/errors";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { isApiKey } from "@idenzy/protocol/schemas/common";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ProjectResolver } from "./project-resolver.js";

export const PUBLIC_ROUTE = "idenzy:public-route";

/** Marks a route as reachable without a tenant. Health and discovery only. */
export const NoTenant = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

/**
 * Resolves the project from the Host header or an API key, and refuses the request if
 * it cannot (PROJECT.md 9.3 step 3).
 *
 * No tenant, no request. Routes that genuinely have no tenant opt out explicitly with
 * @NoTenant rather than the guard guessing, so adding an unauthenticated endpoint is a
 * visible decision in the diff.
 */
@Injectable()
export class TenantResolutionGuard implements CanActivate {
  constructor(
    private readonly resolver: ProjectResolver,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // The Authorization header carries either an API key or an end user's access token.
    // Only a key resolves the project; a user token is resolved by Host and authenticated
    // later by SessionGuard, which is why this checks the prefix rather than trying both.
    const apiKey = this.apiKey(request);
    const host = request.headers.host;

    const resolved =
      apiKey !== null
        ? await this.resolver.byApiKey(apiKey)
        : host !== undefined
          ? await this.resolver.byHost(host)
          : null;

    if (resolved === null) throw new MissingCredentialsError();

    request.tenant = new TenantContext(
      resolved.projectId,
      request.id,
      apiKey === null ? "user" : "api_key",
      null,
      null,
    );
    return true;
  }

  private apiKey(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    return isApiKey(token) ? token : null;
  }
}
