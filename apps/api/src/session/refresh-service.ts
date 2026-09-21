import { AppConfig } from "@idenzy/config/app-config";
import {
  RefreshTokenInvalidError,
  RefreshTokenReusedError,
  SessionExpiredError,
  SessionRevokedError,
} from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import { RefreshOutcome } from "@idenzy/domain/entities/refresh-token-family";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import { AnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext, IssuedSession } from "@idenzy/domain/ports/auth-flow";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { RefreshTokenRepository } from "@idenzy/persistence/repository/refresh-token-repository";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { type Transaction, UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { Injectable } from "@nestjs/common";
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { RevocationPublisher } from "./revocation-publisher.js";
import { SessionService } from "./session-service.js";

interface Repositories {
  readonly refresh: RefreshTokenRepository;
  readonly sessions: SessionRepository;
  readonly users: UserRepository;
  readonly outbox: OutboxRepository;
}

/**
 * The outcome of one rotation attempt, decided inside the transaction and acted on
 * outside it. Throwing from inside would roll back the very revocations that reuse
 * detection exists to perform, which is the subtle part of this file.
 */
type Rotation =
  | { readonly kind: "rotated"; readonly session: IssuedSession }
  | { readonly kind: "reused"; readonly sessionId: string; readonly at: Date }
  | { readonly kind: "invalid" }
  | { readonly kind: "session_revoked" }
  | { readonly kind: "session_expired" };

/**
 * Rotating refresh tokens with family-based reuse detection (PROJECT.md 4.2).
 *
 * Presenting a token that was already rotated means either the legitimate client or an
 * attacker holds a copy, and we cannot tell which. The only safe answer is to revoke the
 * whole family and the session behind it, and to make the user authenticate again.
 */
@Injectable()
export class RefreshService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly revocations: RevocationPublisher,
    private readonly actives: ActiveUserMeter,
    private readonly analytics: AnalyticsRecorder,
    private readonly settings: ProjectSettingsReader,
  ) {}

  async rotate(context: FlowContext, presented: string): Promise<IssuedSession> {
    const tenant = tenantContextFrom(context);
    // The project's idle window, read here and not taken from the environment. The
    // Lifetimes screen promises this one reaches sessions that already exist — "read at
    // the next rotation" is its own wording — and this is that rotation. It is also the
    // one read on this path, which is the hot one, so it is resolved before the
    // transaction rather than inside it.
    const idleSeconds = (await this.settings.for(context)).lifetimes.idleSeconds;
    const rotation = await this.uow.transaction((tx) =>
      this.attempt(tx, tenant, context, hashToken(presented), idleSeconds),
    );
    // After the commit, and before the throw that follows it. Reuse detection revokes a
    // session nobody asked us to revoke, so it is the one revocation a customer's verifier
    // has no other way to hear about (ADR-0009).
    if (rotation.kind === "reused") {
      await this.revocations.sessionsRevoked(tenant, [rotation.sessionId], rotation.at);
    }
    // A refresh is an authentication for billing (PROJECT.md 5.1), and it is the one that keeps a
    // long-lived session counted in a month it did not start in. Outside the transaction, like the
    // publish above: the rotation is committed and a meter must not be able to roll one back.
    if (rotation.kind === "rotated") {
      await this.actives.mark(context.projectId, rotation.session.user);
    }
    // Refusals are recorded too, and reuse detection is the one worth having: it is the signal
    // that a refresh token leaked, and a chart of it over time is a question no rollup can answer.
    await this.analytics.record({
      projectId: context.projectId,
      event: rotation.kind === "reused" ? "security.refresh_token_reused" : "session.refreshed",
      method: null,
      outcome: rotation.kind === "rotated" ? "succeeded" : "refused",
      userId: rotation.kind === "rotated" ? rotation.session.userId : null,
      sessionId: rotation.kind === "rotated" ? rotation.session.sessionId : null,
      ip: context.ip,
      userAgent: context.userAgent,
      at: this.clock.now(),
    });
    return this.resolve(rotation, context);
  }

  /** Everything that must be atomic. Returns a decision; never throws for reuse. */
  private async attempt(
    tx: Transaction,
    tenant: TenantContext,
    context: FlowContext,
    tokenHash: string,
    idleSeconds: number,
  ): Promise<Rotation> {
    const repos = this.repositories(tx, tenant);
    const state = await repos.refresh.findByHash(tokenHash);
    if (state === null) return { kind: "invalid" };

    const outcome = repos.refresh.family(state).evaluate(this.clock);
    if (outcome === RefreshOutcome.Reuse) {
      return this.compromise(repos, state.familyId, state.sessionId, context, state.usedAt);
    }
    if (outcome === RefreshOutcome.Revoked || outcome === RefreshOutcome.Expired) {
      return { kind: "invalid" };
    }

    // The race: two presentations of the same token can both reach here. Only one UPDATE
    // matches `used_at is null`, and the loser is reuse by definition.
    const won = await repos.refresh.consume(state.id, this.clock.now());
    // Lost the race, so another request rotated this token moments ago. Reuse by definition,
    // and reported as concurrent rather than replayed because the rotation is this recent.
    if (!won)
      return this.compromise(repos, state.familyId, state.sessionId, context, this.clock.now());

    return this.reissue(repos, tenant, state.id, state.familyId, state.sessionId, idleSeconds);
  }

  private async reissue(
    repos: Repositories,
    tenant: TenantContext,
    parentId: string,
    familyId: string,
    sessionId: string,
    idleSeconds: number,
  ): Promise<Rotation> {
    const session = await repos.sessions.findById(sessionId);
    if (session === null) return { kind: "invalid" };
    if (session.isRevoked()) return { kind: "session_revoked" };
    if (session.isExpired(this.clock)) return { kind: "session_expired" };

    const user = await repos.users.findById(session.userId);
    if (user === null) return { kind: "invalid" };
    // Bans and deletions take effect at the next rotation, which bounds how long a
    // suspended account keeps working to one access-token lifetime. Throwing here rolls
    // the rotation back, which is what we want: a refused refresh should consume nothing.
    user.assertCanSignIn(this.clock);

    const now = this.clock.now();
    const refreshToken = generateOpaqueToken();
    await repos.refresh.issue({
      sessionId,
      familyId,
      tokenHash: hashToken(refreshToken),
      parentId,
      expiresAt: this.clock.inSeconds(this.config.get("REFRESH_TOKEN_TTL_SECONDS")),
    });
    await repos.sessions.touch(sessionId, now, this.clock.inSeconds(idleSeconds));

    // Carried across the rotation rather than dropped. The factor age belongs to the
    // session and a rotation does not undo the proof: minting without it would make `fva`
    // disappear one access-token lifetime after a step-up, so a customer gating on it
    // would ask the user to prove a factor they had just proved.
    const access = await this.sessions.mintAccessToken(
      tenant,
      user,
      sessionId,
      session.amr,
      session.factorVerifiedAt,
    );
    return {
      kind: "rotated",
      session: {
        sessionId,
        userId: session.userId,
        user,
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken,
      },
    };
  }

  /**
   * A replayed token. Revoke the family and the session it belongs to, and record it as
   * a security event rather than a failed request: this is the signal that a refresh
   * token leaked.
   *
   * The event now carries how long ago the token was rotated and a guess at why. **Nothing
   * branches on it**, and the test that matters asserts the family is revoked identically
   * either way. It exists so that "your SDK is refreshing twice" can be told apart from
   * "somebody has your token" during a support conversation, which today is guesswork.
   */
  private async compromise(
    repos: Repositories,
    familyId: string,
    sessionId: string,
    context: FlowContext,
    rotatedAt: Date | null,
  ): Promise<Rotation> {
    const now = this.clock.now();
    // Read before the revoke, because the event is worth nothing to a customer without it: "a token
    // for one of your sessions was replayed" is an incident they can only act on if they know whose
    // account it was. One extra select on the rarest path there is.
    const session = await repos.sessions.findById(sessionId);
    const revoked = await repos.refresh.revokeFamily(familyId, now);
    await repos.sessions.revoke(sessionId, SessionRevokeReason.RefreshTokenReuse, now);
    const sinceRotation = rotatedAt === null ? null : now.getTime() - rotatedAt.getTime();
    await repos.outbox.enqueue("security.refresh_token_reused", {
      userId: session?.userId ?? null,
      sessionId,
      familyId,
      revokedTokens: revoked,
      ip: context.ip,
      userAgent: context.userAgent,
      at: now.toISOString(),
      millisecondsSinceRotation: sinceRotation,
      likelyCause: likelyCause(sinceRotation),
    });
    return { kind: "reused", sessionId, at: now };
  }

  /** Throws after the transaction has committed, so the revocations survive the error. */
  private resolve(rotation: Rotation, context: FlowContext): IssuedSession {
    switch (rotation.kind) {
      case "rotated":
        return rotation.session;
      case "reused":
        this.logger.warn("refresh token reuse detected", {
          requestId: context.requestId,
          projectId: context.projectId,
          outcome: "session_revoked",
        });
        throw new RefreshTokenReusedError();
      case "session_revoked":
        throw new SessionRevokedError();
      case "session_expired":
        throw new SessionExpiredError();
      case "invalid":
        throw new RefreshTokenInvalidError();
    }
  }

  private repositories(tx: Transaction, tenant: TenantContext): Repositories {
    return {
      refresh: new RefreshTokenRepository(tx, tenant),
      sessions: new SessionRepository(tx, tenant),
      users: new UserRepository(tx, tenant),
      outbox: new OutboxRepository(tx, tenant),
    };
  }
}

/**
 * A guess, for humans reading an incident. Two seconds is the width of a plausible client
 * race: several components hitting a 401 together, or two tabs waking from sleep.
 */
function likelyCause(sinceRotation: number | null): string {
  if (sinceRotation === null) return "unknown";
  return sinceRotation <= 2000 ? "concurrent_client" : "delayed_replay";
}
