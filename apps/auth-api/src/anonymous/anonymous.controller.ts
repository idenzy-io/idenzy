import { MissingCredentialsError } from "@idenzy/core/errors/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { IssuedSession } from "@idenzy/domain/ports/auth-flow";
import { type UpgradeAnonymous, upgradeAnonymousSchema } from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionCreated } from "@idenzy/protocol/schemas/session";
import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { AnonymousFlow } from "./anonymous.flow.js";
import { AnonymousUpgradeFlow } from "./anonymous-upgrade.flow.js";

/**
 * Anonymous accounts and their upgrade (PROJECT.md 3.1).
 *
 * Both routes answer with a session, because both end in one. The upgrade returns a new
 * session rather than reusing the caller's, so the amr claim stops saying `anon` for an
 * account that now has a password.
 */
@Controller("v1/auth/anonymous")
export class AnonymousController {
  constructor(
    private readonly flow: AnonymousFlow,
    private readonly upgradeFlow: AnonymousUpgradeFlow,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Req() request: FastifyRequest): Promise<SessionCreated> {
    return present(await this.flow.authenticate(flowContextFrom(request), {}));
  }

  @Post("upgrade")
  @RequireSession()
  @HttpCode(200)
  async upgrade(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(upgradeAnonymousSchema)) body: UpgradeAnonymous,
  ): Promise<SessionCreated> {
    // Spread first, userId last: a body carrying its own userId is overwritten rather
    // than trusted, so this route cannot be used to attach credentials to a stranger.
    const credentials = { ...body, userId: principalOf(request).userId };
    return present(await this.upgradeFlow.authenticate(flowContextFrom(request), credentials));
  }
}

function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
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
