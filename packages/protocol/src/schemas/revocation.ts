import { z } from "zod";

/**
 * The media type in the JOSE header of a revocation snapshot.
 *
 * Not `JWT`, and that is the point. A distinct `typ` is what stops a snapshot being
 * presented where an access token is expected, and an access token being accepted as a
 * snapshot: both are signed by the same project key, so the signature alone does not say
 * which one you are holding (RFC 8725 section 3.11).
 */
export const REVOCATION_SNAPSHOT_TYP = "idenzy-revocations+jwt";

/** A user whose sessions were all ended at once, as an instant rather than a list. */
export const userRevocationSchema = z.object({
  userId: z.string(),
  /** Unix seconds. A token is dead where its `iat` is strictly below this. */
  revokedBefore: z.number().int().nonnegative(),
});

/**
 * What a project revoked recently enough for a live access token to still name it
 * (PROJECT.md 4.2, ADR-0009).
 *
 * Published whole rather than as a feed of changes: entries expire on their own, so this
 * stays small, and a snapshot has no cursor to drift and no missed event to recover.
 *
 * `iat` and `exp` are the JWT's own and are not repeated here. They are what make a
 * withheld snapshot detectable: without an expiry, anything on the path could serve one
 * copy forever and revocation would stop working with nothing observable at either end.
 */
export const revocationSnapshotSchema = z.object({
  /** Public session ids, as they appear in a token's `sid`. */
  sessions: z.array(z.string()),
  users: z.array(userRevocationSchema),
  /** Set for a project-wide revocation, such as a key compromise. */
  projectRevokedBefore: z.number().int().nonnegative().nullable(),
  /**
   * How long entries are kept, so a client can tell a set that is empty because nothing
   * was revoked from one whose window it has misunderstood.
   */
  retentionSeconds: z.number().int().positive(),
});

export type UserRevocation = z.infer<typeof userRevocationSchema>;
export type RevocationSnapshot = z.infer<typeof revocationSnapshotSchema>;
