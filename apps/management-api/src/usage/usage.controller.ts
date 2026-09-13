import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ProjectUsage,
  type ProjectUsageHours,
  type UsagePeriodList,
  type UsagePeriodQuery,
  type UsageQuery,
  usagePeriodQuerySchema,
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

  /**
   * The period selector's list, and the authority for what a period cost.
   *
   * Before the bare `@Get()` below is irrelevant here — they are different paths — but the split
   * is not cosmetic: a window of days cannot answer what a month cost once that month is closed
   * and its sketches are gone, so the two questions are two routes rather than one response with
   * a field that is only sometimes true.
   */
  @Get("periods")
  @RequireRole(MemberRole.Viewer)
  async periods(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(usagePeriodQuerySchema)) query: UsagePeriodQuery,
  ): Promise<UsagePeriodList> {
    const periods = await this.usage.periods(
      orgContextFrom(request),
      projectId,
      UsageService.periodCountOf(query.limit),
    );
    return { periods };
  }

  /**
   * The hourly series, which is a third route rather than a `granularity` flag on the one below.
   *
   * The two answer different shapes and carry different promises. A day has a distinct count of
   * its own; an hour has only a level, because storing a sketch per hour is seventy megabytes a
   * project over the six months these are kept. One response that sometimes has a field and
   * sometimes does not would make that a runtime surprise instead of a type.
   */
  @Get("hours")
  @RequireRole(MemberRole.Viewer)
  async hours(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(usageQuerySchema)) query: UsageQuery,
  ): Promise<ProjectUsageHours> {
    const window = UsageService.hourWindowOf(query, new Date());
    return await this.usage.hoursFor(orgContextFrom(request), projectId, window);
  }

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
