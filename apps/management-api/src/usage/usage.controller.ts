import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ProjectUsage,
  type UsageQuery,
  usageQuerySchema,
} from "@idenzy/protocol/schemas/management";
import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { UsageService } from "./usage-service.js";

/**
 * A project's metered usage, which is what the bill is made of.
 *
 * A viewer reads it, unlike the webhook counters next door at developer. The difference is what
 * the figure is for: an endpoint's delivery rate is sign-in configuration somebody diagnoses,
 * and this is money. Anybody trusted to see a project at all has to be able to answer "what are
 * we spending", and the answer names no user and carries no secret — a count of people and a
 * count of messages, which is exactly what a sketch is able to say and no more.
 *
 * The window defaults to the calendar month in progress rather than to a rolling thirty days,
 * because the free tier and the invoice both reset on the 1st and a screen showing anything else
 * would disagree with the bill.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async read(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery,
  ): Promise<ProjectUsage> {
    const window = UsageService.windowOf(query, new Date());
    return await this.usage.forProject(orgContextFrom(request), projectId, window);
  }
}
