import { ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { Jwks } from "@idenzy/protocol/schemas/discovery";
import { Controller, Get, Param, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { NoTenant } from "../tenancy/tenant-resolution.guard.js";

/**
 * A project's public signing keys (PROJECT.md 4.2, ADR-0021).
 *
 * One key set per project, because every project signs with its own key: a verifier that holds
 * one project's set cannot be handed a token minted for another, whatever its audience says.
 * The path names the project the same way the token's audience does, so an off-the-shelf JWT
 * library is configured with three facts — this URL, the issuer, and the audience — and needs
 * nothing of ours.
 *
 * There is no deployment-wide `/.well-known/jwks.json` or OpenID discovery document any more.
 * Both described one issuer with one key set, which stopped being true with per-project keys,
 * and a discovery document whose `jwks_uri` could only be right for one project would be worse
 * than none.
 *
 * Cached for five minutes. A rotation publishes the next key before anything is signed with it,
 * so a verifier holding this a little longer than ideal still has every key a live token needs.
 */
@Controller("v1/projects/:projectId")
export class ProjectKeysController {
  constructor(private readonly tokens: TokenIssuer) {}

  /**
   * Cacheable when it answers and not when it refuses: a 404 held at a CDN for five minutes would
   * hide the keys of a project created in the meantime from every verifier behind it.
   */
  @Get("jwks.json")
  @NoTenant()
  async jwks(
    @Param("projectId") projectId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Jwks> {
    const keys = await this.tokens.publicKeys(projectOf(projectId));
    reply.header("cache-control", "public, max-age=300");
    return { keys: [...keys] };
  }
}

/** A malformed id is a 404 like an unknown one: the id space does not answer questions. */
function projectOf(publicId: string): string {
  try {
    return PublicId.parse(IdPrefix.Project, publicId).uuid;
  } catch {
    throw new ResourceNotFoundError({ detail: { projectId: publicId } });
  }
}
