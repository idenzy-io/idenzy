import { Clock } from "@idenzy/core/time/clock";
import { describe, expect, it } from "vitest";
import {
  RefreshOutcome,
  RefreshTokenFamily,
  type RefreshTokenState,
} from "../src/entities/refresh-token-family.js";

class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
}

const now = new Date("2026-09-03T12:00:00Z");
const clock = new FixedClock(now);

function token(overrides: Partial<RefreshTokenState> = {}): RefreshTokenFamily {
  return new RefreshTokenFamily({
    id: "rt_1",
    familyId: "fam_1",
    sessionId: "ses_1",
    usedAt: null,
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  });
}

describe("RefreshTokenFamily", () => {
  it("rotates a fresh token", () => {
    expect(token().evaluate(clock)).toBe(RefreshOutcome.Rotate);
  });

  it("treats an already-used token as reuse", () => {
    expect(token({ usedAt: now }).evaluate(clock)).toBe(RefreshOutcome.Reuse);
  });

  it("reports reuse even when the token is also expired", () => {
    // A replayed expired token is still an attack signal, so reuse must win. Checking
    // expiry first would downgrade a compromise to a routine expiry.
    const replayed = token({ usedAt: now, expiresAt: new Date(now.getTime() - 1) });
    expect(replayed.evaluate(clock)).toBe(RefreshOutcome.Reuse);
  });

  it("reports reuse even when the token is also revoked", () => {
    const replayed = token({ usedAt: now, revokedAt: now });
    expect(replayed.evaluate(clock)).toBe(RefreshOutcome.Reuse);
  });

  it("expires a stale token", () => {
    expect(token({ expiresAt: new Date(now.getTime() - 1) }).evaluate(clock)).toBe(
      RefreshOutcome.Expired,
    );
  });

  it("revokes only the family on reuse", () => {
    const family = token();
    expect(family.requiresFamilyRevocation(RefreshOutcome.Reuse)).toBe(true);
    expect(family.requiresFamilyRevocation(RefreshOutcome.Expired)).toBe(false);
    expect(family.requiresFamilyRevocation(RefreshOutcome.Revoked)).toBe(false);
    expect(family.requiresFamilyRevocation(RefreshOutcome.Rotate)).toBe(false);
  });
});
