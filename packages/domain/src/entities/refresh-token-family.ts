import type { Clock } from "@idenzy/core/time/clock";

export interface RefreshTokenState {
  readonly id: string;
  readonly familyId: string;
  readonly sessionId: string;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
}

export const RefreshOutcome = {
  Rotate: "rotate",
  Expired: "expired",
  Revoked: "revoked",
  /** Already rotated. The token was replayed, so the whole family is compromised. */
  Reuse: "reuse",
} as const;
export type RefreshOutcome = (typeof RefreshOutcome)[keyof typeof RefreshOutcome];

/**
 * Decides what presenting a refresh token means (PROJECT.md 4.2).
 *
 * The rule that matters: a token whose usedAt is already set has been replayed, which
 * means either the legitimate client or an attacker holds a copy. We cannot tell which,
 * so the only safe response is to revoke the entire family and force re-authentication.
 * Deciding this in one place keeps every flow from having to get it right separately.
 */
export class RefreshTokenFamily {
  constructor(private readonly token: RefreshTokenState) {}

  get familyId(): string {
    return this.token.familyId;
  }

  get sessionId(): string {
    return this.token.sessionId;
  }

  /** Order matters: reuse is checked before expiry, because a replayed expired token is still an attack signal. */
  evaluate(clock: Clock): RefreshOutcome {
    if (this.token.usedAt !== null) return RefreshOutcome.Reuse;
    if (this.token.revokedAt !== null) return RefreshOutcome.Revoked;
    if (clock.hasPassed(this.token.expiresAt)) return RefreshOutcome.Expired;
    return RefreshOutcome.Rotate;
  }

  /** Reuse is the only outcome that must revoke siblings rather than just this token. */
  requiresFamilyRevocation(outcome: RefreshOutcome): boolean {
    return outcome === RefreshOutcome.Reuse;
  }
}
