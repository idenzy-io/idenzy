import { z } from "zod";

/**
 * Prefixes for the public form of an identifier. Declared here because they are part of
 * the wire contract: a client may match on them, so changing one is a breaking change.
 */
export const IdPrefix = {
  Project: "prj",
  User: "usr",
  Session: "ses",
  Challenge: "chl",
  Passkey: "pky",
  Factor: "mfa",
} as const;
export type IdPrefix = (typeof IdPrefix)[keyof typeof IdPrefix];

/**
 * API key prefixes, and the reason they are part of the contract.
 *
 * The Authorization header carries either an API key or an end user's access token, and
 * the two are told apart by this prefix rather than by trying one and falling back. A
 * guess-and-retry would make a malformed key look like a missing project.
 */
export const ApiKeyPrefix = {
  Publishable: "pk_",
  Secret: "sk_",
} as const;
export type ApiKeyPrefix = (typeof ApiKeyPrefix)[keyof typeof ApiKeyPrefix];

export function isApiKey(token: string): boolean {
  return Object.values(ApiKeyPrefix).some((prefix) => token.startsWith(prefix));
}

/**
 * Told apart by prefix, and the distinction is load-bearing rather than cosmetic.
 *
 * A publishable key is meant to sit in a browser bundle; a secret key is meant never to
 * leave a server. The browser-facing header accepts only the first, so a customer who pastes
 * the wrong one into client config is refused on the prefix alone, before any lookup happens
 * and therefore without learning whether the key was real.
 */
export function isPublishableKey(token: string): boolean {
  return token.startsWith(ApiKeyPrefix.Publishable);
}

export function isSecretKey(token: string): boolean {
  return token.startsWith(ApiKeyPrefix.Secret);
}

/** Opaque, prefixed identifiers. Prefixes make a leaked id self-describing in a bug report. */
export const projectIdSchema = z.string().regex(/^prj_[0-9a-zA-Z]{20,}$/);
export const userIdSchema = z.string().regex(/^usr_[0-9a-zA-Z]{20,}$/);
export const sessionIdSchema = z.string().regex(/^ses_[0-9a-zA-Z]{20,}$/);
export const challengeIdSchema = z.string().regex(/^chl_[0-9a-zA-Z]{20,}$/);
export const passkeyIdSchema = z.string().regex(/^pky_[0-9a-zA-Z]{20,}$/);
export const factorIdSchema = z.string().regex(/^mfa_[0-9a-zA-Z]{20,}$/);

/**
 * Passwords are bounded, not composed. Minimum 8 and maximum 256 per NIST 800-63B;
 * no character-class rules (PROJECT.md 4.5).
 */
export const passwordSchema = z.string().min(8).max(256);

/** Lowercased and length-bounded before it ever reaches the database. */
export const emailSchema = z.string().email().max(320).toLowerCase();

/** E.164 only. Anything else is rejected at the boundary rather than normalized later. */
export const phoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/);

export const isoDateTimeSchema = z.iso.datetime({ offset: true });
