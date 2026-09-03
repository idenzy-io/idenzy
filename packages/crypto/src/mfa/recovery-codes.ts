import { createHash, randomInt } from "node:crypto";

/**
 * Crockford's base32, which drops I, L, O and U.
 *
 * The point is not density. A recovery code is read off paper or out of a password
 * manager and typed by somebody who has already lost their phone, so the alphabet is
 * chosen for the characters that do not get confused, and `normalize` below undoes the
 * confusions that happen anyway.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Four groups of five. 20 symbols over a 32-symbol alphabet is exactly 100 bits. */
const GROUPS = 4;
const GROUP_LENGTH = 5;

/** How many are issued at once. Ten is enough to lose a few and still have a way in. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * A single-use code that stands in for a factor the user cannot reach.
 *
 * 100 bits, and the length is the deliberate cost of that. A recovery code is stored as a
 * SHA-256 digest and not an Argon2id hash, which is only defensible because there is
 * nothing here to sweep: a six-digit OTP has a million candidates and falls the moment
 * its table leaks, whereas 2^100 does not fall to anybody. Shortening this to something
 * friendlier would quietly move it into the category that needs a memory-hard hash, and a
 * memory-hard hash cannot be used here at all, because a submitted code has to be checked
 * against every unspent code the user holds.
 */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    let text = "";
    // randomInt rather than a byte modulo: 256 is not a multiple of 32 in the general
    // case people write, and a biased alphabet is a real loss of entropy here.
    for (let index = 0; index < GROUP_LENGTH; index += 1) text += ALPHABET[randomInt(0, 32)];
    groups.push(text);
  }
  return groups.join("-");
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): readonly string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

/**
 * What a typed code has to become before it is compared.
 *
 * Separators and case are display, so they are removed rather than rejected. O, I and L
 * are not in the alphabet at all, so folding them onto 0 and 1 costs nothing and saves
 * the user who read a 0 as an O off a printed sheet. Anything else is left alone and
 * simply will not match.
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** The storage form. Digest only: a recovery code is never read back, only compared. */
export function hashRecoveryCode(input: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(input)).digest("hex");
}
