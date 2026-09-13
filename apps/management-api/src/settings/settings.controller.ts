import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type PatchProjectSettings,
  type ProjectSettings,
  patchProjectSettingsSchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Param, Patch, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { SettingsService } from "./settings-service.js";

/**
 * A project's authentication settings.
 *
 * Reading is a viewer's, writing an admin's. The split is wider than the users routes',
 * and deliberately: a developer needs to see how sign-in is configured to integrate
 * against it, while turning password sign-in off is a change to how every one of the
 * customer's own customers gets in. `members.ts` puts "how people sign in" at owner and
 * admin.
 *
 * PATCH rather than PUT: a screen owns one section and sends that section, and a PUT would
 * make every form responsible for round-tripping the parts of the document it does not
 * show — which is how one screen's save silently reverts another's.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async read(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<ProjectSettings> {
    return await this.settings.read(orgContextFrom(request), projectId);
  }

  @Patch()
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async patch(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(patchProjectSettingsSchema)) body: PatchProjectSettings,
  ): Promise<ProjectSettings> {
    return await this.settings.patch(orgContextFrom(request), projectId, body);
  }
}
