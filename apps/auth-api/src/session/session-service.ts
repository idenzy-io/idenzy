import { randomUUID } from "node:crypto";
import { AppConfig } from "@idenzy/config/app-config";
import { InternalError, ResourceNotFoundError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import type { User } from "@idenzy/domain/entities/user";
import { AnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
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
import { ClaimTemplateService } from "../claims/claim-template-service.js";
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { RevocationPublisher } from "./revocation-publisher.js";
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
    private readonly revocations: RevocationPublisher,
    private readonly claims: ClaimTemplateService,
    private readonly analytics: AnalyticsRecorder,
    private readonly settings: ProjectSettingsReader,
  ) {}

  async issueSession(context: FlowContext, subject: AuthenticatedSubject): Promise<IssuedSession> {
    const tenant = tenantContextFrom(context);
    const refreshToken = generateOpaqueToken();
    const now = this.clock.now();
    // The project's own windows. §4.2 promised these were the customer's to set and they
    // were a deployment-wide environment variable until the settings document existed.
    const lifetimes = (await this.settings.for(context)).lifetimes;

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
        deviceName: context.deviceName,
        factorVerifiedAt: subject.factorVerifiedAt,
        idleExpiresAt: this.clock.inSeconds(lifetimes.idleSeconds),
        absoluteExpiresAt: this.clock.inSeconds(lifetimes.absoluteSeconds),
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

    const access = await this.mintAccessToken(
      tenant,
      user,
      sessionId,
      subject.amr,
      subject.factorVerifiedAt,
    );

    // After the transaction, like the meter and the revocation publish: an analytics event for a
    // sign-in that rolled back would be a row nothing else in the system agrees with. Every flow
    // ends here, so this is the one place a successful authentication can be counted from.
    await this.analytics.record({
      projectId: context.projectId,
      event: "session.created",
      method: subject.amr[0] ?? null,
      outcome: "succeeded",
      userId: subject.userId,
      sessionId,
      ip: context.ip,
      userAgent: context.userAgent,
      at: now,
    });

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
    const ended = await this.uow.run(tenant, async (tx) => {
      const refresh = new RefreshTokenRepository(tx, tenant);
      const sessions = new SessionRepository(tx, tenant);

      const state = await refresh.findByHash(hashToken(presented));
      if (state === null) return null;
      const session = await sessions.findById(state.sessionId);
      if (session === null) return null;

      const now = this.clock.now();
      const sessionIds =
        scope === "all"
          ? await sessions.revokeAllForUser(
              session.userId,
              SessionRevokeReason.SignedOutEverywhere,
              now,
            )
          : await this.revokeOne(sessions, session.id, now);
      await refresh.revokeForSessions(sessionIds, now);

      await new OutboxRepository(tx, tenant).enqueue("session.revoked", {
        userId: session.userId,
        sessionIds: [...sessionIds],
        scope,
        at: now.toISOString(),
      });
      return { userId: session.userId, sessionIds, at: now };
    });

    // Published after the commit, so nothing is announced that the transaction could
    // still roll back (ADR-0009). Signing out everywhere publishes one watermark rather
    // than one entry per device.
    if (ended === null) return;
    await (scope === "all"
      ? this.revocations.userRevoked(tenant, ended.userId, ended.at)
      : this.revocations.sessionsRevoked(tenant, ended.sessionIds, ended.at));
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
        deviceName: row.deviceName,
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
    const revokedAt = await this.uow.run(tenant, async (tx) => {
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
      return now;
    });

    await this.revocations.sessionsRevoked(tenant, [sessionId], revokedAt);
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
   *
   * The user is taken rather than an id because the project's claim template renders from
   * it, and every caller already holds one: a session was just issued for them, a rotation
   * just checked they may still sign in, a step-up just read them. Passing an id would
   * have meant loading the row a second time on the hottest path in the system.
   *
   * The template is read here rather than by each caller, so a new one that mints a token
   * cannot leave a project's custom claims out. That read is a primary-key lookup on a
   * tiny table today; the project-config cache PROJECT.md 4.2 assumes is what removes it.
   */
  async mintAccessToken(
    tenant: TenantContext,
    user: User,
    sessionId: string,
    amr: readonly string[],
    factorVerifiedAt: Date | null,
  ): Promise<{ token: string; expiresAt: Date }> {
    const custom = (await this.claims.load(tenant)).render(user);
    // Two primary-key reads per token, which is what the project-config cache §4.2 assumes
    // is for. Both are on the refresh path, so this is the place that cache has to land.
    const lifetimes = (await this.settings.forProject(tenant.projectId, tenant.requestId))
      .lifetimes;
    const issued = await this.tokens.issue(
      {
        sub: PublicId.encode(IdPrefix.User, user.id).value,
        sid: PublicId.encode(IdPrefix.Session, sessionId).value,
        aud: PublicId.encode(IdPrefix.Project, tenant.projectId).value,
        amr,
        ...(factorVerifiedAt === null
          ? {}
          : { fva: Math.floor((this.clock.nowMs() - factorVerifiedAt.getTime()) / 1000) }),
        custom,
      },
      lifetimes.accessTokenSeconds,
    );
    return { token: issued.token, expiresAt: issued.expiresAt };
  }
}
