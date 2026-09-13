import {
  type ChallengeStarted,
  type ExchangeCode,
  exchangeCodeSchema,
  magicLinkCallbackSchema,
  type StartMagicLink,
  startMagicLinkSchema,
} from "@idenzy/protocol/schemas/auth";
import type { AuthOutcome as AuthOutcomeBody } from "@idenzy/protocol/schemas/mfa";
import { Body, Controller, Get, HttpCode, Post, Query, Redirect, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { BrowserNavigation } from "../http/browser-navigation.decorator.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { SEND_MESSAGE_LIMITS, VERIFY_CODE_LIMITS } from "../throttling/limits.js";
import { RateLimit } from "../throttling/rate-limit.decorator.js";
import { MagicLinkFlow } from "./magic-link.flow.js";
import { MagicLinkService } from "./magic-link-service.js";

/**
 * Magic links (PROJECT.md 4.7).
 *
 * Three routes and a deliberate absence. Start mails the link, the callback redirects to
 * the customer's registered route with a single-use code, and exchange turns that code
 * into a session. The absence is the confirmation page: it belongs in the customer's
 * application, because only they can make it look like their product (PROJECT.md 1.1).
 */
@Controller("v1/auth/magic-link")
export class MagicLinkController {
  constructor(
    private readonly service: MagicLinkService,
    private readonly flow: MagicLinkFlow,
  ) {}

  @Post("start")
  @RateLimit(SEND_MESSAGE_LIMITS)
  @HttpCode(202)
  start(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(startMagicLinkSchema)) body: StartMagicLink,
  ): Promise<ChallengeStarted> {
    return this.service.start(flowContextFrom(request), body.email, body.redirectUri);
  }

  /**
   * The only GET in the auth surface that a browser reaches directly, and the only one
   * that answers with a redirect. It returns a Location and no body: an endpoint here
   * that rendered a page would be the thing PROJECT.md 4.3 has a test against.
   */
  @Get("callback")
  @RateLimit(VERIFY_CODE_LIMITS)
  @BrowserNavigation()
  @Redirect(undefined, 302)
  async callback(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(magicLinkCallbackSchema)) query: { token: string },
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.service.follow(flowContextFrom(request), query.token);
    return { url, statusCode: 302 };
  }

  @Post("exchange")
  @RateLimit(VERIFY_CODE_LIMITS)
  @HttpCode(200)
  async exchange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(exchangeCodeSchema)) body: ExchangeCode,
  ): Promise<AuthOutcomeBody> {
    const issued = await this.flow.authenticate(flowContextFrom(request), body);
    return presentOutcome(issued);
  }
}
