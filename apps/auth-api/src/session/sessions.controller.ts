import { MissingCredentialsError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionList } from "@idenzy/protocol/schemas/session";
import { Controller, Delete, Get, HttpCode, Param, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { RequireSession, type SessionPrincipal } from "./session.guard.js";
import { SessionService } from "./session-service.js";

/**
 * The signed-in user's own sessions, which is what a customer builds a "your devices"
 * screen from. Everything here is scoped to the principal, never to a path parameter.
 */
@Controller("v1/sessions")
export class SessionsController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @RequireSession()
  list(@Req() request: FastifyRequest): Promise<SessionList> {
    return this.sessions.listSessions(flowContextFrom(request), principalOf(request));
  }

  @Delete(":id")
  @RequireSession()
  @HttpCode(204)
  async revoke(@Req() request: FastifyRequest, @Param("id") id: string): Promise<void> {
    // Parsed here so a malformed id is a validation failure rather than a query for a
    // session that cannot exist.
    const sessionId = PublicId.parse(IdPrefix.Session, id).uuid;
    await this.sessions.revokeSession(flowContextFrom(request), principalOf(request), sessionId);
  }
}

/** The guard populates this. Its absence means the route was mounted without it. */
function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}
