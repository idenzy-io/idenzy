import { z } from "zod";

/**
 * Prefixes for the public form of an identifier. Declared here because they are part of
 * the wire contract: a client may match on them, so changing one is a breaking change.
 */
export const IdPrefix = {
  Org: "org",
  Member: "mem",
  /** An open invitation. Its token is separate and is never this. */
  Invitation: "inv",
  Project: "prj",
  ApiKey: "key",
  Domain: "dom",
  /** A row of the CORS allowlist. Addressed by id, because an origin in a path is escaped. */
  Origin: "orn",
  Webhook: "whk",
  /** A delivery, and the value of `X-Idenzy-Delivery`: a receiver dedupes on this. */
  Delivery: "dlv",
  User: "usr",
  Session: "ses",
  Challenge: "chl",
  Passkey: "pky",
  Factor: "mfa",
  /** A card on file. Never the provider's own token, which is not ours to publish. */
  PaymentMethod: "pmt",
  /** A charge that added credit. */
  TopUp: "top",
  /** A grant of credit, bought or given. */
  CreditGrant: "crd",
  /**
   * An invoice. `bil` and not `inv`, which an invitation already holds — `PublicId` splits
   * on the first underscore, so two prefixes cannot share one and a near-miss would parse
   * as the other kind of thing rather than fail.
   *
   * Its `number` is what a customer quotes at us and is not this: the id is ours and
   * opaque, the number is a sequence an auditor asks about gaps in.
   */
  Invoice: "bil",
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

/**
 * What a webhook signing secret is prefixed with.
 *
 * Part of the contract for the same reason the key prefixes are: it is what makes a value found in
 * a log or an `.env` file recognisable as this kind of credential rather than a key that reaches
 * our API. It never travels on `Authorization` — a signing secret is presented to nobody, only
 * used to verify — so nothing resolves a tenant from it.
 */
export const WEBHOOK_SECRET_PREFIX = "whsec_";

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
