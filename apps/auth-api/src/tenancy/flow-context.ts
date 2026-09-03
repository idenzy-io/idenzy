import { MissingCredentialsError } from "@idenzy/core/errors/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { FastifyRequest } from "fastify";

/**
 * The two shapes of "who is asking" and how they relate.
 *
 * `TenantContext` is persistence's, and `FlowContext` is the domain's, which cannot
 * import persistence (PROJECT.md 8.3). They carry the same facts, so these two pure
 * functions are the seam. Keeping it explicit is cheaper than giving the domain a
 * dependency it is not allowed to have.
 */
export function flowContextFrom(request: FastifyRequest): FlowContext {
  const tenant = request.tenant;
  if (tenant === undefined) throw new MissingCredentialsError();
  return {
    projectId: tenant.projectId,
    requestId: tenant.requestId,
    ip: request.ip ?? null,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

export function tenantContextFrom(context: FlowContext): TenantContext {
  return new TenantContext(context.projectId, context.requestId, "user");
}
