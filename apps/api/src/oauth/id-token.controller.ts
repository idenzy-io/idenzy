import {
  type ExchangeIdToken,
  exchangeIdTokenSchema,
  type IdTokenNonce,
} from "@idenzy/protocol/schemas/auth";
import type { AuthOutcome as AuthOutcomeBody } from "@idenzy/protocol/schemas/mfa";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { ID_TOKEN_LIMITS } from "../throttling/limits.js";
import { RateLimit } from "../throttling/rate-limit.decorator.js";
import { IdTokenFlow } from "./id-token.flow.js";
import { IdTokenNonceService } from "./id-token-nonce-service.js";

/**
 * Native Sign in with Apple and Google (PROJECT.md 4.4): a nonce out, an ID token in.
 *
 * Two JSON routes and no redirect, which is why this works on the shared API host without a
 * custom auth domain: an app calls both with its publishable key like any other request.
 */
@Controller("v1/auth/id-token")
export class IdTokenController {
  constructor(
    private readonly nonces: IdTokenNonceService,
    private readonly flow: IdTokenFlow,
  ) {}

  @Post("nonce")
  @RateLimit(ID_TOKEN_LIMITS)
  @HttpCode(200)
  nonce(@Req() request: FastifyRequest): Promise<IdTokenNonce> {
    return this.nonces.issue(flowContextFrom(request));
  }

  @Post()
  @RateLimit(ID_TOKEN_LIMITS)
  @HttpCode(200)
  async exchange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(exchangeIdTokenSchema)) body: ExchangeIdToken,
  ): Promise<AuthOutcomeBody> {
    return presentOutcome(await this.flow.authenticate(flowContextFrom(request), body));
  }
}
