import {
  type ConfirmPasswordReset,
  confirmPasswordResetSchema,
  type RequestPasswordReset,
  requestPasswordResetSchema,
  type SignInWithPassword,
  type SignUpWithPassword,
  signInWithPasswordSchema,
  signUpWithPasswordSchema,
} from "@idenzy/protocol/schemas/auth";
import type { AuthOutcome as AuthOutcomeBody } from "@idenzy/protocol/schemas/mfa";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { PasswordResetService } from "./password-reset-service.js";
import { PasswordSignInFlow } from "./password-sign-in.flow.js";
import { PasswordSignUpFlow } from "./password-sign-up.flow.js";

/**
 * Email and password endpoints.
 *
 * The controller does nothing but translate (PROJECT.md 9.3 step 8): parse the body,
 * call the flow, shape the result. Both routes return the same body, because from a
 * client's point of view signing up and signing in differ only in which one succeeds.
 */
@Controller("v1/auth")
export class PasswordController {
  constructor(
    private readonly signUpFlow: PasswordSignUpFlow,
    private readonly signInFlow: PasswordSignInFlow,
    private readonly reset: PasswordResetService,
  ) {}

  @Post("sign-up/password")
  @HttpCode(201)
  async signUp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(signUpWithPasswordSchema)) body: SignUpWithPassword,
  ): Promise<AuthOutcomeBody> {
    const context = flowContextFrom(request);
    return presentOutcome(await this.signUpFlow.authenticate(context, body));
  }

  @Post("sign-in/password")
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(signInWithPasswordSchema)) body: SignInWithPassword,
  ): Promise<AuthOutcomeBody> {
    const context = flowContextFrom(request);
    return presentOutcome(await this.signInFlow.authenticate(context, body));
  }

  /**
   * Always 202, for an address we know and one we do not. A different answer here is the
   * classic way a reset form becomes an account enumeration oracle.
   */
  @Post("password/reset")
  @HttpCode(202)
  requestReset(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(requestPasswordResetSchema)) body: RequestPasswordReset,
  ): Promise<void> {
    return this.reset.request(flowContextFrom(request), body.email);
  }

  @Post("password/reset/confirm")
  @HttpCode(204)
  confirmReset(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(confirmPasswordResetSchema)) body: ConfirmPasswordReset,
  ): Promise<void> {
    return this.reset.confirm(flowContextFrom(request), body);
  }
}

/** Pure mapping. The user comes from the same transaction that created the session. */
