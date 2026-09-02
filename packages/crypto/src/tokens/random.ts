import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Opaque token material. Everything here uses the CSPRNG from node:crypto; no userland
 * random, ever (PROJECT.md 4.2).
 */

/** 256 bits, base64url. Used for refresh tokens, magic links and single-use codes. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Storage form for any opaque token. We never store the token itself. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A numeric OTP.
 *
 * randomInt, not `randomBytes % 10`: modulo over a byte biases the low digits, which is
 * a real weakening of a 6-digit code.
 */
export function generateNumericOtp(digits = 6): string {
  let code = "";
  for (let i = 0; i < digits; i += 1) code += String(randomInt(0, 10));
  return code;
}

/** Constant-time compare of two hex digests. Length mismatch returns false, not throw. */
export function safeCompareHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Prefixed identifier, so a leaked id is self-describing in a bug report. */
export function generatePrefixedId(prefix: string, bytes = 16): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url").replace(/[-_]/g, "").slice(0, 22)}`;
}
