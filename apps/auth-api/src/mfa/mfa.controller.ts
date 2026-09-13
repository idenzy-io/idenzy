import { MissingCredentialsError } from "@idenzy/core/errors";
import { MfaChallengePurpose } from "@idenzy/protocol/enums/auth";
import {
  type AuthOutcome as AuthOutcomeBody,
  type ConfirmTotpEnrolment,
  confirmTotpEnrolmentSchema,
  type MfaChallenge,
  type MfaEnrolmentConfirmed,
  type MfaFactorList,
  type MfaPasskeyOptions,
  type MfaPasskeyOptionsRequest,
  mfaPasskeyOptionsRequestSchema,
  type RecoveryCodes,
  type StartTotpEnrolment,
  type StepUpCompleted,
  type SubmitMfa,
  startTotpEnrolmentSchema,
  submitMfaSchema,
  type TotpEnrolment,
} from "@idenzy/protocol/schemas/mfa";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { MFA_VERIFY_LIMITS } from "../throttling/limits.js";
import { RateLimit } from "../throttling/rate-limit.decorator.js";
import { MfaFactorRegistry } from "./factor-registry.js";
import { MfaChallengeVerifier } from "./mfa-challenge-verifier.js";
import { MfaEnrolmentService } from "./mfa-enrolment-service.js";
import { MfaVerificationFlow } from "./mfa-verification.flow.js";
import { StepUpService } from "./step-up-service.js";

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
    private readonly stepUp: StepUpService,
    private readonly challenges: MfaChallengeVerifier,
    private readonly factors: MfaFactorRegistry,
  ) {}

  /**
   * The WebAuthn options for answering a challenge with a passkey.
   *
   * Takes no session, like the verify route beside it, and for the same reason: the
   * challenge id is what stands in for one. It reads the challenge without spending it,
   * because asking for options is not an attempt and must not cost the user one of five.
   *
   * Accepts either purpose. All this call reads is which user the challenge names, and
   * both a sign-in and a step-up can legitimately be answered with a passkey.
   */
  @Post("passkey/options")
  @RateLimit(MFA_VERIFY_LIMITS)
  @HttpCode(200)
  async passkeyOptions(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(mfaPasskeyOptionsRequestSchema)) body: MfaPasskeyOptionsRequest,
  ): Promise<MfaPasskeyOptions> {
    const context = flowContextFrom(request);
    const challenge = await this.challenges.load(context, body.challengeId, [
      MfaChallengePurpose.SignIn,
      MfaChallengePurpose.StepUp,
    ]);
    return this.factors.passkeys.options(context, challenge.userId);
  }

  /**
   * Answers the challenge a sign-in stopped at.
   *
   * Deliberately the one route here that takes no session. The caller has proved a first
   * factor and holds a challenge id, which is what stands in for one: requiring a session
   * would mean issuing one before the second factor, which is the whole thing this
   * endpoint exists to prevent.
   */
  @Post("verify")
  @RateLimit(MFA_VERIFY_LIMITS)
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

  /**
   * Asks for a challenge in front of something sensitive (PROJECT.md 4.5).
   *
   * 204 rather than a challenge when the caller has no factor to be asked for. A client
   * that gets it should go ahead with the action: the same absence is what lets them
   * past the check on the other side.
   */
  @Post("step-up")
  @RequireSession()
  @HttpCode(200)
  async startStepUp(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MfaChallenge | null> {
    const context = flowContextFrom(request);
    const challenge = await this.stepUp.start(context, principalOf(request));
    if (challenge === null) {
      reply.status(204);
      return null;
    }
    return {
      challengeId: challenge.challengeId,
      purpose: challenge.purpose,
      factors: [...challenge.factors],
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  @Post("step-up/verify")
  @RequireSession()
  @HttpCode(200)
  completeStepUp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(submitMfaSchema)) body: SubmitMfa,
  ): Promise<StepUpCompleted> {
    return this.stepUp.complete(flowContextFrom(request), principalOf(request), body);
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
