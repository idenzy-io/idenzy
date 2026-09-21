import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type AddRedirectUri,
  addRedirectUriSchema,
  type OauthProviderConfig,
  type OauthProviderList,
  type RedirectUriList,
  type SaveOauthProvider,
  saveOauthProviderSchema,
} from "@idenzy/protocol/schemas/management";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { ProvidersService } from "./providers-service.js";

/**
 * A project's social providers, and where a completed flow may return the browser.
 *
 * Admin throughout. A provider's client secret is a credential the customer obtained from
 * Google or Apple and handed us, and the return URIs are an exact-match allowlist that is
 * the only thing standing between an OAuth callback and an open redirect (PROJECT.md 4.6) —
 * neither belongs at the level that reads configuration to integrate against it.
 *
 * The URI is a query parameter on the delete rather than a path segment, because it is a
 * URL: percent-encoding one into a path is legal and is also how a proxy or a router
 * normalises a slash back out and deletes something adjacent.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/oauth-providers")
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @RequireRole(MemberRole.Admin)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<OauthProviderList> {
    return { providers: [...(await this.providers.list(orgContextFrom(request), projectId))] };
  }

  @Get("return-uris")
  @RequireRole(MemberRole.Admin)
  async returnUris(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<RedirectUriList> {
    return { uris: [...(await this.providers.returnUris(orgContextFrom(request), projectId))] };
  }

  @Post("return-uris")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async addReturnUri(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(addRedirectUriSchema)) body: AddRedirectUri,
  ): Promise<void> {
    await this.providers.addReturnUri(orgContextFrom(request), projectId, body.uri);
  }

  @Delete("return-uris")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async removeReturnUri(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query("uri") uri: string,
  ): Promise<void> {
    await this.providers.removeReturnUri(orgContextFrom(request), projectId, uri);
  }

  /** PUT: the whole configuration for one provider, created if it is not there. */
  @Put(":provider")
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async save(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("provider") provider: string,
    @Body(new ZodValidationPipe(saveOauthProviderSchema)) body: SaveOauthProvider,
  ): Promise<OauthProviderConfig> {
    return await this.providers.save(orgContextFrom(request), projectId, provider, body);
  }

  /** Removes the configuration. Accounts already linked through it keep their identity. */
  @Delete(":provider")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async remove(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("provider") provider: string,
  ): Promise<void> {
    await this.providers.remove(orgContextFrom(request), projectId, provider);
  }
}
