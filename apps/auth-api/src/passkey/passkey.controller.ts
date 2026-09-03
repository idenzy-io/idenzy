import { MissingCredentialsError } from "@idenzy/core/errors";
import type { AuthOutcome as AuthOutcomeBody } from "@idenzy/protocol/schemas/mfa";
import {
  type FinishPasskeyAuthentication,
  type FinishPasskeyRegistration,
  finishPasskeyAuthenticationSchema,
  finishPasskeyRegistrationSchema,
  type Passkey,
  type PasskeyAuthenticationOptions,
  type PasskeyRegistrationOptions,
} from "@idenzy/protocol/schemas/webauthn";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { presentOutcome } from "../flows/present-outcome.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { PasskeyFlow } from "./passkey.flow.js";
import { PasskeyService } from "./passkey-service.js";

/**
 * The two WebAuthn ceremonies (PROJECT.md 4.7).
 *
 * Both are a pair of JSON endpoints and nothing else. The `publicKey` object goes
 * straight into `navigator.credentials`, the browser renders the platform prompt, and
 * the result comes back here: the only interface the user sees belongs to their
 * operating system, which is the strongest form of the position in PROJECT.md 1.1.
 *
 * Registration needs a session and authentication does not, which is the whole
 * asymmetry. Enrolling a credential is an action on an account that already exists;
 * asserting one is how an account is reached in the first place.
 */
@Controller("v1/auth/passkeys")
export class PasskeyController {
  constructor(
    private readonly service: PasskeyService,
    private readonly flow: PasskeyFlow,
  ) {}

  @Post("registration/options")
  @RequireSession()
  @HttpCode(200)
  startRegistration(@Req() request: FastifyRequest): Promise<PasskeyRegistrationOptions> {
    return this.service.startRegistration(flowContextFrom(request), principalOf(request).userId);
  }

  @Post("registration")
  @RequireSession()
  @HttpCode(201)
  finishRegistration(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(finishPasskeyRegistrationSchema)) body: FinishPasskeyRegistration,
  ): Promise<Passkey> {
    return this.service.finishRegistration(
      flowContextFrom(request),
      principalOf(request).userId,
      body,
    );
  }

  /**
   * Takes no identifier and needs no session, so it is the same request for everybody.
   * That is what makes it safe to leave open: there is no answer here that differs for
   * an account with passkeys and one without (PROJECT.md 4.7).
   */
  @Post("authentication/options")
  @HttpCode(200)
  startAuthentication(@Req() request: FastifyRequest): Promise<PasskeyAuthenticationOptions> {
    return this.service.startAuthentication(flowContextFrom(request));
  }

  @Post("authentication")
  @HttpCode(200)
  async finishAuthentication(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(finishPasskeyAuthenticationSchema))
    body: FinishPasskeyAuthentication,
  ): Promise<AuthOutcomeBody> {
    const issued = await this.flow.authenticate(flowContextFrom(request), body);
    return presentOutcome(issued);
  }
}

/** The guard populates this. Its absence means the route was mounted without it. */
function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}
