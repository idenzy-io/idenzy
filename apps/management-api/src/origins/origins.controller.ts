import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type AddProjectOrigin,
  addProjectOriginSchema,
  type ProjectOrigin,
  type ProjectOriginList,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { OriginsService } from "./origins-service.js";

/**
 * A project's allowed browser origins.
 *
 * A developer writes and a viewer reads, which is the panel's own role matrix rather than a
 * choice made here: this is sign-in configuration, the line the matrix draws at developer, and
 * anybody who can already mint a publishable key can point an application at this API. An
 * origin decides which page may *read* a response for a session it already holds — narrower
 * than a custom auth domain, which decides where a customer's users are sent to sign in and is
 * therefore an admin's.
 *
 * Reading is a rank lower because the list is the diagnosis. A browser call that fails because
 * of this list fails invisibly: the server answers 200 and the browser discards it, so somebody
 * holding a support conversation needs to see the list, and what it holds is the customer's own
 * application URLs rather than anything secret.
 *
 * The project is in the path and never trusted from it. `OriginsService` resolves it through
 * `ProjectScope`, which refuses a project the caller's organisation does not own.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/origins")
export class OriginsController {
  constructor(private readonly origins: OriginsService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<ProjectOriginList> {
    return { origins: await this.origins.list(orgContextFrom(request), projectId) };
  }

  @Post()
  @HttpCode(201)
  @RequireRole(MemberRole.Developer)
  async add(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(addProjectOriginSchema)) body: AddProjectOrigin,
  ): Promise<ProjectOrigin> {
    return await this.origins.add(orgContextFrom(request), projectId, body.origin);
  }

  /**
   * By id rather than by the origin itself.
   *
   * An origin in a path segment is a URL inside a URL: it has to be escaped by every caller
   * and unescaped by us, and a caller that forgets addresses a route nobody wrote. The id is
   * on every row the list returns.
   */
  @Delete(":originId")
  @HttpCode(204)
  @RequireRole(MemberRole.Developer)
  async remove(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("originId") originId: string,
  ): Promise<void> {
    await this.origins.remove(orgContextFrom(request), projectId, originId);
  }
}
