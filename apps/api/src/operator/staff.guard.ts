import { InsufficientScopeError, MissingCredentialsError } from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { AccessTokenVerifier } from "@idenzy/node";
import { IdentityRepository } from "@idenzy/persistence/repository/identity-repository";
import { StaffReader } from "@idenzy/persistence/repository/staff-reader";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import { STAFF_RANK, type StaffRole } from "@idenzy/protocol/enums/staff";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

export const REQUIRES_STAFF = "idenzy:requires-staff";

/** Marks a route as needing a member of Idenzy staff of at least this role. Opt-in. */
export const RequireStaff = (role: StaffRole): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_STAFF, role);

/** Injection token for the verifier bound to the operator project, or null where none is set. */
export const OPERATOR_VERIFIER = Symbol("idenzy:operator-verifier");
/** Injection token for the operator project's uuid, or null where none is set. */
export const OPERATOR_PROJECT = Symbol("idenzy:operator-project");

/** Who is operating, once the guard has let them through. */
export interface OperatorPrincipal {
  readonly staffId: string;
  readonly email: string;
  readonly role: StaffRole;
}

declare module "fastify" {
  interface FastifyRequest {
    operator?: OperatorPrincipal;
  }
}

export function operatorOf(request: FastifyRequest): OperatorPrincipal {
  const operator = request.operator;
  if (operator === undefined) throw new MissingCredentialsError();
  return operator;
}

/** The same pattern `staff_email_domain_ck` holds the table to: one local part, exactly this domain. */
const STAFF_ADDRESS = /^[a-z0-9._%+-]+@idenzy\.io$/;

/**
 * Lets a member of Idenzy staff through to an operator route, and nobody else (ADR-0018).
 *
 * Four checks, each of which is the whole defence against a different mistake:
 *
 * 1. **The token is the operator project's.** Verified against its own audience, from the
 *    `Authorization` header only — never the session cookie, whose name every project shares — so
 *    a dashboard token or a customer's token is refused before anything is looked up.
 * 2. **The person signed in with Google.** Read server-side from the operator project's identities
 *    rather than trusted from a claim, because the token carries neither the email nor the method.
 *    The provider has already refused any Google account outside the idenzy.io Workspace (`hd`).
 * 3. **The address is an idenzy.io one.** Checked again here, so a project misconfigured without
 *    the hosted-domain restriction still admits nobody else.
 * 4. **The address is an active `staff` row of a high enough role** — a table the application can
 *    read and never write.
 *
 * Opt-in on `@RequireStaff`, so every other route passes straight through. Not configured means
 * closed: with no operator project, every operator route answers 401.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly uow: UnitOfWork,
    private readonly staff: StaffReader,
    private readonly logger: Logger,
    @Optional() @Inject(OPERATOR_VERIFIER) private readonly verifier: AccessTokenVerifier | null,
    @Optional() @Inject(OPERATOR_PROJECT) private readonly projectId: string | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<StaffRole>(REQUIRES_STAFF, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const verifier = this.verifier;
    const projectId = this.projectId;
    if (verifier == null || projectId == null) this.refuse(request, "operator project unset");

    // The header alone: an operator token never travels as a cookie, and the cookie's name is the
    // same for every project, so accepting one here would be accepting whoever set it.
    const token = await verifier.verifyRequest({ authorization: request.headers.authorization });
    const userId = PublicId.parse(IdPrefix.User, token.userId).uuid;

    const tenant = new TenantContext(projectId, String(request.id), "system");
    const identities = await this.uow.transaction((tx) =>
      new IdentityRepository(tx, tenant).listForUser(userId),
    );
    const google = identities.find((identity) => identity.provider === ProviderId.Google);
    const email = google?.email?.toLowerCase() ?? null;
    if (email === null || !STAFF_ADDRESS.test(email)) this.refuse(request, "no idenzy.io identity");

    const member = await this.staff.activeByEmail(email);
    if (member === null) this.refuse(request, "not active staff");

    if (STAFF_RANK[member.role] < STAFF_RANK[required]) {
      throw new InsufficientScopeError({ detail: { required, held: member.role } });
    }
    request.operator = { staffId: member.id, email: member.email, role: member.role };
    return true;
  }

  /** Logged, because a refused operator is somebody worth knowing about, then refused. */
  private refuse(request: FastifyRequest, reason: string): never {
    this.logger.warn("operator refused", {
      requestId: String(request.id),
      component: "operator",
      outcome: reason,
    });
    throw new MissingCredentialsError();
  }
}
