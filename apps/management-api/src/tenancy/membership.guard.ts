import { InsufficientScopeError, MissingCredentialsError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { AccessTokenVerifier } from "@idenzy/node";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

export const REQUIRES_SIGN_IN = "idenzy:requires-sign-in";
export const REQUIRES_ROLE = "idenzy:requires-role";

/** Marks a route as needing a signed-in member of staff at the customer. Opt-in. */
export const RequireSignIn = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_SIGN_IN, true);

/**
 * Marks a route as needing a role at least this senior on the organisation in the path.
 *
 * Implies `RequireSignIn`. The ordering below is the one the panel's matrix uses, and it
 * lives here rather than in each controller so a new route cannot quietly ship without a
 * check: a route under `/v1/orgs/:orgId` with neither decorator resolves no membership,
 * and `orgContextFrom` then refuses rather than binding nothing.
 */
export const RequireRole = (role: MemberRole): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_ROLE, role);

/** Most senior first. A member passes a requirement at or below their own rank. */
const RANK: Record<MemberRole, number> = {
  [MemberRole.Owner]: 3,
  [MemberRole.Admin]: 2,
  [MemberRole.Developer]: 1,
  [MemberRole.Viewer]: 0,
};

/**
 * Authenticates the person behind a dashboard request, then binds the organisation.
 *
 * Two steps, and the order matters. The token says who is asking and is verified against
 * our own published keys with `@idenzy/node` — the same server SDK a customer uses, which
 * is the most honest test of it we have (PROJECT.md 9.5). `aud` must name our dashboard
 * project, so a token minted for a customer's project cannot be replayed here.
 *
 * Then the organisation. A person signs in once and may belong to several, so the path
 * names one and this checks the membership before anything binds `app.org_id`. That check
 * cannot run under the policy it is deciding, which is why it goes through migration
 * 0036's SECURITY DEFINER functions rather than a repository.
 *
 * A membership that does not exist and a role that is too junior are deliberately
 * different answers: the first is 401-shaped because the caller is not part of this
 * organisation at all, the second is 403 because they are and may not do this.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly orgs: OrgMembershipReader,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_SIGN_IN, [
      context.getHandler(),
      context.getClass(),
    ]);
    const role = this.reflector.getAllAndOverride<MemberRole>(REQUIRES_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== true && role === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = await this.verifier.verifyRequest({
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    const userId = PublicId.parse(IdPrefix.User, token.userId).uuid;

    request.dashboard = {
      userId,
      sessionId: token.sessionId,
      membership: role === undefined ? null : await this.bind(request, userId, role),
    };
    return true;
  }

  private async bind(
    request: FastifyRequest,
    userId: string,
    required: MemberRole,
  ): Promise<DashboardMembership> {
    const params = request.params as Record<string, string> | undefined;
    const given = params?.["orgId"];
    if (given === undefined) throw new MissingCredentialsError();
    const orgId = PublicId.parse(IdPrefix.Org, given).uuid;

    const membership = await this.orgs.membership(userId, orgId);
    // Not found and not permitted are the same answer here on purpose: an organisation
    // somebody is not in must not be distinguishable from one that does not exist, or the
    // id space becomes an oracle for who our customers are.
    if (membership === null) throw new MissingCredentialsError();
    if (RANK[membership.role] < RANK[required]) {
      throw new InsufficientScopeError({ detail: { required, held: membership.role } });
    }
    return { orgId, memberId: membership.memberId, role: membership.role };
  }
}

interface DashboardMembership {
  readonly orgId: string;
  readonly memberId: string;
  readonly role: MemberRole;
}
