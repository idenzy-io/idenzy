import { MissingCredentialsError } from "@idenzy/core/errors";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import type { MemberRole } from "@idenzy/protocol/enums/tenancy";
import type { FastifyRequest } from "fastify";

/** Who is signed in, and which organisation this request acts on. */
export interface DashboardPrincipal {
  /** The `users` row in Idenzy's own project. We run the panel on our own product. */
  readonly userId: string;
  readonly sessionId: string;
  /**
   * The name on the account, where the token carries one.
   *
   * Null is the normal case rather than an error: `name` is a claim a project chooses to
   * issue, and ours may not. Anything reading this has to have an answer for null.
   */
  readonly displayName: string | null;
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
 * The membership this request is acting as, for the columns that record a member.
 *
 * `org_invitations.invited_by` and `org_security_settings.updated_by` hold an
 * `org_members.id`, not a `users.id`, and the two are different uuids for the same person —
 * which is how an invitation came to be listed as sent by "Unknown" on the members screen.
 * Read from the place `orgContextFrom` reads, so a handler cannot record one actor while
 * acting as another.
 */
export function actorMemberId(request: FastifyRequest): string {
  const principal = principalOf(request);
  if (principal.membership === null) throw new MissingCredentialsError();
  return principal.membership.memberId;
}

/**
 * The organisation scope for this request, for the repositories that take an `OrgContext`
 * (ADR-0011).
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
