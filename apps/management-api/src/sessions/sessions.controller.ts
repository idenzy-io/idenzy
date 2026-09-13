import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ProjectSessionList,
  type ProjectSessionQuery,
  projectSessionQuerySchema,
  type RevokedSessions,
  type RevokeSessionsRequest,
  revokeSessionsSchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { SessionsService } from "./sessions-service.js";

/**
 * A project's sessions, across every account.
 *
 * Developer throughout, the same line the users routes stop at and for the same reason:
 * `members.ts` sells "your users and their sessions" as one capability at
 * owner/admin/developer, so reading cannot quietly be looser than that.
 *
 * Revoking is a POST taking a list rather than a DELETE per id. The screen's selection bar
 * ends a set, and a request per row half-succeeds on a slow link — leaving the operator
 * with no single answer about what they just did, during the incident that made them press
 * it.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @RequireRole(MemberRole.Developer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(projectSessionQuerySchema)) query: ProjectSessionQuery,
  ): Promise<ProjectSessionList> {
    return await this.sessions.list(orgContextFrom(request), projectId, query);
  }

  @Post("revoke")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async revoke(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(revokeSessionsSchema)) body: RevokeSessionsRequest,
  ): Promise<RevokedSessions> {
    return {
      revoked: await this.sessions.revoke(orgContextFrom(request), projectId, body.sessionIds),
    };
  }
}
