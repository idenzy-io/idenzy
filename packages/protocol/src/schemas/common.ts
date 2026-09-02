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
} as const;
export type IdPrefix = (typeof IdPrefix)[keyof typeof IdPrefix];

/** Opaque, prefixed identifiers. Prefixes make a leaked id self-describing in a bug report. */
export const projectIdSchema = z.string().regex(/^prj_[0-9a-zA-Z]{20,}$/);
export const userIdSchema = z.string().regex(/^usr_[0-9a-zA-Z]{20,}$/);
export const sessionIdSchema = z.string().regex(/^ses_[0-9a-zA-Z]{20,}$/);
export const challengeIdSchema = z.string().regex(/^chl_[0-9a-zA-Z]{20,}$/);

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
