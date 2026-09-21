import { ResourceNotFoundError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  ProjectUserRepository,
  type ProjectUserRow,
} from "@idenzy/persistence/repository/project-user-repository";
import {
  type SessionListItem,
  SessionRepository,
} from "@idenzy/persistence/repository/session-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type {
  ProjectUser,
  ProjectUserList,
  ProjectUserQuery,
  UserSession,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * The end users of a customer's project, for the panel's Users and Sessions screens
 * (PROJECT.md 3.2).
 *
 * Every call goes through `ProjectScope`, which resolves the tenant and refuses to resolve one
 * for a project the caller's organisation does not own. This is the service where that
 * matters most in the whole API: the rows it returns are a customer's own customers, so a
 * scope resolved from the path without the ownership check would be the worst tenancy bug
 * this product could have.
 *
 * Ids cross the boundary in their public `usr_` form and are parsed rather than trusted. A
 * malformed one is a 404 and not a 400, for the same reason a project somebody does not own
 * is: the id space must not answer questions about what exists.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
    private readonly clock: Clock,
  ) {}

  async list(
    context: OrgContext,
    projectId: string,
    query: ProjectUserQuery,
  ): Promise<ProjectUserList> {
    const tenant = await this.scope.of(context, projectId);
    const page = await this.uow.transaction((tx) =>
      new ProjectUserRepository(tx, tenant).list({
        limit: query.limit,
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
    );
    return { users: page.users.map(present), nextCursor: page.nextCursor };
  }

  async find(context: OrgContext, projectId: string, userId: string): Promise<ProjectUser> {
    const tenant = await this.scope.of(context, projectId);
    const id = parseUserId(userId);
    const row = await this.uow.transaction((tx) =>
      new ProjectUserRepository(tx, tenant).findById(id),
    );
    if (row === null) throw notFound(userId);
    return present(row);
  }

  /**
   * Suspends until an instant.
   *
   * What this does *not* do is end the open sessions, and that is the server's behaviour
   * rather than an omission here: a suspension is read on token rotation, so an access
   * token already issued keeps working until it expires — at most one access-token
   * lifetime. The screen says so, and a caller who needs the sessions gone now calls
   * `revokeSessions` as well. Doing both silently would hide which of the two a customer
   * actually asked for in the audit trail.
   */
  async suspend(
    context: OrgContext,
    projectId: string,
    userId: string,
    until: Date,
  ): Promise<ProjectUser> {
    return await this.setBan(context, projectId, userId, until);
  }

  /** Lifts a suspension. Lifting one that was never set is a no-op, not an error. */
  async restore(context: OrgContext, projectId: string, userId: string): Promise<ProjectUser> {
    return await this.setBan(context, projectId, userId, null);
  }

  async sessions(
    context: OrgContext,
    projectId: string,
    userId: string,
  ): Promise<readonly UserSession[]> {
    const tenant = await this.scope.of(context, projectId);
    const id = parseUserId(userId);

    const rows = await this.uow.transaction(async (tx) => {
      // The user is read first so an unknown id is a 404 rather than an empty list, which
      // on a support screen reads as "this person has signed out everywhere".
      const user = await new ProjectUserRepository(tx, tenant).findById(id);
      if (user === null) return null;
      return await new SessionRepository(tx, tenant).listForUser(id);
    });

    if (rows === null) throw notFound(userId);
    return rows.map(presentSession);
  }

  /**
   * Ends every live session this account holds.
   *
   * The count comes back because zero is a real answer a screen has to be able to say:
   * "signed out of 3 devices" and "there was nothing to sign out of" are different things
   * to have just done, and a silent success reads as the first.
   */
  async revokeSessions(context: OrgContext, projectId: string, userId: string): Promise<number> {
    const tenant = await this.scope.of(context, projectId);
    const id = parseUserId(userId);

    const revoked = await this.uow.transaction(async (tx) => {
      const user = await new ProjectUserRepository(tx, tenant).findById(id);
      if (user === null) return null;
      // `revokeAllForUser` answers with the ids it ended, so the count is the length
      // rather than a second query — and an empty array is a real zero.
      return await new SessionRepository(tx, tenant).revokeAllForUser(
        id,
        SessionRevokeReason.AdminRevoked,
        this.clock.now(),
      );
    });

    if (revoked === null) throw notFound(userId);
    return revoked.length;
  }

  private async setBan(
    context: OrgContext,
    projectId: string,
    userId: string,
    until: Date | null,
  ): Promise<ProjectUser> {
    const tenant = await this.scope.of(context, projectId);
    const id = parseUserId(userId);
    const row = await this.uow.transaction((tx) =>
      new ProjectUserRepository(tx, tenant).setBannedUntil(id, until),
    );
    // Null covers both "no such user" and "already erased". They are one answer on
    // purpose: a tombstone is not a state a caller gets to act on, and distinguishing the
    // two would confirm that somebody once existed.
    if (row === null) throw notFound(userId);
    return present(row);
  }
}

function parseUserId(publicId: string): string {
  return PublicId.parse(IdPrefix.User, publicId).uuid;
}

function notFound(userId: string): ResourceNotFoundError {
  return new ResourceNotFoundError({ detail: { userId } });
}

/** The row as the wire sees it: public ids, ISO instants, nothing the SDK would not show. */
function present(row: ProjectUserRow): ProjectUser {
  return {
    id: PublicId.encode(IdPrefix.User, row.id).toString(),
    projectId: PublicId.encode(IdPrefix.Project, row.projectId).toString(),
    email: row.email,
    emailVerified: row.emailVerified,
    phone: row.phone,
    phoneVerified: row.phoneVerified,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    methods: [...row.methods],
    mfaEnabled: row.mfaEnabled,
    activeSessions: row.activeSessions,
    bannedUntil: row.bannedUntil?.toISOString() ?? null,
    lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    metadataPublic: row.metadataPublic,
  };
}

function presentSession(row: SessionListItem): UserSession {
  return {
    id: PublicId.encode(IdPrefix.Session, row.id).toString(),
    deviceName: row.deviceName,
    ip: row.ip,
    userAgent: row.userAgent,
    amr: [...row.amr],
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason,
  };
}
