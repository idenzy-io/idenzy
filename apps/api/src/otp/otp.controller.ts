import { ValidationFailedError } from "@idenzy/core/errors";
import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import { Channel } from "@idenzy/protocol/enums/delivery";
import {
  type ChallengeStarted,
  type StartOtp,
  startOtpSchema,
  type VerifyOtp,
  verifyOtpSchema,
} from "@idenzy/protocol/schemas/auth";
import type { AuthOutcome as AuthOutcomeBody } from "@idenzy/protocol/schemas/mfa";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { SEND_MESSAGE_LIMITS, VERIFY_CODE_LIMITS } from "../throttling/limits.js";
import { RateLimit } from "../throttling/rate-limit.decorator.js";
import { EmailOtpService } from "./email-otp-service.js";
import { OtpVerification } from "./otp-verification.js";
import { SmsOtpService } from "./sms-otp-service.js";

/**
 * One-time codes, the default passwordless path (PROJECT.md 4.7).
 *
 * Start answers 202 and a challenge id whatever the target turns out to be. Verify
 * answers with a session, and creates the account if the target did not have one, so the
 * customer's UI has a single passwordless entry point rather than a sign-in form and a
 * sign-up form that differ only in which error they show.
 *
 * Verify takes no channel and does not need one: a challenge id names the row, and the
 * row already knows which channel carried it. Asking the client to say again is asking
 * it to be able to say something different.
 */
@Controller("v1/auth/otp")
export class OtpController {
  constructor(
    private readonly email: EmailOtpService,
    private readonly sms: SmsOtpService,
    private readonly verification: OtpVerification,
  ) {}

  @Post("start")
  @RateLimit(SEND_MESSAGE_LIMITS)
  @HttpCode(202)
  start(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(startOtpSchema)) body: StartOtp,
  ): Promise<ChallengeStarted> {
    const context = flowContextFrom(request);

    if (body.channel === Channel.Email && body.email !== undefined) {
      return this.email.start(context, body.email);
    }
    if (body.channel === Channel.Sms && body.phone !== undefined) {
      // Parsed here rather than trusted from the schema: the regex proves the shape and
      // the value object is what the rest of the path is typed against, so exactly one
      // form of a number reaches the fraud guard and the unique index.
      return this.sms.start(context, E164PhoneNumber.parse(body.phone));
    }

    // WhatsApp is the remaining channel in the enum. The Cloud API sends pre-approved
    // template messages rather than the free text this path renders, so it is a provider
    // and a template pipeline of its own rather than a branch here.
    throw new ValidationFailedError({
      message: "That channel is not available.",
      fields: [{ path: "channel", code: "unsupported" }],
    });
  }

  @Post("verify")
  @RateLimit(VERIFY_CODE_LIMITS)
  @HttpCode(200)
  async verify(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(verifyOtpSchema)) body: VerifyOtp,
  ): Promise<AuthOutcomeBody> {
    const issued = await this.verification.authenticate(flowContextFrom(request), body);
    return presentOutcome(issued);
  }
}
