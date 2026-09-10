import { describe, expect, it } from "vitest";
import {
  DEFAULT_PASSWORD_POLICY,
  LENGTH_FLOOR,
  requirementsOf,
  validatePolicy,
} from "../../app/utils/password-policy";

describe("validatePolicy", () => {
  it("accepts the default", () => {
    expect(validatePolicy(DEFAULT_PASSWORD_POLICY)).toEqual([]);
  });

  it("holds the length floor between the protocol's and a sane ceiling", () => {
    expect(validatePolicy({ ...DEFAULT_PASSWORD_POLICY, minLength: LENGTH_FLOOR - 1 })).toEqual([
      "min_length_range",
    ]);
    expect(validatePolicy({ ...DEFAULT_PASSWORD_POLICY, minLength: 65 })).toEqual([
      "min_length_range",
    ]);
    expect(validatePolicy({ ...DEFAULT_PASSWORD_POLICY, minLength: 12.5 })).toEqual([
      "min_length_integer",
    ]);
  });

  it("checks the lockout threshold only while lockout is on", () => {
    expect(validatePolicy({ ...DEFAULT_PASSWORD_POLICY, lockoutAttempts: 1 })).toEqual([]);
    expect(
      validatePolicy({ ...DEFAULT_PASSWORD_POLICY, lockout: true, lockoutAttempts: 1 }),
    ).toEqual(["lockout_attempts_range"]);
    expect(
      validatePolicy({ ...DEFAULT_PASSWORD_POLICY, lockout: true, lockoutAttempts: 10 }),
    ).toEqual([]);
  });
});

describe("requirementsOf", () => {
  it("states the floor, the absence of composition, and the breach check when on", () => {
    const rules = requirementsOf({ ...DEFAULT_PASSWORD_POLICY, minLength: 12 });
    expect(rules[0]).toBe("At least 12 characters, at most 256.");
    expect(rules).toHaveLength(3);
    expect(requirementsOf({ ...DEFAULT_PASSWORD_POLICY, breachCheck: false })).toHaveLength(2);
  });
});
