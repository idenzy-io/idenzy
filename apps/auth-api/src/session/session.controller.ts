import { MissingCredentialsError } from "@idenzy/core/errors/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { IssuedSession } from "@idenzy/domain/ports/auth-flow";
import {
  type RefreshSession,
  refreshSessionSchema,
  type SignOut,
  signOutSchema,
} from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionRefreshed } from "@idenzy/protocol/schemas/session";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { RefreshService } from "./refresh-service.js";
import { SessionService } from "./session-service.js";

/**
 * Session lifecycle endpoints.
 *
 * The refresh token arrives in the body here, which is the documented Authorization
 * header mode for mobile, server and cross-origin clients (PROJECT.md 4.3). The web
 * first-party cookie mode is a separate concern that applies to every endpoint that
 * returns a session, so it is added once rather than per route.
 */
@Controller("v1/auth")
export class SessionController {
  constructor(
    private readonly refresh: RefreshService,
    private readonly sessions: SessionService,
  ) {}

  @Post("refresh")
  @HttpCode(200)
  async rotate(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(refreshSessionSchema)) body: RefreshSession,
  ): Promise<SessionRefreshed> {
    const context = flowContextFrom(request);
    const issued = await this.refresh.rotate(context, presentedToken(body.refreshToken));
    return toRefreshed(issued);
  }

  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(signOutSchema.extend(refreshSessionSchema.shape)))
    body: SignOut & RefreshSession,
  ): Promise<void> {
    const context = flowContextFrom(request);
    await this.sessions.signOut(context, presentedToken(body.refreshToken), body.scope);
  }
}

/** Until cookie mode exists, a client that presents nothing is missing credentials. */
function presentedToken(token: string | undefined): string {
  if (token === undefined) throw new MissingCredentialsError();
  return token;
}

function toRefreshed(issued: IssuedSession): SessionRefreshed {
  return {
    sessionId: PublicId.encode(IdPrefix.Session, issued.sessionId).value,
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    refreshToken: issued.refreshToken,
  };
}
