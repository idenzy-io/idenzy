import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Clock } from "@idenzy/core/time/clock";
import { base32Decode, base32Encode } from "./base32.js";

/**
 * The parameters every authenticator app assumes.
 *
 * SHA-1, six digits, thirty seconds is what RFC 6238 gives as the default and what
 * Google Authenticator, 1Password and Authy actually implement; several of them ignore
 * the `algorithm` and `digits` parameters in the URI entirely, so advertising anything
 * else enrols a factor that generates codes we would reject. SHA-1 here is HMAC-SHA-1
 * over a fresh 160-bit key, which the collision attacks on SHA-1 do not touch.
 */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/**
 * How far either side of now a code is accepted.
 *
 * One step, so a user whose phone clock is half a minute out still gets in, and the
 * window an intercepted code is replayable in stays at ninety seconds rather than
 * growing with the tolerance. `verify` returns the step it matched so the caller can
 * close that window entirely by refusing a step it has already seen.
 */
export const TOTP_SKEW_STEPS = 1;

/**
 * Time-based one-time codes (RFC 6238).
 *
 * `verify` returns the counter the code came from rather than a boolean, and that is the
 * whole reason this class has an unusual signature. A code stays valid for its whole
 * step, so an attacker who reads one over the user's shoulder can spend it too. The only
 * defence is refusing a step that has already been spent, and a boolean cannot carry
 * which step that was.
 */
export class Totp {
  constructor(private readonly clock: Clock) {}

  /** 160 bits, which is what RFC 4226 recommends and what the URI form assumes. */
  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /**
   * The `otpauth://` URI an authenticator reads.
   *
   * The issuer appears twice on purpose: in the label for apps that only parse the
   * label, and as a parameter for apps that read it properly. Both are percent-encoded,
   * because a project name is customer text and a colon in it would otherwise split the
   * label into a different account.
   */
  uri(issuer: string, account: string, secret: string): string {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    const query = new URLSearchParams({
      secret,
      issuer,
      algorithm: "SHA1",
      digits: String(TOTP_DIGITS),
      period: String(TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${label}?${query.toString()}`;
  }

  /**
   * The step a code is valid for, or null.
   *
   * `after` is the last step this secret already spent. A code from that step or earlier
   * is refused however well it verifies, which is what makes a stolen code worth nothing
   * once the owner has used it.
   */
  verify(secret: string, code: string, after: number | null): number | null {
    if (!/^\d+$/.test(code) || code.length !== TOTP_DIGITS) return null;
    const key = base32Decode(secret);
    const current = Math.floor(this.clock.nowMs() / 1000 / TOTP_PERIOD_SECONDS);
    for (let offset = -TOTP_SKEW_STEPS; offset <= TOTP_SKEW_STEPS; offset += 1) {
      const step = current + offset;
      if (step < 0 || (after !== null && step <= after)) continue;
      if (equals(this.at(key, step), code)) return step;
    }
    return null;
  }

  /** Exposed for tests and enrolment confirmation; the algorithm is HOTP over a step. */
  at(key: Buffer, counter: number): string {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", key).update(message).digest();
    // RFC 4226 dynamic truncation: the low nibble of the last byte picks the offset.
    const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
    const binary = digest.readUInt32BE(offset) & 0x7f_ff_ff_ff;
    return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
  }

  /** The code for a secret right now. Enrolment confirmation compares against this. */
  current(secret: string): string {
    return this.at(
      base32Decode(secret),
      Math.floor(this.clock.nowMs() / 1000 / TOTP_PERIOD_SECONDS),
    );
  }
}

/** Constant time, so a wrong code costs the same whichever digit it went wrong at. */
function equals(expected: string, presented: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(presented, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
