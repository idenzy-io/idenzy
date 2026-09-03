import { MissingCredentialsError } from "@idenzy/core/errors/errors";
import {
  type PasskeyList,
  type RenamePasskey,
  renamePasskeySchema,
} from "@idenzy/protocol/schemas/webauthn";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { PasskeyService } from "./passkey-service.js";

/**
 * The signed-in user's own passkeys.
 *
 * Removal matters more than it looks. A passkey is a credential on a device, devices are
 * lost, and a credential the owner cannot revoke is a permanent grant to whoever holds
 * the hardware. Everything here is scoped to the principal rather than to the path
 * parameter, so a stranger's id answers 404 (PROJECT.md 4.10).
 */
@Controller("v1/users/me/passkeys")
export class PasskeysController {
  constructor(private readonly service: PasskeyService) {}

  @Get()
  @RequireSession()
  async list(@Req() request: FastifyRequest): Promise<PasskeyList> {
    const passkeys = await this.service.list(flowContextFrom(request), principalOf(request).userId);
    return { passkeys: [...passkeys] };
  }

  @Patch(":id")
  @RequireSession()
  @HttpCode(204)
  rename(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(renamePasskeySchema)) body: RenamePasskey,
  ): Promise<void> {
    return this.service.rename(
      flowContextFrom(request),
      principalOf(request).userId,
      id,
      body.name,
    );
  }

  @Delete(":id")
  @RequireSession()
  @HttpCode(204)
  remove(@Req() request: FastifyRequest, @Param("id") id: string): Promise<void> {
    return this.service.remove(flowContextFrom(request), principalOf(request).userId, id);
  }
}

/** The guard populates this. Its absence means the route was mounted without it. */
function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}
