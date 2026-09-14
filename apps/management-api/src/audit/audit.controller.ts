import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ProjectAuditList,
  type ProjectAuditQuery,
  projectAuditQuerySchema,
} from "@idenzy/protocol/schemas/management";
import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { AuditService } from "./audit-service.js";

/**
 * A project's audit trail.
 *
 * Viewer, which is the loosest role on the panel's matrix and the right one here: the
 * trail is a record of what the team did, the screen it feeds says so, and a control that
 * hid it from the people it is about would make it a surveillance log rather than an audit
 * one. It is also read-only at every layer below this, so there is nothing a viewer could
 * reach that a developer should not.
 *
 * One route, deliberately. A single entry has no page of its own — the screen's detail
 * panel opens a row it already holds — and an export writes a file, which is the DSR
 * worker's shape and does not exist yet. A route that answered an export by assembling one
 * in a request handler is the version of this that falls over on the first customer with a
 * year of traffic.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(projectAuditQuerySchema)) query: ProjectAuditQuery,
  ): Promise<ProjectAuditList> {
    return await this.audit.list(orgContextFrom(request), projectId, query);
  }
}
