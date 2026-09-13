import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ClaimTemplateInput,
  claimTemplateSchema,
  type SavedClaimTemplate,
} from "@idenzy/protocol/schemas/claims";
import { Body, Controller, Get, HttpCode, Param, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { ClaimsService } from "./claims-service.js";

/**
 * A project's claim template.
 *
 * PUT rather than PATCH, unlike the settings document: a template is an ordered list and
 * the screen edits the whole of it, so "replace this list" is what the operation is. A
 * patch over a list would need a language for naming positions, which is a worse version
 * of sending the list.
 *
 * Developer to read, admin to write. A claim is what a customer's own authorisation code
 * branches on, so adding one changes what their backend is willing to do — which is a
 * wider blast radius than an API key and sits with the roles that own configuration.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/claim-template")
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @RequireRole(MemberRole.Developer)
  async read(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<SavedClaimTemplate> {
    return await this.claims.read(orgContextFrom(request), projectId);
  }

  @Put()
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async save(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(claimTemplateSchema)) body: ClaimTemplateInput,
  ): Promise<SavedClaimTemplate> {
    return await this.claims.save(orgContextFrom(request), projectId, body);
  }
}
