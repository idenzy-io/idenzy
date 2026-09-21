import { ResourceNotFoundError } from "@idenzy/core/errors";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import type { OrgList } from "@idenzy/protocol/schemas/management";
import { Controller, Get, Param, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { orgContextFrom, principalOf } from "../tenancy/dashboard-principal.js";
import { RequireRole, RequireSignIn } from "../tenancy/membership.guard.js";
import type { OrgDetail } from "./orgs-service.js";
import { OrgsService } from "./orgs-service.js";

/**
 * The organisations a person belongs to (ADR-0011).
 *
 * The controller does nothing but translate, the way auth-api's do (PROJECT.md 9.3 step
 * 8): read the principal the guard put there, call the service, shape the result.
 *
 * Note what is absent: no route takes an organisation id from a body. The one in the path
 * is what the guard checked the membership against, so a handler cannot act on a
 * different organisation than the one it was authorised for.
 */
@Controller("v1/orgs")
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  @RequireSignIn()
  async list(@Req() request: FastifyRequest): Promise<OrgList> {
    const principal = principalOf(request);
    return { organisations: await this.orgs.listFor(principal.userId) };
  }

  /**
   * A viewer can read this. The role matrix starts mattering on the writes, and gating a
   * read of an organisation somebody is demonstrably a member of would only mean the
   * panel could not render its own header.
   */
  @Get(":orgId")
  @RequireRole(MemberRole.Viewer)
  async detail(@Req() request: FastifyRequest, @Param("orgId") orgId: string): Promise<OrgDetail> {
    const principal = principalOf(request);
    const summaries = await this.orgs.listFor(principal.userId);
    const summary = summaries.find((candidate) => candidate.id === orgId);
    // Unreachable while the guard runs first, which is exactly why it is asserted rather
    // than assumed: a route that lost its decorator would otherwise read as an empty
    // organisation instead of failing.
    if (summary === undefined) throw new ResourceNotFoundError({ detail: { orgId } });
    return await this.orgs.detail(orgContextFrom(request), summary);
  }
}
