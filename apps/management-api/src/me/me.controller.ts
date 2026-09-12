import type { Me } from "@idenzy/protocol/schemas/management";
import { Controller, Get, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { principalOf } from "../tenancy/dashboard-principal.js";
import { RequireSignIn } from "../tenancy/membership.guard.js";
import { MeService } from "./me-service.js";

/**
 * The first call the panel makes after a session appears.
 *
 * `RequireSignIn` and not `RequireRole`: this is the call that tells the caller which
 * organisations they are in, so there is no organisation bound yet to hold a role in. The
 * subject is the user id from the verified token and nothing from the request, which is
 * what makes it safe to answer without one.
 */
@Controller("v1/me")
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @RequireSignIn()
  async load(@Req() request: FastifyRequest): Promise<Me> {
    const principal = principalOf(request);
    return await this.me.load(principal.userId, String(request.id));
  }
}
