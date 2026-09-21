import { MissingCredentialsError } from "@idenzy/core/errors";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { Controller, Get, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { ProfileService } from "./profile-service.js";

/** The signed-in user, as themselves. Always the principal, never a path parameter. */
@Controller("v1/users/me")
export class MeController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @RequireSession()
  me(@Req() request: FastifyRequest): Promise<PublicUser> {
    return this.profile.me(flowContextFrom(request), principalOf(request).userId);
  }
}

/** The guard populates this. Its absence means the route was mounted without it. */
function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}
