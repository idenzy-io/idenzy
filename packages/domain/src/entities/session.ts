import type { Clock } from "@idenzy/core/time/clock";
import type { AuthMethod, SessionRevokeReason } from "@idenzy/protocol/enums/auth";

export interface SessionState {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  readonly factorVerifiedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokeReason: SessionRevokeReason | null;
}

/**
 * A session that knows whether it is still usable (PROJECT.md 7.2.9).
 *
 * The three ways a session can end (revoked, idle timeout, absolute timeout) are decided
 * here rather than at each call site, so no caller can check two of the three and
 * believe it checked all of them.
 */
export class Session {
  constructor(private readonly state: SessionState) {}

  get id(): string {
    return this.state.id;
  }

  get userId(): string {
    return this.state.userId;
  }

  get amr(): readonly AuthMethod[] {
    return this.state.amr;
  }

  /** The instant itself, for a caller comparing it against its own window. */
  get factorVerifiedAt(): Date | null {
    return this.state.factorVerifiedAt;
  }

  isRevoked(): boolean {
    return this.state.revokedAt !== null;
  }

  isExpired(clock: Clock): boolean {
    return (
      clock.hasPassed(this.state.idleExpiresAt) || clock.hasPassed(this.state.absoluteExpiresAt)
    );
  }

  isUsable(clock: Clock): boolean {
    return !this.isRevoked() && !this.isExpired(clock);
  }

  /**
   * Age of the most recent second-factor proof, for the `fva` claim.
   *
   * Returns null when no factor was verified, which callers must treat as "too old"
   * rather than "no restriction".
   */
  factorVerificationAgeSeconds(clock: Clock): number | null {
    if (this.state.factorVerifiedAt === null) return null;
    return Math.floor((clock.nowMs() - this.state.factorVerifiedAt.getTime()) / 1000);
  }
}
