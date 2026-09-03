import { MissingCredentialsError, SessionRevokedError } from "@idenzy/core/errors/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { TokenVerifier } from "@idenzy/crypto/tokens/token-verifier";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { flowContextFrom, tenantContextFrom } from "../tenancy/flow-context.js";

export const REQUIRES_SESSION = "idenzy:requires-session";

/** Marks a route as needing a signed-in end user. Opt-in, unlike tenant resolution. */
export const RequireSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_SESSION, true);

export interface SessionPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly amr: readonly string[];
}

declare module "fastify" {
  interface FastifyRequest {
    principal?: SessionPrincipal;
  }
}

/**
 * Authenticates the end user behind a request (PROJECT.md 9.3 step 4).
 *
 * It does two things a signature check alone does not. It refuses a token whose audience
 * is a different project, so a token minted for one tenant cannot be replayed at
 * another. And it reads the session row, so revocation takes effect immediately instead
 * of at the end of the access token's lifetime.
 *
 * That database read is affordable here because every route behind this guard queries
 * anyway. The Valkey revocation set (PROJECT.md 4.2) is what keeps it off the hot path
 * once there are endpoints that would not otherwise touch Postgres.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly verifier: TokenVerifier,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_SESSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required !== true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const claims = await this.verifier.verify(bearer(request));

    const tenant = tenantContextFrom(flowContextFrom(request));
    const expectedAudience = PublicId.encode(IdPrefix.Project, tenant.projectId).value;
    if (claims.audience !== expectedAudience) throw new MissingCredentialsError();

    const sessionId = PublicId.parse(IdPrefix.Session, claims.sessionId).uuid;
    const session = await this.uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).findById(sessionId),
    );
    if (session === null || !session.isUsable(this.clock)) throw new SessionRevokedError();

    request.principal = { userId: session.userId, sessionId, amr: claims.amr };
    return true;
  }
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) throw new MissingCredentialsError();
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) throw new MissingCredentialsError();
  return token;
}
