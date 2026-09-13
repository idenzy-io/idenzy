import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  SessionRepository,
  type SessionRow,
} from "@idenzy/persistence/repository/session-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type {
  ProjectSession,
  ProjectSessionList,
  ProjectSessionQuery,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * The project's sessions, for the panel's Sessions & devices screen (PROJECT.md 3.2).
 *
 * What this deliberately does not do is reach the access tokens already minted. Revoking
 * ends the session row and the refresh token with it, but a token in a customer's hands
 * verifies offline against JWKS until it expires — which is the cost of zero-network-call
 * SSR and exactly what the revocation set exists to fix (ADR-0009). The dialog says so;
 * the service cannot, so it must not behave as though it could.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
    private readonly clock: Clock,
  ) {}

  async list(
    context: OrgContext,
    projectId: string,
    query: ProjectSessionQuery,
  ): Promise<ProjectSessionList> {
    const tenant = await this.scope.of(context, projectId);
    const page = await this.uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).listForProject({
        includeRevoked: query.includeRevoked,
        limit: query.limit,
        ...(query.userId === undefined
          ? {}
          : { userId: PublicId.parse(IdPrefix.User, query.userId).uuid }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
    );
    return { sessions: page.sessions.map(present), nextCursor: page.nextCursor };
  }

  /**
   * Ends the named sessions and answers with how many were actually live to end.
   *
   * Ids that name nothing, or name something already revoked, are simply not in the
   * answer: a set selected on a screen somebody else has been working in will contain
   * both, and refusing the whole call over one stale row would make the bulk action
   * unusable exactly when two people are dealing with the same incident.
   */
  async revoke(
    context: OrgContext,
    projectId: string,
    publicIds: readonly string[],
  ): Promise<number> {
    const tenant = await this.scope.of(context, projectId);
    const ids = publicIds.map((id) => PublicId.parse(IdPrefix.Session, id).uuid);
    const ended = await this.uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).revokeMany(
        ids,
        SessionRevokeReason.AdminRevoked,
        this.clock.now(),
      ),
    );
    return ended.length;
  }
}

/**
 * The row as the wire sees it.
 *
 * `deviceBound` is false for every session and `network` is absent entirely, and both are
 * honest rather than missing: device-bound refresh tokens are 4.4 and phase 3 with no
 * column to read, and the IP intelligence the screen's `NetworkIntel` describes is a
 * lookup over a provider we do not have. Sending a plausible value for either would be the
 * simulated capability notes/priorities.md puts first on the list.
 */
function present(row: SessionRow): ProjectSession {
  return {
    id: PublicId.encode(IdPrefix.Session, row.id).toString(),
    projectId: PublicId.encode(IdPrefix.Project, row.projectId).toString(),
    userId: PublicId.encode(IdPrefix.User, row.userId).toString(),
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    ip: row.ip,
    userAgent: row.userAgent,
    amr: [...row.amr],
    factorVerifiedAt: row.factorVerifiedAt?.toISOString() ?? null,
    deviceBound: false,
    lastActiveAt: row.lastActiveAt.toISOString(),
    idleExpiresAt: row.idleExpiresAt.toISOString(),
    absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason,
    createdAt: row.createdAt.toISOString(),
  };
}
