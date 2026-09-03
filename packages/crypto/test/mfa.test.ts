import { Clock } from "@idenzy/core/time/clock";
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode } from "../src/mfa/base32.js";
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "../src/mfa/recovery-codes.js";
import { TOTP_PERIOD_SECONDS, Totp } from "../src/mfa/totp.js";

class FixedClock extends Clock {
  constructor(private millis: number) {
    super();
  }
  override now(): Date {
    return new Date(this.millis);
  }
  set(seconds: number): void {
    this.millis = seconds * 1000;
  }
}

/**
 * The seed from RFC 6238 appendix B, which is the ASCII string "12345678901234567890".
 * The vectors below are that document's own, and they are the only reason to trust a
 * hand-written HOTP truncation.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("totp", () => {
  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ])("matches the RFC 6238 vector at t=%i", (seconds, expected) => {
    const clock = new FixedClock(seconds * 1000);
    expect(new Totp(clock).current(RFC_SECRET)).toBe(expected);
  });

  it("accepts a code one step early and one step late", () => {
    const clock = new FixedClock(1_111_111_111_000);
    const totp = new Totp(clock);
    const code = totp.current(RFC_SECRET);

    clock.set(1_111_111_111 - TOTP_PERIOD_SECONDS);
    expect(totp.verify(RFC_SECRET, code, null)).not.toBeNull();
    clock.set(1_111_111_111 + TOTP_PERIOD_SECONDS);
    expect(totp.verify(RFC_SECRET, code, null)).not.toBeNull();
  });

  it("refuses a code two steps away", () => {
    const clock = new FixedClock(1_111_111_111_000);
    const totp = new Totp(clock);
    const code = totp.current(RFC_SECRET);

    clock.set(1_111_111_111 + TOTP_PERIOD_SECONDS * 2);
    expect(totp.verify(RFC_SECRET, code, null)).toBeNull();
  });

  /** The replay case: a code is valid for its whole step, so the step has to be spent. */
  it("refuses a step that was already spent", () => {
    const totp = new Totp(new FixedClock(1_111_111_111_000));
    const code = totp.current(RFC_SECRET);

    const step = totp.verify(RFC_SECRET, code, null);
    expect(step).not.toBeNull();
    expect(totp.verify(RFC_SECRET, code, step)).toBeNull();
  });

  it("refuses anything that is not six digits", () => {
    const totp = new Totp(new FixedClock(1_111_111_111_000));
    for (const code of ["", "12345", "1234567", "abcdef", "12345 "]) {
      expect(totp.verify(RFC_SECRET, code, null)).toBeNull();
    }
  });

  it("generates a secret an authenticator can read back", () => {
    const totp = new Totp(new FixedClock(0));
    const secret = totp.generateSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(totp.verify(secret, totp.current(secret), null)).not.toBeNull();
  });

  it("percent-encodes an issuer that would otherwise split the label", () => {
    const uri = new Totp(new FixedClock(0)).uri("Acme: Staging", "user@a.test", "ABCD");
    expect(uri.startsWith("otpauth://totp/Acme%3A%20Staging:user%40a.test?")).toBe(true);
    expect(new URL(uri).searchParams.get("issuer")).toBe("Acme: Staging");
    expect(new URL(uri).searchParams.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("issues ten codes of a hundred bits each", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(normalizeRecoveryCode(code)).toHaveLength(20);
  });

  it("hashes a code the user retyped in a form they were never shown", () => {
    const code = generateRecoveryCode();
    const retyped = code.toLowerCase().replace(/-/g, " ");
    expect(hashRecoveryCode(retyped)).toBe(hashRecoveryCode(code));
  });

  /** O, I and L are not in the alphabet, so folding them is free and saves a bad read. */
  it("folds the characters the alphabet leaves out", () => {
    expect(normalizeRecoveryCode("O1IL0")).toBe("01110");
  });
});
