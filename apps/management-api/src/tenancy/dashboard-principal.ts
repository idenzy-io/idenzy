import { MissingCredentialsError } from "@idenzy/core/errors";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import type { MemberRole } from "@idenzy/protocol/enums/tenancy";
import type { FastifyRequest } from "fastify";

/** Who is signed in, and which organisation this request acts on. */
export interface DashboardPrincipal {
  /** The `users` row in Idenzy's own project. We run the panel on our own product. */
  readonly userId: string;
  readonly sessionId: string;
  /** Absent until a route under `/v1/orgs/:orgId` has had its membership checked. */
  readonly membership: {
    readonly orgId: string;
    readonly memberId: string;
    readonly role: MemberRole;
  } | null;
}

declare module "fastify" {
  interface FastifyRequest {
    dashboard?: DashboardPrincipal;
  }
}

export function principalOf(request: FastifyRequest): DashboardPrincipal {
  const principal = request.dashboard;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}

/**
 * The organisation scope for this request, for `UnitOfWork.runForOrg` (ADR-0011).
 *
 * Throws rather than returning null on a request with no membership resolved. A caller
 * reaching for an org context on a route that never checked one is a routing mistake, and
 * the safe reading of it is a refusal rather than a transaction bound to nothing — which
 * would read as an empty organisation instead of an error.
 */
export function orgContextFrom(request: FastifyRequest): OrgContext {
  const principal = principalOf(request);
  if (principal.membership === null) throw new MissingCredentialsError();
  return new OrgContext(
    principal.membership.orgId,
    String(request.id),
    "customer_staff",
    principal.membership.memberId,
  );
}
