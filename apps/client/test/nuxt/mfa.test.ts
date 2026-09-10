import { describe, expect, it } from "vitest";
import {
  FACTOR_ROLES,
  groupCode,
  groupSecret,
  ISSUER_MAX_LENGTH,
  otpauthUri,
  SAMPLE_SECRET,
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
