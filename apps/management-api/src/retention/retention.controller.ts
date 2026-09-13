import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type RetentionPolicy,
  type RetentionPolicyList,
  type SetRetentionPolicy,
  setRetentionPolicySchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Param, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { RetentionService } from "./retention-service.js";

/**
 * How long a project keeps each kind of data, and what happens when it stops.
 *
 * Reading is a viewer's: an auditor being shown around is exactly who asks this, and the
 * answer is about the customer's own obligations rather than about our configuration.
 * Writing is an admin's, alongside the other settings, because shortening an age destroys
 * data on a schedule and lengthening one takes on a liability.
 *
 * `PUT` on one subject rather than `PATCH` on the set. The screen edits a menu at a time and
 * each age is independent, so a whole-document write would make every save responsible for
 * round-tripping four ages it was not asked about — and the subject is in the body rather
 * than the path because a caller sending an unknown one deserves a refusal that says which
 * field was wrong, not a 404 about a route.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/retention")
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<RetentionPolicyList> {
    return { policies: [...(await this.retention.list(orgContextFrom(request), projectId))] };
  }

  @Put()
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async set(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(setRetentionPolicySchema)) body: SetRetentionPolicy,
  ): Promise<RetentionPolicy> {
    return await this.retention.set(orgContextFrom(request), projectId, body.subject, body.maxAge);
  }
}
