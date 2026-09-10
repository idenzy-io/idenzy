import { describe, expect, it } from "vitest";
import {
  isProofFresh,
  isStepUpWindow,
  STEP_UP,
  STEP_UP_ASKS,
  STEP_UP_WINDOWS,
  sampleClaims,
} from "../../app/utils/step-up";

describe("STEP_UP_WINDOWS", () => {
  it("stays inside the server's cap and knows its own members", () => {
    for (const minutes of STEP_UP_WINDOWS) {
      expect(minutes * 60).toBeLessThanOrEqual(STEP_UP.maxAgeCapSeconds);
      expect(isStepUpWindow(minutes)).toBe(true);
    }
    expect(isStepUpWindow(10)).toBe(false);
    expect(isStepUpWindow(120)).toBe(false);
  });
});

describe("isProofFresh", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  it("passes a proof at or inside the window and refuses one past it", () => {
    expect(isProofFresh(minutesAgo(0), now, 15)).toBe(true);
    expect(isProofFresh(minutesAgo(15), now, 15)).toBe(true);
    expect(isProofFresh(minutesAgo(16), now, 15)).toBe(false);
    expect(isProofFresh(minutesAgo(45), now, 60)).toBe(true);
  });

  it("refuses a session that never proved a factor, whatever the window", () => {
    expect(isProofFresh(null, now, 60)).toBe(false);
  });

  it("refuses a proof from the future rather than trusting a clock", () => {
    expect(isProofFresh(minutesAgo(-1), now, 15)).toBe(false);
  });
});

describe("STEP_UP_ASKS", () => {
  it("names exactly one of ours that is live, and it is the address change", () => {
    const live = STEP_UP_ASKS.filter((ask) => ask.who === "ours" && ask.live);
    expect(live.map((ask) => ask.id)).toEqual(["email-change"]);
  });

  it("keeps the customer's own actions live, because they need nothing from us", () => {
    const yours = STEP_UP_ASKS.filter((ask) => ask.who === "yours");
    expect(yours).toHaveLength(1);
    expect(yours[0]?.live).toBe(true);
  });
});

describe("sampleClaims", () => {
  it("carries the age as a number and marks both factors in amr", () => {
    const parsed = JSON.parse(sampleClaims(42)) as { fva: number; amr: string[] };
    expect(parsed.fva).toBe(42);
    expect(parsed.amr).toEqual(["pwd", "totp", "mfa"]);
  });
});
