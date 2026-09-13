import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type CreatedWebhook,
  type CreateWebhook,
  createWebhookSchema,
  type RotatedWebhookSecret,
  type UpdateWebhook,
  updateWebhookSchema,
  type WebhookDeliveryList,
  type WebhookDeliveryQuery,
  type WebhookEndpoint,
  type WebhookEndpointList,
  type WebhookStats,
  type WebhookStatsQuery,
  webhookDeliveryQuerySchema,
  webhookStatsQuerySchema,
} from "@idenzy/protocol/schemas/management";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { WebhooksService } from "./webhooks-service.js";

/**
 * A project's webhook endpoints and what their deliveries did.
 *
 * Every route takes a developer, reading included, and that is the panel's own role matrix rather
 * than a choice made here: webhooks sit beside API keys on it, and for the same reason — an endpoint
 * receives your users' events, so registering one is handing a copy of them to a URL. A viewer
 * reading a list of URLs would be harmless on its own, but a capability described to customers as
 * stopping at developer has to actually stop there.
 *
 * Two things a reader might look for are deliberately absent. There is no route that answers with a
 * signing secret: the two that mint one return it, and nothing afterwards does. And there is no
 * test-event or retry route, because no worker consumes the webhook topic yet — either would write a
 * delivery that nothing sends, and the screen already says both are unavailable rather than
 * pretending. They arrive with the dispatcher.
 *
 * The project is in the path and is never trusted from it. `WebhooksService` resolves it through
 * `ProjectScope`, which refuses a project the caller's organisation does not own.
 */
@Controller("v1/orgs/:orgId/projects/:projectId/webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @RequireRole(MemberRole.Developer)
  async list(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
  ): Promise<WebhookEndpointList> {
    return { endpoints: await this.webhooks.list(orgContextFrom(request), projectId) };
  }

  /**
   * 201 with the signing secret in the body, once.
   *
   * The second response in this API that carries a credential, and the field is called `secret` for
   * the same reason the API key's is: an object with that key in a log or a screenshot reads as
   * something that should not have been kept.
   */
  @Post()
  @HttpCode(201)
  @RequireRole(MemberRole.Developer)
  async create(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createWebhookSchema)) body: CreateWebhook,
  ): Promise<CreatedWebhook> {
    return await this.webhooks.create(orgContextFrom(request), projectId, body);
  }

  /**
   * The daily counters, project-wide, for the figures on the screen.
   *
   * Before the `:webhookId` routes below it, because a path segment is matched in the order the
   * routes are declared and `stats` would otherwise be read as an endpoint id.
   */
  @Get("stats")
  @RequireRole(MemberRole.Developer)
  async stats(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Query(new ZodValidationPipe(webhookStatsQuerySchema)) query: WebhookStatsQuery,
  ): Promise<WebhookStats> {
    const since = query.since ?? WebhooksService.defaultStatsSince(new Date());
    return { days: await this.webhooks.stats(orgContextFrom(request), projectId, since) };
  }

  @Patch(":webhookId")
  @RequireRole(MemberRole.Developer)
  async update(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: UpdateWebhook,
  ): Promise<WebhookEndpoint> {
    return await this.webhooks.update(orgContextFrom(request), projectId, webhookId, body);
  }

  /**
   * Pausing and resuming are two routes rather than a boolean on the edit above.
   *
   * `enabled` alone could not say why an endpoint is off, and the difference is the whole of what
   * the screen has to show: a person's pause and the breaker's switch-off after twenty failures
   * call for entirely different next steps.
   */
  @Post(":webhookId/pause")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async pause(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
  ): Promise<WebhookEndpoint> {
    return await this.webhooks.pause(orgContextFrom(request), projectId, webhookId);
  }

  @Post(":webhookId/resume")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async resume(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
  ): Promise<WebhookEndpoint> {
    return await this.webhooks.resume(orgContextFrom(request), projectId, webhookId);
  }

  /** A new secret, and the deadline the old one stops signing at. */
  @Post(":webhookId/rotate-secret")
  @HttpCode(200)
  @RequireRole(MemberRole.Developer)
  async rotateSecret(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
  ): Promise<RotatedWebhookSecret> {
    return await this.webhooks.rotateSecret(orgContextFrom(request), projectId, webhookId);
  }

  @Delete(":webhookId")
  @HttpCode(204)
  @RequireRole(MemberRole.Developer)
  async remove(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
  ): Promise<void> {
    await this.webhooks.remove(orgContextFrom(request), projectId, webhookId);
  }

  /**
   * One endpoint's recent deliveries, newest first.
   *
   * Empty until the pipeline runs, which is the honest answer rather than an error: the endpoint
   * exists and has no deliveries because nothing has sent any.
   */
  @Get(":webhookId/deliveries")
  @RequireRole(MemberRole.Developer)
  async deliveries(
    @Req() request: FastifyRequest,
    @Param("projectId") projectId: string,
    @Param("webhookId") webhookId: string,
    @Query(new ZodValidationPipe(webhookDeliveryQuerySchema)) query: WebhookDeliveryQuery,
  ): Promise<WebhookDeliveryList> {
    return {
      deliveries: await this.webhooks.deliveries(
        orgContextFrom(request),
        projectId,
        webhookId,
        query.limit,
      ),
    };
  }
}
