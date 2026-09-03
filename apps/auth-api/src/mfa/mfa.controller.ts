import { MissingCredentialsError } from "@idenzy/core/errors";
import {
  type AuthOutcome as AuthOutcomeBody,
  type ConfirmTotpEnrolment,
  confirmTotpEnrolmentSchema,
  type MfaEnrolmentConfirmed,
  type MfaFactorList,
  type RecoveryCodes,
  type StartTotpEnrolment,
  type SubmitMfa,
  startTotpEnrolmentSchema,
  submitMfaSchema,
  type TotpEnrolment,
} from "@idenzy/protocol/schemas/mfa";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { MfaEnrolmentService } from "./mfa-enrolment-service.js";
import { MfaVerificationFlow } from "./mfa-verification.flow.js";

/**
 * Managing your own second factors (PROJECT.md 4.5).
 *
 * Every route here takes a session, because every one of them is an action on the
 * caller's own account and nothing is addressed by anything but the principal. A factor
 * id in a path is scoped to that principal in the repository as well, so a valid session
 * cannot reach a stranger's factor by guessing one.
 *
 * The enrolment reply carries an `otpauth://` URI and the secret, and no image. Turning
 * that into a QR code is the customer's, with their own library, for the same reason we
 * ship no sign-in screen (ADR-0002).
 */
@Controller("v1/auth/mfa")
export class MfaController {
  constructor(
    private readonly enrolment: MfaEnrolmentService,
    private readonly verification: MfaVerificationFlow,
  ) {}

  /**
   * Answers the challenge a sign-in stopped at.
   *
   * Deliberately the one route here that takes no session. The caller has proved a first
   * factor and holds a challenge id, which is what stands in for one: requiring a session
   * would mean issuing one before the second factor, which is the whole thing this
   * endpoint exists to prevent.
   */
  @Post("verify")
  @HttpCode(200)
  async verify(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(submitMfaSchema)) body: SubmitMfa,
  ): Promise<AuthOutcomeBody> {
    return presentOutcome(await this.verification.authenticate(flowContextFrom(request), body));
  }

  @Get("factors")
  @RequireSession()
  list(@Req() request: FastifyRequest): Promise<MfaFactorList> {
    return this.enrolment.list(flowContextFrom(request), principalOf(request).userId);
  }

  @Post("totp")
  @RequireSession()
  @HttpCode(201)
  startTotp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(startTotpEnrolmentSchema)) body: StartTotpEnrolment,
  ): Promise<TotpEnrolment> {
    return this.enrolment.startTotp(
      flowContextFrom(request),
      principalOf(request).userId,
      body.label ?? null,
    );
  }

  @Post("totp/confirm")
  @RequireSession()
  @HttpCode(200)
  confirmTotp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(confirmTotpEnrolmentSchema)) body: ConfirmTotpEnrolment,
  ): Promise<MfaEnrolmentConfirmed> {
    return this.enrolment.confirmTotp(
      flowContextFrom(request),
      principalOf(request).userId,
      body.factorId,
      body.code,
    );
  }

  @Post("recovery-codes")
  @RequireSession()
  @HttpCode(200)
  regenerate(@Req() request: FastifyRequest): Promise<RecoveryCodes> {
    return this.enrolment.regenerateRecoveryCodes(
      flowContextFrom(request),
      principalOf(request).userId,
    );
  }

  @Delete("factors/:factorId")
  @RequireSession()
  @HttpCode(204)
  remove(@Req() request: FastifyRequest, @Param("factorId") factorId: string): Promise<void> {
    return this.enrolment.remove(flowContextFrom(request), principalOf(request).userId, factorId);
  }
}

/** The guard has already run on these routes, so a missing principal is our bug. */
function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}
