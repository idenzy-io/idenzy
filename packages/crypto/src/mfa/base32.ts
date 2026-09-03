import { InternalError } from "@idenzy/core/errors";

/**
 * RFC 4648 base32, unpadded, because that is the only encoding an authenticator app
 * reads a TOTP secret in.
 *
 * Hand-written rather than taken from a dependency: it is thirty lines, it sits on the
 * enrolment path of every second factor we issue, and a supply-chain compromise of a
 * package that touches secret material is a worse trade than the thirty lines
 * (PROJECT.md 7.6).
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decodes what we encoded, tolerating the padding and lower case a user may retype.
 *
 * Throws on anything else rather than skipping it. A decoder that ignored stray
 * characters would turn a mistyped secret into a different valid secret, and the user
 * would find out at their next sign-in rather than at enrolment.
 */
export function base32Decode(text: string): Buffer {
  const cleaned = text.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of cleaned) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) {
      throw new InternalError({ detail: { reason: "a stored secret is not base32" } });
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(out);
}
