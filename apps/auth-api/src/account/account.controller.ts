import { MissingCredentialsError } from "@idenzy/core/errors";
import {
  type ConfirmEmailChange,
  type ConfirmEmailVerification,
  confirmEmailChangeSchema,
  confirmEmailVerificationSchema,
  type EmailChangeConfirmed,
  type RequestEmailChange,
  requestEmailChangeSchema,
} from "@idenzy/protocol/schemas/auth";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { StepUpService } from "../mfa/step-up-service.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { SEND_MESSAGE_LIMITS, VERIFY_CODE_LIMITS } from "../throttling/limits.js";
import { RateLimit } from "../throttling/rate-limit.decorator.js";
import { EmailChangeService } from "./email-change-service.js";
import { EmailVerificationService } from "./email-verification-service.js";

/**
 * The signed-in user's own address (PROJECT.md 4.5).
 *
 * Requesting takes a session because it is an action on your own account. Confirming
 * does not, because the link is usually opened in a different browser from the one that
 * asked for it, and demanding a session there would break the flow for the majority of
 * users to protect a token that is already single use and short lived.
 */
@Controller("v1/users/me/email")
export class AccountController {
  constructor(
    private readonly verification: EmailVerificationService,
    private readonly changes: EmailChangeService,
    private readonly stepUp: StepUpService,
  ) {}

  @Post("verification")
  @RateLimit(SEND_MESSAGE_LIMITS)
  @RequireSession()
  @HttpCode(202)
  requestVerification(@Req() request: FastifyRequest): Promise<void> {
    return this.verification.request(flowContextFrom(request), principalOf(request).userId);
  }

  @Post("verification/confirm")
  @RateLimit(VERIFY_CODE_LIMITS)
  @HttpCode(204)
  confirmVerification(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(confirmEmailVerificationSchema)) body: ConfirmEmailVerification,
  ): Promise<void> {
    return this.verification.confirm(flowContextFrom(request), body.token);
  }

  /**
   * Moving the address needs a recently proved factor as well as a session
   * (PROJECT.md 4.5).
   *
   * This is the step-up §4.5 always asked for, and it is worth exactly as much as the
   * second factor behind it: a user who has enrolled none passes, because there is
   * nothing they could be asked for. What it closes is the case that matters, which is a
   * stolen session on an account whose owner did set one up.
   */
  @Post()
  @RateLimit(SEND_MESSAGE_LIMITS)
  @RequireSession()
  @HttpCode(202)
  async requestChange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(requestEmailChangeSchema)) body: RequestEmailChange,
  ): Promise<void> {
    const context = flowContextFrom(request);
    const principal = principalOf(request);
    await this.stepUp.assertRecent(context, principal);
    await this.changes.request(context, principal.userId, body.newEmail);
  }

  @Post("confirm")
  @RateLimit(VERIFY_CODE_LIMITS)
  @HttpCode(200)
  async confirmChange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(confirmEmailChangeSchema)) body: ConfirmEmailChange,
  ): Promise<EmailChangeConfirmed> {
    const applied = await this.changes.confirm(flowContextFrom(request), body.token);
    return { applied };
  }
}

/** The guard has already run on these routes, so a missing principal is our bug. */
function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}
