import { describe, expect, it } from "vitest";
import {
  CLIENT_EXAMPLE,
  canBeChallenged,
  ENFORCEMENT_LABELS,
  ENFORCEMENT_TONES,
  type FactorHolder,
  isProofFresh,
  isStepUpWindow,
  STEP_UP,
  STEP_UP_ACTIONS,
  STEP_UP_WINDOWS,
  type StepUpWindow,
  sampleClaims,
  serverExample,
  stepUpCoverage,
  walkthrough,
  windowSentence,
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

describe("canBeChallenged", () => {
  const user = (over: Partial<FactorHolder> = {}): FactorHolder => ({
    mfaEnabled: false,
    methods: ["password"],
    ...over,
  });

  it("counts the two factors a step-up may ask for, and only those", () => {
    expect(canBeChallenged(user({ mfaEnabled: true }))).toBe(true);
    expect(canBeChallenged(user({ methods: ["password", "passkey"] }))).toBe(true);
    expect(canBeChallenged(user())).toBe(false);
  });

  it("does not count a password or a one-time code as something to be asked for", () => {
    expect(canBeChallenged(user({ methods: ["password", "email_otp", "google"] }))).toBe(false);
  });
});

describe("stepUpCoverage", () => {
  it("splits the project into the accounts that can be asked and the ones that pass", () => {
    const people: FactorHolder[] = [
      { mfaEnabled: true, methods: ["password"] },
      { mfaEnabled: false, methods: ["passkey"] },
      { mfaEnabled: false, methods: ["password"] },
      { mfaEnabled: false, methods: ["email_otp"] },
    ];
    expect(stepUpCoverage(people)).toEqual({
      challengeable: 2,
      passing: 2,
      accounts: 4,
      share: 50,
    });
  });

  it("is zero rather than NaN on a project with no accounts", () => {
    expect(stepUpCoverage([])).toEqual({
      challengeable: 0,
      passing: 0,
      accounts: 0,
      share: 0,
    });
  });
});

describe("windowSentence", () => {
  it("is the sentence the note asks for, with the window in it", () => {
    expect(windowSentence(15)).toBe(
      "Ask for another verification when the last successful factor check is older than 15 minutes.",
    );
  });
});

describe("walkthrough", () => {
  const now = new Date("2026-09-09T12:00:00Z");

  it("tells one story: a proof, an action inside the window, one past it, and the answer", () => {
    const walk = walkthrough(15, now);
    expect(walk.steps.map((step) => step.id)).toEqual(["sign-in", "inside", "past", "answered"]);
    expect(walk.steps.map((step) => step.fresh)).toEqual([true, true, false, true]);
    expect(walk.steps.map((step) => step.number)).toEqual([1, 2, 3, 4]);
  });

  it("puts the boundary where the window closes, and above the step that crosses it", () => {
    const walk = walkthrough(15, now);
    expect(walk.boundary).toBe("15 minutes after the proof, the window closes");
    expect(walk.boundaryBefore).toBe("past");
    expect(walk.steps.some((step) => step.id === walk.boundaryBefore)).toBe(true);
  });

  it("derives every age from the window, inside it and comfortably past it", () => {
    for (const minutes of STEP_UP_WINDOWS) {
      const walk = walkthrough(minutes as StepUpWindow, now);
      const inside = walk.steps.find((step) => step.id === "inside");
      const past = walk.steps.find((step) => step.id === "past");
      expect(inside?.ageMinutes).toBeGreaterThan(0);
      expect(inside?.ageMinutes).toBeLessThanOrEqual(minutes);
      expect(past?.ageMinutes).toBeGreaterThan(minutes);
      expect(inside?.what).toContain(`${inside?.ageMinutes} minutes later`);
      expect(past?.what).toContain(`${past?.ageMinutes} minutes after that proof`);
    }
  });

  it("applies the same rule the server does, not its own arithmetic", () => {
    for (const minutes of STEP_UP_WINDOWS) {
      for (const step of walkthrough(minutes as StepUpWindow, now).steps) {
        const at = new Date(now.getTime() - step.ageMinutes * 60_000).toISOString();
        expect(step.fresh).toBe(isProofFresh(at, now, minutes as StepUpWindow));
      }
    }
  });

  it("ends on the window it hands back, so the story closes where it opened", () => {
    const walk = walkthrough(30, now);
    expect(walk.steps.at(-1)?.outcome).toBe("Fresh for another 30 minutes");
  });

  it("says the refusal in words, because the tone alone is not a state", () => {
    const past = walkthrough(15, now).steps.find((step) => step.id === "past");
    expect(past?.outcome).toBe("Refused, and asked to verify");
  });
});

describe("STEP_UP_ACTIONS", () => {
  it("names exactly one action our own server enforces today", () => {
    const enforced = STEP_UP_ACTIONS.filter((entry) => entry.enforcement === "enforced");
    expect(enforced.map((entry) => entry.id)).toEqual(["email-change"]);
    expect(enforced[0]?.behaviour).toContain(STEP_UP.enforcedRoute);
  });

  it("keeps the customer's own actions as theirs, with our claim to check", () => {
    const yours = STEP_UP_ACTIONS.filter((entry) => entry.enforcement === "yours");
    expect(yours.map((entry) => entry.id)).toEqual(["your-actions"]);
    expect(yours[0]?.behaviour).toContain(STEP_UP.claim);
  });

  it("sends the sign-in signals to the screen that owns them, and claims nothing here", () => {
    const signals = STEP_UP_ACTIONS.find((entry) => entry.id === "signals");
    expect(signals?.enforcement).toBe("unavailable");
    expect(signals?.link).toEqual({ label: "Security centre", to: "/security" });
  });

  it("says the password proof is not built rather than leaving it out", () => {
    const password = STEP_UP_ACTIONS.find((entry) => entry.id === "password-proof");
    expect(password?.enforcement).toBe("unavailable");
    expect(password?.behaviour).toContain("not built");
  });

  it("has a label and a tone for every enforcement it uses", () => {
    for (const entry of STEP_UP_ACTIONS) {
      expect(ENFORCEMENT_LABELS[entry.enforcement]).toBeTruthy();
      expect(ENFORCEMENT_TONES[entry.enforcement]).toBeTruthy();
      expect(entry.action.length).toBeLessThanOrEqual(48);
    }
  });
});

describe("the paired example", () => {
  it("checks the client's challenge for null rather than assuming one", () => {
    expect(CLIENT_EXAMPLE).toContain("startStepUp()");
    expect(CLIENT_EXAMPLE).toContain("challenge !== null");
  });

  it("refuses on the server before it allows, and never treats a missing proof as enough", () => {
    const code = serverExample(30);
    expect(code).toContain(STEP_UP.verifierField);
    expect(code).toContain("age === null");
    expect(code).toContain(STEP_UP.errorCode);
    // The window in the example is the project's own, not the server's cap.
    expect(code).toContain("30 * 60");
  });

  it("writes the window it was given", () => {
    for (const minutes of STEP_UP_WINDOWS) {
      expect(serverExample(minutes as StepUpWindow)).toContain(`${minutes} * 60`);
    }
  });
});

describe("sampleClaims", () => {
  it("carries the age as a number and marks both factors in amr", () => {
    const parsed = JSON.parse(sampleClaims(42)) as { fva: number; amr: string[] };
    expect(parsed.fva).toBe(42);
    expect(parsed.amr).toEqual(["pwd", "totp", "mfa"]);
  });
});
