import { z } from "zod";
import type { PublicUser } from "./user.js";

/**
 * Where a custom claim's value comes from.
 *
 * Three sources and not one, because they are not equally safe. Two of them publish
 * something already public; the third publishes something that was not, and the contract
 * has to be able to tell them apart in order to ask about it.
 */
export const ClaimSource = {
  /** A field of the public profile, which the `/v1/users/me` route already returns. */
  User: "user",
  /** A key of `metadata_public`, which a client SDK can already read. */
  MetadataPublic: "metadata_public",
  /** A key of `metadata_private`, which nothing outside the management API has seen. */
  MetadataPrivate: "metadata_private",
} as const;
export type ClaimSource = (typeof ClaimSource)[keyof typeof ClaimSource];

/**
 * The user fields a claim may read.
 *
 * An allowlist and not a denylist, and it is exactly what the profile endpoint already
 * returns. The direction is the whole point: a column added to `users` tomorrow is not
 * publishable until somebody adds it here, whereas a denylist would have made a password
 * hash claimable the day it was forgotten.
 *
 * `satisfies` is what keeps that promise honest. A name that stops being part of the
 * public profile stops compiling here.
 */
export const CLAIMABLE_USER_FIELDS = [
  "id",
  "email",
  "emailVerified",
  "phone",
  "phoneVerified",
  "displayName",
  "avatarUrl",
  "createdAt",
  "lastSignInAt",
] as const satisfies readonly (keyof PublicUser)[];

export type ClaimableUserField = (typeof CLAIMABLE_USER_FIELDS)[number];

/**
 * Claims a template may never target.
 *
 * Registered names plus the ones we assemble ourselves. Overwriting `sub` would let a
 * template mint a token for another user; overwriting `exp` or `aud` would undo the
 * checks every verifier makes. The list lives here rather than in the server so a
 * dashboard validating a template and the issuer applying it cannot disagree about it,
 * which is the failure that produces a template somebody can save and never use.
 */
export const RESERVED_CLAIMS = [
  "iss",
  "sub",
  "aud",
  "exp",
  "iat",
  "nbf",
  "jti",
  "sid",
  "amr",
  "acr",
  "fva",
  "auth_time",
] as const;

/**
 * How many bytes the custom claims may add to a token.
 *
 * Tokens travel in an `Authorization` header, and proxies cap a request's headers well
 * below what a JSON object can grow to. A kilobyte leaves room for the claims we assemble
 * ourselves and the signature inside every common limit. It is checked when a template is
 * saved and again when one is applied, because the second is the only one that sees a
 * value: a template of three short names can still render a profile blob.
 */
export const MAX_CLAIM_BYTES = 1024;

/** Enough for a role, a tenant, a plan and a handful of flags. Past that is a lookup. */
export const MAX_CLAIMS = 16;

/**
 * A claim name, as JWT registries and every verifier expect one.
 *
 * Namespaced names are allowed because that is what OIDC asks for on non-registered
 * claims, and a colon or a slash in one is not a problem: it is a JSON key.
 */
const claimNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_:./-]+$/, "a claim name is letters, digits and _ : . / -")
  .refine(
    (name) => !RESERVED_CLAIMS.some((reserved) => reserved === name),
    "that claim is assembled by the issuer and cannot be mapped",
  );

/**
 * One mapping from something we hold onto something a token carries.
 *
 * `required` is the interesting field. A claim a customer's authorisation code branches on
 * is one where absent and false are the same answer, so a template can say that a token
 * without it is not worth issuing.
 */
export const claimMappingSchema = z
  .object({
    name: claimNameSchema,
    source: z.enum([ClaimSource.User, ClaimSource.MetadataPublic, ClaimSource.MetadataPrivate]),
    /** A field name for the `user` source, a top-level key for either metadata source. */
    path: z.string().min(1).max(128),
    required: z.boolean().default(false),
  })
  .refine(
    (mapping) =>
      mapping.source !== ClaimSource.User ||
      CLAIMABLE_USER_FIELDS.some((field) => field === mapping.path),
    "that user field is not claimable",
  );

/**
 * The whole set for a project, saved as one.
 *
 * One template rather than a row per claim, because the byte cap is on the total and a
 * cap you can only check by reading every other row is one that races with itself.
 */
export const claimTemplateSchema = z.object({
  claims: z.array(claimMappingSchema).max(MAX_CLAIMS),
  /**
   * Says out loud that mapping `metadata_private` publishes it.
   *
   * Required whenever the template reads from there, and it is not a formality: that
   * column is the one place a customer stores what they did not want a browser to see,
   * and a token is read by anything the user's device sends it to. Refusing to save
   * without it is the last point at which anybody is looking.
   */
  acknowledgePrivateMetadata: z.boolean().default(false),
});

/** What the save returns, so a caller can see what was stored without asking again. */
export const savedClaimTemplateSchema = claimTemplateSchema.extend({
  updatedAt: z.string(),
});

export type ClaimMapping = z.infer<typeof claimMappingSchema>;
export type ClaimTemplateInput = z.input<typeof claimTemplateSchema>;
export type ClaimTemplate = z.infer<typeof claimTemplateSchema>;
export type SavedClaimTemplate = z.infer<typeof savedClaimTemplateSchema>;
