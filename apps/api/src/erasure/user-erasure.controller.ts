import { ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Controller, Delete, HttpCode, Param, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { RequireSecretKey } from "../tenancy/secret-key.guard.js";
import { UserErasureService } from "./user-erasure-service.js";

/**
 * Erasing a user from the customer's own backend, with the project's secret key.
 *
 * This is the route a product calls when one of its users deletes their account: the product
 * owns that decision and the screen that asks for it, and Idenzy carries it out. A secret key
 * and nothing less, because the browser holds a publishable key and an end user's session, and
 * neither is a thing that should be able to erase anybody.
 *
 * 204 on success and 404 for an unknown, malformed or already erased id, deliberately one answer:
 * a retry after a lost response reads as "not found", which a caller treats as done, and the id
 * space does not confirm that somebody once existed.
 */
@Controller("v1/users")
export class UserErasureController {
  constructor(private readonly erasure: UserErasureService) {}

  @Delete(":userId")
  @RequireSecretKey()
  @HttpCode(204)
  async erase(@Req() request: FastifyRequest, @Param("userId") userId: string): Promise<void> {
    const context = flowContextFrom(request);
    const tenant = request.tenant;
    const id = parseUserId(userId);
    const erased =
      tenant !== undefined &&
      id !== null &&
      (await this.erasure.erase(tenant, id, { ip: context.ip, userAgent: context.userAgent }));
    if (!erased) throw new ResourceNotFoundError({ detail: { userId } });
  }
}

function parseUserId(publicId: string): string | null {
  try {
    return PublicId.parse(IdPrefix.User, publicId).uuid;
  } catch {
    return null;
  }
}
