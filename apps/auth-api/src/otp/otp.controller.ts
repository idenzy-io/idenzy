import { ValidationFailedError } from "@idenzy/core/errors/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { IssuedSession } from "@idenzy/domain/ports/auth-flow";
import { Channel } from "@idenzy/protocol/enums/delivery";
import {
  type ChallengeStarted,
  type StartOtp,
  startOtpSchema,
  type VerifyOtp,
  verifyOtpSchema,
} from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionCreated } from "@idenzy/protocol/schemas/session";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { EmailOtpFlow } from "./email-otp.flow.js";
import { EmailOtpService } from "./email-otp-service.js";

/**
 * One-time codes, the default passwordless path (PROJECT.md 4.7).
 *
 * Start answers 202 and a challenge id whatever the address turns out to be. Verify
 * answers with a session, and creates the account if the address did not have one, so
 * the customer's UI has a single passwordless entry point rather than a sign-in form and
 * a sign-up form that differ only in which error they show.
 */
@Controller("v1/auth/otp")
export class OtpController {
  constructor(
    private readonly service: EmailOtpService,
    private readonly flow: EmailOtpFlow,
  ) {}

  @Post("start")
  @HttpCode(202)
  start(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(startOtpSchema)) body: StartOtp,
  ): Promise<ChallengeStarted> {
    const email = body.email;
    if (body.channel !== Channel.Email || email === undefined) {
      // SMS and WhatsApp are phase 2 with the whole fraud control set behind them
      // (PROJECT.md 4.8). Refusing here is better than a route that half works.
      throw new ValidationFailedError({
        message: "Only the email channel is available.",
        fields: [{ path: "channel", code: "unsupported" }],
      });
    }
    return this.service.start(flowContextFrom(request), email);
  }

  @Post("verify")
  @HttpCode(200)
  async verify(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(verifyOtpSchema)) body: VerifyOtp,
  ): Promise<SessionCreated> {
    const issued = await this.flow.authenticate(flowContextFrom(request), body);
    return present(issued);
  }
}

function present(issued: IssuedSession): SessionCreated {
  return {
    user: issued.user.toPublic(),
    sessionId: PublicId.encode(IdPrefix.Session, issued.sessionId).value,
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    refreshToken: issued.refreshToken,
  };
}
