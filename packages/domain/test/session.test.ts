import { Clock } from "@idenzy/core/time/clock";
import { describe, expect, it } from "vitest";
import { Session, type SessionState } from "../src/entities/session.js";

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
const future = new Date(now.getTime() + 3_600_000);
const past = new Date(now.getTime() - 1);

function session(overrides: Partial<SessionState> = {}): Session {
  return new Session({
    id: "ses_1",
    projectId: "prj_1",
    userId: "usr_1",
    amr: ["pwd"],
    factorVerifiedAt: null,
    idleExpiresAt: future,
    absoluteExpiresAt: future,
    revokedAt: null,
    revokeReason: null,
    ...overrides,
  });
}

describe("Session", () => {
  it("is usable when live", () => {
    expect(session().isUsable(clock)).toBe(true);
  });

  it("is unusable once revoked", () => {
    expect(session({ revokedAt: past }).isUsable(clock)).toBe(false);
  });

  it("is unusable past the idle timeout even if the absolute one is far away", () => {
    expect(session({ idleExpiresAt: past }).isUsable(clock)).toBe(false);
  });

  it("is unusable past the absolute timeout even if recently active", () => {
    expect(session({ absoluteExpiresAt: past }).isUsable(clock)).toBe(false);
  });

  it("reports no factor age when no factor was verified", () => {
    // Callers must read null as "too old", never as "no restriction".
    expect(session().factorVerificationAgeSeconds(clock)).toBeNull();
  });

  it("reports the factor age in seconds", () => {
    const verified = new Date(now.getTime() - 90_000);
    expect(session({ factorVerifiedAt: verified }).factorVerificationAgeSeconds(clock)).toBe(90);
  });
});
