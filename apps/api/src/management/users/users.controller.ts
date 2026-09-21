import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ProjectUser,
  type ProjectUserList,
  type ProjectUserQuery,
  projectUserQuerySchema,
  type RevokedSessions,
  type SuspendUser,
  suspendUserSchema,
  type UserSessionList,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { UsersService } from "./users-service.js";

/**
 * A project's end users, and their sessions.
 *
 * Developer on every route, reading included, and that is the panel's own matrix rather
 * than a judgement made here: `members.ts` lists "Your users and their sessions" at owner,
 * admin and developer. A viewer reading the list would be a capability the customer was
 * told stops at developer, and a matrix that lies about one row is not worth showing.
 *
 * Reading is a GET and every state change is a POST, including the two that end something.
 * Suspending is not a DELETE because nothing is removed — `banned_until` is what changes —
 * and revoking sessions is not one either, for the same reason: the rows stay and carry
 * `revoked_at`, because a session that vanished would take its own audit trail with it.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireRole(MemberRole.Developer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(projectUserQuerySchema)) query: ProjectUserQuery,
  ): Promise<ProjectUserList> {
    return await this.users.list(orgContextFrom(request), projectId, query);
  }

  @Get(":userId")
  @RequireRole(MemberRole.Developer)
  async find(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ): Promise<ProjectUser> {
    return await this.users.find(orgContextFrom(request), projectId, userId);
  }

  /**
   * Suspends until an instant.
   *
   * Answers with the user rather than with nothing, so the screen redraws from what the
   * database now holds instead of from what it hoped the write did.
   */
  @Post(":userId/suspend")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async suspend(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(suspendUserSchema)) body: SuspendUser,
  ): Promise<ProjectUser> {
    return await this.users.suspend(
      orgContextFrom(request),
      projectId,
      userId,
      new Date(body.until),
    );
  }

  @Post(":userId/restore")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async restore(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ): Promise<ProjectUser> {
    return await this.users.restore(orgContextFrom(request), projectId, userId);
  }

  @Get(":userId/sessions")
  @RequireRole(MemberRole.Developer)
  async sessions(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ): Promise<UserSessionList> {
    return {
      sessions: [...(await this.users.sessions(orgContextFrom(request), projectId, userId))],
    };
  }

  /** Sign out everywhere. The count is the answer, because zero is a thing to have done. */
  @Post(":userId/sessions/revoke")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async revokeSessions(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ): Promise<RevokedSessions> {
    return {
      revoked: await this.users.revokeSessions(orgContextFrom(request), projectId, userId),
    };
  }
}
