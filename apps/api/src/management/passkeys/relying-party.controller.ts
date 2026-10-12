import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type RelyingPartyAnswer,
  type SaveRelyingParty,
  saveRelyingPartySchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { RelyingPartyService } from "./relying-party-service.js";

/**
 * The project's passkey relying party: the domain its passkeys belong to, the name an
 * authenticator shows, and the exact origins a ceremony may run on, Android apps included.
 *
 * Admin, like the OAuth return URIs: the origins are an allowlist, and the RP ID decides which
 * credentials an assertion may address at all.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/passkeys/relying-party")
export class RelyingPartyController {
  constructor(private readonly parties: RelyingPartyService) {}

  @Get()
  @RequireRole(MemberRole.Admin)
  async find(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<RelyingPartyAnswer> {
    return await this.parties.find(orgContextFrom(request), projectId);
  }

  @Put()
  @RequireRole(MemberRole.Admin)
  async save(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(saveRelyingPartySchema)) body: SaveRelyingParty,
  ): Promise<RelyingPartyAnswer> {
    return await this.parties.save(orgContextFrom(request), projectId, body);
  }
}
