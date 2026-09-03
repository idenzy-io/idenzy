import { randomUUID } from "node:crypto";
import { AppConfig } from "@idenzy/config/app-config";
import { InternalError, ResourceNotFoundError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import type {
  AuthenticatedSubject,
  FlowContext,
  IssuedSession,
  SessionIssuer,
} from "@idenzy/domain/ports/auth-flow";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { RefreshTokenRepository } from "@idenzy/persistence/repository/refresh-token-repository";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionList } from "@idenzy/protocol/schemas/session";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import type { SessionPrincipal } from "./session.guard.js";

export type SignOutScope = "current" | "all";

/**
 * Creates sessions, and is the only thing that does (PROJECT.md 9.5).
 *
 * Every flow ends here, so the session row, the first refresh token, the sign-in
 * timestamp and the event are written in one transaction and cannot be partially done.
 * A flow that wanted to skip the refresh token or the event would have to stop using
 * this class, which is a visible change rather than an omission.
 */
@Injectable()
export class SessionService implements SessionIssuer {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly tokens: TokenIssuer,
    private readonly config: AppConfig,
  ) {}

  async issueSession(context: FlowContext, subject: AuthenticatedSubject): Promise<IssuedSession> {
    const tenant = tenantContextFrom(context);
    const refreshToken = generateOpaqueToken();
    const now = this.clock.now();

    const { sessionId, user } = await this.uow.run(tenant, async (tx) => {
      const users = new UserRepository(tx, tenant);
      const found = await users.findById(subject.userId);
      if (found === null) {
        throw new InternalError({
          detail: { reason: "a flow verified a user that does not exist", userId: subject.userId },
        });
      }
      const sessions = new SessionRepository(tx, tenant);
      const session = await sessions.create({
        userId: subject.userId,
        amr: subject.amr,
        ip: context.ip,
        userAgent: context.userAgent,
        deviceId: null,
        factorVerifiedAt: null,
        idleExpiresAt: this.clock.inSeconds(this.config.get("SESSION_IDLE_TTL_SECONDS")),
        absoluteExpiresAt: this.clock.inSeconds(this.config.get("SESSION_ABSOLUTE_TTL_SECONDS")),
      });

      await new RefreshTokenRepository(tx, tenant).issue({
        sessionId: session.id,
        // A new sign-in starts a new family. Reuse anywhere in it revokes all of it.
        familyId: randomUUID(),
        tokenHash: hashToken(refreshToken),
        parentId: null,
        expiresAt: this.clock.inSeconds(this.config.get("REFRESH_TOKEN_TTL_SECONDS")),
      });

      await users.recordSignIn(subject.userId, now);
      await new OutboxRepository(tx, tenant).enqueue("session.created", {
        sessionId: session.id,
        userId: subject.userId,
        amr: [...subject.amr],
        ip: context.ip,
        userAgent: context.userAgent,
        at: now.toISOString(),
      });
      return { sessionId: session.id, user: found };
    });

    const access = await this.mintAccessToken(tenant, subject.userId, sessionId, subject.amr, null);
    return {
      sessionId,
      userId: subject.userId,
      user,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
    };
  }

  /**
   * Ends a session, or every session the user holds.
   *
   * Deliberately idempotent and silent about an unknown token: signing out twice, or
   * with a token that already expired, is not an error condition a client should have to
   * handle, and answering differently would confirm whether a token was ever valid.
   */
  async signOut(context: FlowContext, presented: string, scope: SignOutScope): Promise<void> {
    const tenant = tenantContextFrom(context);
    await this.uow.run(tenant, async (tx) => {
      const refresh = new RefreshTokenRepository(tx, tenant);
      const sessions = new SessionRepository(tx, tenant);

      const state = await refresh.findByHash(hashToken(presented));
      if (state === null) return;
      const session = await sessions.findById(state.sessionId);
      if (session === null) return;

      const now = this.clock.now();
      const ended =
        scope === "all"
          ? await sessions.revokeAllForUser(
              session.userId,
              SessionRevokeReason.SignedOutEverywhere,
              now,
            )
          : await this.revokeOne(sessions, session.id, now);
      await refresh.revokeForSessions(ended, now);

      await new OutboxRepository(tx, tenant).enqueue("session.revoked", {
        userId: session.userId,
        sessionIds: [...ended],
        scope,
        at: now.toISOString(),
      });
    });
  }

  /**
   * "Your devices", including sessions that have already ended.
   *
   * The history is deliberate: a user investigating a compromise needs to see the
   * session that was revoked and why, not a list that quietly forgets it.
   */
  async listSessions(context: FlowContext, principal: SessionPrincipal): Promise<SessionList> {
    const tenant = tenantContextFrom(context);
    const rows = await this.uow.run(tenant, (tx) =>
      new SessionRepository(tx, tenant).listForUser(principal.userId),
    );
    return {
      sessions: rows.map((row) => ({
        id: PublicId.encode(IdPrefix.Session, row.id).value,
        // Naming a device means parsing a user agent, which rots. Until there is
        // something better than guesswork, the raw string is what we can honestly show.
        deviceName: null,
        ip: row.ip,
        userAgent: row.userAgent,
        amr: [...row.amr],
        createdAt: row.createdAt.toISOString(),
        lastActiveAt: row.lastActiveAt.toISOString(),
        absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        revokeReason: row.revokeReason,
        current: row.id === principal.sessionId,
      })),
    };
  }

  /**
   * Ends one of the caller's own sessions.
   *
   * Scoped to the principal's user id rather than trusting the path parameter, so a
   * valid session cannot be used to revoke a stranger's. A session belonging to someone
   * else answers 404, because 403 would confirm that it exists.
   */
  async revokeSession(
    context: FlowContext,
    principal: SessionPrincipal,
    sessionId: string,
  ): Promise<void> {
    const tenant = tenantContextFrom(context);
    await this.uow.run(tenant, async (tx) => {
      const sessions = new SessionRepository(tx, tenant);
      const target = await sessions.findById(sessionId);
      if (target === null || target.userId !== principal.userId) {
        throw new ResourceNotFoundError({ detail: { entity: "session" } });
      }
      const now = this.clock.now();
      await sessions.revoke(sessionId, SessionRevokeReason.SignedOut, now);
      await new RefreshTokenRepository(tx, tenant).revokeForSessions([sessionId], now);
      await new OutboxRepository(tx, tenant).enqueue("session.revoked", {
        userId: principal.userId,
        sessionIds: [sessionId],
        scope: "current",
        at: now.toISOString(),
      });
    });
  }

  private async revokeOne(
    sessions: SessionRepository,
    sessionId: string,
    at: Date,
  ): Promise<readonly string[]> {
    await sessions.revoke(sessionId, SessionRevokeReason.SignedOut, at);
    return [sessionId];
  }

  /**
   * Claims are public ids, not database uuids: a customer verifying our token offline
   * sees the same identifiers our API returns, and nothing about our row layout.
   */
  async mintAccessToken(
    tenant: TenantContext,
    userId: string,
    sessionId: string,
    amr: readonly string[],
    factorVerifiedAt: Date | null,
  ): Promise<{ token: string; expiresAt: Date }> {
    const issued = await this.tokens.issue({
      sub: PublicId.encode(IdPrefix.User, userId).value,
      sid: PublicId.encode(IdPrefix.Session, sessionId).value,
      aud: PublicId.encode(IdPrefix.Project, tenant.projectId).value,
      amr,
      ...(factorVerifiedAt === null
        ? {}
        : { fva: Math.floor((this.clock.nowMs() - factorVerifiedAt.getTime()) / 1000) }),
    });
    return { token: issued.token, expiresAt: issued.expiresAt };
  }
}
