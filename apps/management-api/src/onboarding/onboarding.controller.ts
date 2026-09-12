import { RegionCellReader } from "@idenzy/persistence/repository/region-cell-reader";
import {
  type OnboardingResult,
  type RegionList,
  type StartOnboarding,
  startOnboardingSchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { principalOf } from "../tenancy/dashboard-principal.js";
import { RequireSignIn } from "../tenancy/membership.guard.js";
import { OnboardingService } from "./onboarding-service.js";

/**
 * Getting started, for a person who has an account and no organisation yet.
 *
 * The one surface that is authenticated but not organisation-scoped, and it has to be:
 * it is what creates the organisation everything else is scoped to. `RequireSignIn`
 * rather than `RequireRole`, because there is no membership to hold a role in yet.
 */
@Controller("v1")
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly regions: RegionCellReader,
  ) {}

  /**
   * Where a project may live.
   *
   * Signed in rather than public, because the list of stacks we run is not something a
   * stranger needs, and this is only ever read by somebody about to create a project.
   */
  @Get("regions")
  @RequireSignIn()
  async available(): Promise<RegionList> {
    const cells = await this.regions.active();
    return {
      regions: cells.map((cell) => ({
        code: cell.code,
        jurisdiction: cell.jurisdiction,
        endpoint: cell.endpoint,
      })),
    };
  }

  /** Whether this account still has to go through it. What the panel routes on. */
  @Get("onboarding")
  @RequireSignIn()
  async status(@Req() request: FastifyRequest): Promise<{ required: boolean }> {
    const principal = principalOf(request);
    return { required: await this.onboarding.isRequired(principal.userId) };
  }

  @Post("onboarding")
  @HttpCode(201)
  @RequireSignIn()
  async start(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(startOnboardingSchema)) body: StartOnboarding,
  ): Promise<OnboardingResult> {
    const principal = principalOf(request);
    return await this.onboarding.start(principal.userId, principal.displayName, body);
  }
}
