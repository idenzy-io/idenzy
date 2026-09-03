import {
  type ClaimTemplateInput,
  claimTemplateSchema,
  type SavedClaimTemplate,
} from "@idenzy/protocol/schemas/claims";
import { Body, Controller, Get, HttpCode, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { flowContextFrom, tenantContextFrom } from "../tenancy/flow-context.js";
import { RequireSecretKey } from "../tenancy/secret-key.guard.js";
import { ClaimTemplateService } from "./claim-template-service.js";

/**
 * Configuring what a project's access tokens carry (PROJECT.md 4.2).
 *
 * Secret key only, and the project is the one the key names: a template decides what
 * every token for that project says, so a publishable key sitting in a browser bundle
 * must not be able to change it.
 *
 * `PUT` and not `PATCH`, because a template is saved whole. The byte budget is on the
 * total, and a partial update is a save whose effect depends on what somebody else stored
 * first.
 */
@Controller("v1/claim-template")
export class ClaimTemplateController {
  constructor(private readonly templates: ClaimTemplateService) {}

  @Get()
  @RequireSecretKey()
  read(@Req() request: FastifyRequest): Promise<SavedClaimTemplate> {
    return this.templates.read(tenantContextFrom(flowContextFrom(request)));
  }

  @Put()
  @RequireSecretKey()
  @HttpCode(200)
  save(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(claimTemplateSchema)) body: ClaimTemplateInput,
  ): Promise<SavedClaimTemplate> {
    return this.templates.save(tenantContextFrom(flowContextFrom(request)), body);
  }
}
