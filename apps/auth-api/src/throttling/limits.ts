import type { RateLimitSpec } from "./rate-limit.decorator.js";

const MINUTES_5 = 300;
const MINUTES_15 = 900;
const HOUR = 3600;

/**
 * The ceilings, in one readable table (PROJECT.md 4.5, 4.9).
 *
 * They are applied at the routes rather than centrally, because a limit is a property of
 * what a route does; they are *written* here so the set can be read and argued about
 * together, which is the only way to notice that one of them is an order of magnitude out.
 *
 * **The two dimensions do different jobs, and the numbers follow from that.** An address
 * is not a person: a customer's whole office arrives behind one NAT, and so does a mobile
 * carrier's whole city. So an address ceiling tight enough to ration normal use is a
 * ceiling that takes a customer's staff offline at nine in the morning, and the failure
 * looks exactly like our product being broken. Address ceilings are therefore set to catch
 * what is plainly abnormal and nothing finer. The precise control is the *subject* ceiling,
 * which is keyed on the account being named and is unaffected by how many real people share
 * an exit address — that is the one that stops spraying, and it is the one worth being
 * strict with.
 *
 * **On the per-subject limits and §4.5's refusal to lock accounts out.** A limit keyed on
 * the account being named is a soft lockout, and §4.5 rejects lockout because it is a
 * denial-of-service vector aimed at the victim. The refusal that matters there is of a
 * lockout that *persists*: one an attacker can leave in place, that the victim must take
 * an action to clear. These expire on their own within minutes, need no unlock, and never
 * touch a state on the account. What they buy is the defence the address limit cannot give
 * at all — an attacker with a thousand addresses stays under every address ceiling while
 * making a thousand attempts at one person. Bounding the victim's exposure to one short
 * window is the cheaper of the two harms, and it is chosen rather than inherited.
 */

/**
 * Sign-in. The subject window is short on purpose: it is the one an attacker can hold a
 * real user out of, so it is measured in minutes, and ten attempts is more than anybody
 * fumbling a password makes before they reach for the reset link.
 */
export const SIGN_IN_LIMITS: RateLimitSpec = {
  ip: { limit: 100, windowSeconds: MINUTES_5 },
  subject: { limit: 10, windowSeconds: MINUTES_5, from: ["email"] },
};

/** Sign-up is where free-tier abuse lands (PROJECT.md 4.9), so the address ceiling is the tighter one. */
export const SIGN_UP_LIMITS: RateLimitSpec = {
  ip: { limit: 30, windowSeconds: HOUR },
  subject: { limit: 5, windowSeconds: HOUR, from: ["email"] },
};

/**
 * Everything that sends a message costs us money before it reaches anybody.
 *
 * The subject ceiling is the real control here and it is deliberately strict: five codes an
 * hour to one address is generous for a person and useless to somebody trying to bill us.
 * The address ceiling stays loose for the reason above, and more so than anywhere else —
 * email OTP is the *default* way in (PROJECT.md 4.7), so this is the path a whole office
 * signs in through, and rationing it per exit address would break the common case to bound
 * a cost the per-address ceiling was never the right control for. The project's daily send
 * quota in `EmailProvider`, and `SmsFraudGuard`'s spend cap, are what bound the bill.
 */
export const SEND_MESSAGE_LIMITS: RateLimitSpec = {
  ip: { limit: 100, windowSeconds: HOUR },
  subject: { limit: 5, windowSeconds: HOUR, from: ["email", "phone", "newEmail"] },
};

/**
 * Verifying a code or spending a single-use token. Address only: the flow already caps
 * attempts at five per challenge, so what is left to bound is somebody opening challenges
 * to get more of those fives.
 */
export const VERIFY_CODE_LIMITS: RateLimitSpec = {
  ip: { limit: 100, windowSeconds: MINUTES_5 },
};

/**
 * A WebAuthn ceremony. Address only, and it cannot be otherwise: sign-in is usernameless
 * by design, so the request names no subject to key on (PROJECT.md 4.7).
 */
export const CEREMONY_LIMITS: RateLimitSpec = {
  ip: { limit: 100, windowSeconds: MINUTES_5 },
};

/** Starting an OAuth flow writes a row and a state. Cheap, but not free, and unauthenticated. */
export const OAUTH_START_LIMITS: RateLimitSpec = {
  ip: { limit: 100, windowSeconds: MINUTES_5 },
};

/**
 * An anonymous session creates a real user row, which makes it a free-tier abuse path.
 * Tighter than the rest because there is no subject to fall back on and nothing else
 * bounds it, and loose enough for the case it exists for: a game signing in its players.
 */
export const ANONYMOUS_LIMITS: RateLimitSpec = {
  ip: { limit: 50, windowSeconds: HOUR },
};

/**
 * Step-up and MFA verification. Bounded per address; the factor implementations already
 * refuse a spent TOTP step and burn a recovery code on use, so this is the outer wall.
 */
export const MFA_VERIFY_LIMITS: RateLimitSpec = {
  ip: { limit: 60, windowSeconds: MINUTES_15 },
};
