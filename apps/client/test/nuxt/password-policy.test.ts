import { describe, expect, it } from "vitest";
import {
  attemptsSummary,
  DEFAULT_PASSWORD_POLICY,
  HASHING,
  LENGTH_FLOOR,
  policyChanged,
  requirementsOf,
  requirementsSummary,
  resetSummary,
  SAMPLE_HASH,
  type StoredCounts,
  storedMix,
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

describe("SAMPLE_HASH", () => {
  it("writes the parameters in the order argon2 emits them", () => {
    // `m,t,p` is what everyone types from memory and what once made needsRehash rehash
    // every password on every sign-in. The screen must show the string a hash matches.
    expect(SAMPLE_HASH).toContain(`m=${HASHING.memoryMiB * 1024},p=1,t=3`);
    expect(SAMPLE_HASH.startsWith(`$argon2id$v=${HASHING.phcVersion}$`)).toBe(true);
  });
});

describe("storedMix", () => {
  const counts = (legacy: Partial<StoredCounts["legacy"]>, current = 0): StoredCounts => ({
    current,
    legacy: { bcrypt: 0, scrypt: 0, argon2: 0, pbkdf2: 0, ...legacy },
  });

  it("leads with the current hash and orders the rest by how many hold them", () => {
    const rows = storedMix(counts({ bcrypt: 30, scrypt: 60 }, 10));
    expect(rows.map((row) => row.id)).toEqual(["current", "scrypt", "bcrypt"]);
    expect(rows.map((row) => row.share)).toEqual([10, 60, 30]);
    expect(rows[0]?.current).toBe(true);
  });

  it("leaves out a format nobody holds", () => {
    expect(storedMix(counts({ bcrypt: 4 }, 6)).map((row) => row.id)).toEqual(["current", "bcrypt"]);
  });

  it("keeps the current row at zero, because that is the answer mid-migration", () => {
    const rows = storedMix(counts({ bcrypt: 8 }));
    expect(rows[0]).toMatchObject({ id: "current", count: 0, share: 0 });
    expect(rows[1]?.share).toBe(100);
  });

  it("draws no bar at all rather than dividing by nothing", () => {
    expect(storedMix(counts({}))).toEqual([
      { id: "current", label: HASHING.algorithm, count: 0, share: 0, current: true },
    ]);
  });
});

describe("the summaries a folded card carries", () => {
  it("states the requirements a reader would otherwise have to open the card for", () => {
    expect(requirementsSummary({ ...DEFAULT_PASSWORD_POLICY, minLength: 12 })).toBe(
      "12 characters, breach check on",
    );
    expect(
      requirementsSummary({ ...DEFAULT_PASSWORD_POLICY, minLength: 8, breachCheck: false }),
    ).toBe("8 characters, breach check off");
  });

  it("states what a reset does to the link and to the other sessions", () => {
    expect(resetSummary({ ...DEFAULT_PASSWORD_POLICY, resetLifetime: 15 })).toBe(
      "15-minute link, other sessions end",
    );
    expect(
      resetSummary({ ...DEFAULT_PASSWORD_POLICY, resetLifetime: 60, signOutOnReset: false }),
    ).toBe("60-minute link, other sessions stay");
  });

  it("says a project is rate limited even when nothing locks, because it always is", () => {
    expect(attemptsSummary({ ...DEFAULT_PASSWORD_POLICY, lockout: false })).toBe(
      "Rate limited, no lockout",
    );
    expect(attemptsSummary({ ...DEFAULT_PASSWORD_POLICY, lockout: true, lockoutAttempts: 5 })).toBe(
      "Locks after 5 attempts",
    );
  });
});

describe("policyChanged", () => {
  it("is what enables Save, so an unchanged draft is not one", () => {
    expect(policyChanged(DEFAULT_PASSWORD_POLICY, { ...DEFAULT_PASSWORD_POLICY })).toBe(false);
    expect(
      policyChanged(DEFAULT_PASSWORD_POLICY, { ...DEFAULT_PASSWORD_POLICY, minLength: 12 }),
    ).toBe(true);
  });
});
