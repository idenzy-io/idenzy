import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type CreateProject,
  createProjectSchema,
  type ProjectList,
  type ProjectSummary,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
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
}
