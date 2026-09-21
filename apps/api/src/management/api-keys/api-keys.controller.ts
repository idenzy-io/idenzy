import { ApiKeyKind, MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type ApiKeyList,
  type ApiKeySummary,
  type CreateApiKey,
  type CreatedApiKey,
  createApiKeySchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { ApiKeysService } from "./api-keys-service.js";

/**
 * A project's API keys.
 *
 * Every route takes a developer, reading included, and that is the panel's own role matrix
 * rather than a choice made here: "creating a secret key hands over whatever the management
 * API allows, which is why this is the line the roles below it stop at". A viewer reading
 * prefixes would be harmless on its own, but a capability that is described to customers as
 * stopping at developer has to actually stop there.
 *
 * The project is in the path and is never trusted from it. `ApiKeysService` resolves it
 * through `ProjectScope`, which refuses a project the caller's organisation does not own.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/api-keys")
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @RequireRole(MemberRole.Developer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<ApiKeyList> {
    return { keys: await this.keys.list(orgContextFrom(request), projectId) };
  }

  /**
   * 201 with the key in the body, once.
   *
   * The only response in this API that carries a credential, which is why the field is
   * called `secret`: an object with that key in a log or a screenshot reads as something
   * that should not have been kept.
   */
  @Post()
  @HttpCode(201)
  @RequireRole(MemberRole.Developer)
  async create(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKey,
  ): Promise<CreatedApiKey> {
    return await this.keys.create(orgContextFrom(request), projectId, body.kind as ApiKeyKind);
  }

  /** A POST and not a DELETE: the row stays, and `revoked_at` is what changes. */
  @Post(":keyId/revoke")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async revoke(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("keyId") keyId: string,
  ): Promise<ApiKeySummary> {
    return await this.keys.revoke(orgContextFrom(request), projectId, keyId);
  }
}
