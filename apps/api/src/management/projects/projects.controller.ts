import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type CreateProject,
  createProjectSchema,
  type ProjectDetail,
  type ProjectList,
  type ProjectSummary,
  type Rename,
  renameSchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { ProjectsService } from "./projects-service.js";

/**
 * An organisation's projects.
 *
 * Reading takes a viewer and creating takes an admin, which is the split the panel's role
 * matrix already draws: a project is where every sign-in rule and every key lives, so
 * making one is an administrative act rather than a developer's.
 */
@Controller("v1/orgs/:orgId/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async list(@Req() request: FastifyRequest): Promise<ProjectList> {
    return { projects: await this.projects.list(orgContextFrom(request)) };
  }

  @Post()
  @HttpCode(201)
  @RequireRole(MemberRole.Admin)
  async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProject,
  ): Promise<ProjectSummary> {
    return await this.projects.create(orgContextFrom(request), body);
  }
  /** One project in full, for the General settings screen. */
  @Get(":projectId")
  @RequireRole(MemberRole.Viewer)
  async detail(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<ProjectDetail> {
    return await this.projects.detail(orgContextFrom(request), projectId);
  }

  /** The name is the only field a project has that a customer may change. */
  @Patch(":projectId")
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async rename(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(renameSchema)) body: Rename,
  ): Promise<ProjectDetail> {
    return await this.projects.rename(orgContextFrom(request), projectId, body.name);
  }

  /**
   * Owner only, and the only destructive route in this API.
   *
   * Everything keyed on the project goes with it — users, sessions, keys by cascade, the audit
   * trail by purge — so this is not a role an admin should hold: an admin can be invited, and
   * being able to delete a customer's entire tenancy should not arrive with an invitation.
   */
  @Delete(":projectId")
  @HttpCode(204)
  @RequireRole(MemberRole.Owner)
  async remove(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<void> {
    await this.projects.remove(orgContextFrom(request), projectId);
  }
}
