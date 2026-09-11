import { describe, expect, it } from "vitest";
import {
  challengeScenarios,
  coverageOf,
  ENROLMENT_JOURNEY,
  FACTOR_ROLES,
  groupCode,
  groupSecret,
  ISSUER_MAX_LENGTH,
  OUTCOME_TONES,
  otpauthUri,
  SAMPLE_SECRET,
  scopeSummary,
  TOTP,
  validateIssuer,
} from "../../app/utils/mfa";

describe("validateIssuer", () => {
  it("wants something short and not blank", () => {
    expect(validateIssuer("Acme")).toBeNull();
    expect(validateIssuer("  Acme Inc.  ")).toBeNull();
    expect(validateIssuer("")).toBe("issuer_empty");
    expect(validateIssuer("   ")).toBe("issuer_empty");
    expect(validateIssuer("a".repeat(ISSUER_MAX_LENGTH))).toBeNull();
    expect(validateIssuer("a".repeat(ISSUER_MAX_LENGTH + 1))).toBe("issuer_long");
  });
});

describe("otpauthUri", () => {
  it("names the issuer twice and pins the parameters every app assumes", () => {
    const uri = otpauthUri("Acme", "user@example.com", SAMPLE_SECRET);
    expect(uri).toBe(
      `otpauth://totp/Acme:user%40example.com?secret=${SAMPLE_SECRET}&issuer=Acme&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it("encodes a colon in the issuer so it cannot split the label", () => {
    const uri = otpauthUri("Acme: Staging", "user@example.com", SAMPLE_SECRET);
    expect(uri.startsWith("otpauth://totp/Acme%3A%20Staging:user%40example.com?")).toBe(true);
    expect(uri).toContain("issuer=Acme%3A+Staging");
  });

  it("uses a sample secret of the length a real one has", () => {
    // 160 bits over a 5-bit alphabet, unpadded.
    expect(SAMPLE_SECRET).toHaveLength(TOTP.secretBits / 5);
    expect(SAMPLE_SECRET).toMatch(/^[A-Z2-7]+$/);
  });
});

describe("grouping for display", () => {
  it("shows a secret in fours and a code in threes", () => {
    expect(groupSecret("MFRGGZDFMZTW")).toBe("MFRG GZDF MZTW");
    expect(groupSecret("MFRGGZDFMZ")).toBe("MFRG GZDF MZ");
    expect(groupCode("482913")).toBe("482 913");
    expect(groupCode("4829")).toBe("4829");
  });
});

describe("FACTOR_ROLES", () => {
  it("has exactly one factor that demands a challenge, and it is the authenticator", () => {
    const demanding = FACTOR_ROLES.filter((role) => role.demands).map((role) => role.kind);
    expect(demanding).toEqual(["totp"]);
  });

  it("never lets a recovery code answer a step-up", () => {
    const recovery = FACTOR_ROLES.find((role) => role.kind === "recovery");
    expect(recovery?.answers).toEqual({ signIn: true, stepUp: false });
  });

  it("offers the passkey first and answers nothing with a factor that is not built", () => {
    expect(FACTOR_ROLES[0]?.kind).toBe("passkey");
    for (const role of FACTOR_ROLES) {
      if (!role.available) expect(role.answers).toEqual({ signIn: false, stepUp: false });
    }
  });
});

describe("coverageOf", () => {
  it("counts who is asked for a code and who is not", () => {
    expect(coverageOf(627, 2614)).toEqual({
      enrolled: 627,
      accounts: 2614,
      withoutOne: 1987,
      share: 24,
    });
  });

  it("is zero rather than NaN on a project with no accounts", () => {
    expect(coverageOf(0, 0)).toEqual({ enrolled: 0, accounts: 0, withoutOne: 0, share: 0 });
  });

  it("never reports a negative number of people", () => {
    expect(coverageOf(9, 4).withoutOne).toBe(0);
    expect(coverageOf(-3, 4).enrolled).toBe(0);
  });
});

describe("scopeSummary", () => {
  it("says optional, and counts both sides of it", () => {
    const summary = scopeSummary(true, coverageOf(627, 2614));
    expect(summary).toContain("optional");
    expect(summary).toContain("627 of 2,614 accounts hold an authenticator");
    expect(summary).toContain("The other 1,987 accounts sign in with one factor");
  });

  it("agrees with itself when every account holds one", () => {
    const summary = scopeSummary(true, coverageOf(4, 4));
    expect(summary).toContain("Every account on this project holds one.");
    expect(summary).not.toContain("The other 0");
  });

  it("does not promise a code is asked for when nobody has enrolled", () => {
    expect(scopeSummary(true, coverageOf(0, 180))).toContain("no sign-in here is asked for a code");
  });

  it("says what the accounts holding one lose while the method is off", () => {
    expect(scopeSummary(false, coverageOf(1, 180))).toBe(
      "Nobody can enrol an authenticator while this is off. 1 account holds one already and is not asked for a code until it is back on.",
    );
    expect(scopeSummary(false, coverageOf(0, 180))).toContain("no account holds one");
  });
});

describe("challengeScenarios", () => {
  it("answers the two questions a reader came with, in the reader's cases", () => {
    const rows = challengeScenarios("15 minutes");
    expect(rows.map((row) => row.outcome)).toEqual([
      "asked",
      "asked",
      "none",
      "none",
      "answered",
      "asked",
    ]);
    // A passkey sign-in and an account holding nothing are the two that are never asked.
    expect(rows.filter((row) => row.outcome === "none").map((row) => row.id)).toEqual([
      "passkey",
      "nothing",
    ]);
  });

  it("writes the step-up window as it was handed over", () => {
    expect(challengeScenarios("15 minutes").at(-1)?.result).toBe("Asked again after 15 minutes");
  });

  it("keeps every scenario and result short enough for a table cell", () => {
    for (const row of challengeScenarios("15 minutes")) {
      expect(row.scenario.length).toBeLessThanOrEqual(64);
      expect(row.result.length).toBeLessThanOrEqual(32);
      expect(OUTCOME_TONES[row.outcome]).toBeTruthy();
    }
  });
});

describe("ENROLMENT_JOURNEY", () => {
  it("runs from the two calls to the sheet that comes with them", () => {
    expect(ENROLMENT_JOURNEY.map((step) => step.id)).toEqual([
      "start",
      "draw",
      "confirm",
      "recovery",
      "afterwards",
    ]);
  });

  it("names the call for every step that is one, and none for the step that is theirs", () => {
    const calls = new Map(ENROLMENT_JOURNEY.map((step) => [step.id, step.call]));
    expect(calls.get("start")).toBe("mfa.enrollTotp()");
    expect(calls.get("confirm")).toBe("mfa.confirmTotp({ factorId, code })");
    // Drawing the QR code is the customer's own screen, which is the point of the step.
    expect(calls.get("draw")).toBe("");
  });

  it("sends the recovery step to the screen that owns the sheet", () => {
    const recovery = ENROLMENT_JOURNEY.find((step) => step.id === "recovery");
    expect(recovery?.link).toEqual({ label: "Recovery codes", to: "/mfa/recovery" });
    expect(recovery?.title).toContain(String(TOTP.recoveryCodes));
  });
});
