import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type AddProjectDomain,
  addProjectDomainSchema,
  type ProjectDomain,
  type ProjectDomainList,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { DomainsService } from "./domains-service.js";

/**
 * A project's custom auth domains.
 *
 * Admin rather than developer, unlike API keys. A domain decides where a customer's users
 * are sent to sign in, so a wrong or hostile one is a phishing surface rather than a
 * misconfiguration — that belongs with the people who can also change the team.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/domains")
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<ProjectDomainList> {
    return { domains: await this.domains.list(orgContextFrom(request), projectId) };
  }

  @Post()
  @HttpCode(201)
  @RequireRole(MemberRole.Admin)
  async add(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(addProjectDomainSchema)) body: AddProjectDomain,
  ): Promise<ProjectDomain> {
    return await this.domains.add(orgContextFrom(request), projectId, body.domain);
  }

  /**
   * Runs the DNS check now.
   *
   * A POST because it writes what it found, and available to a developer because pressing
   * it changes nothing a reader could get wrong: it looks up records the customer already
   * published and writes down the answer.
   */
  @Post(":domainId/verify")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async verify(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("domainId") domainId: string,
  ): Promise<ProjectDomain> {
    return await this.domains.verify(orgContextFrom(request), projectId, domainId);
  }

  @Delete(":domainId")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async remove(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("domainId") domainId: string,
  ): Promise<void> {
    await this.domains.remove(orgContextFrom(request), projectId, domainId);
  }
}
