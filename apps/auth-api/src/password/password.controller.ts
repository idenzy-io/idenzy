import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { IssuedSession } from "@idenzy/domain/ports/auth-flow";
import {
  type SignInWithPassword,
  type SignUpWithPassword,
  signInWithPasswordSchema,
  signUpWithPasswordSchema,
} from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionCreated } from "@idenzy/protocol/schemas/session";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
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
  ) {}

  @Post("sign-up/password")
  @HttpCode(201)
  async signUp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(signUpWithPasswordSchema)) body: SignUpWithPassword,
  ): Promise<SessionCreated> {
    const context = flowContextFrom(request);
    return present(await this.signUpFlow.authenticate(context, body));
  }

  @Post("sign-in/password")
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(signInWithPasswordSchema)) body: SignInWithPassword,
  ): Promise<SessionCreated> {
    const context = flowContextFrom(request);
    return present(await this.signInFlow.authenticate(context, body));
  }
}

/** Pure mapping. The user comes from the same transaction that created the session. */
function present(issued: IssuedSession): SessionCreated {
  return {
    user: issued.user.toPublic(),
    sessionId: PublicId.encode(IdPrefix.Session, issued.sessionId).value,
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    refreshToken: issued.refreshToken,
  };
}
