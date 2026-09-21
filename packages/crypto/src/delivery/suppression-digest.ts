import { hashToken } from "../tokens/random.js";

/**
 * The stored form of a suppressed address or number.
 *
 * One function because there are now two sides to it and they must agree exactly. The send
 * path hashes a recipient to ask whether it is suppressed; the SES event receiver hashes a
 * bounced recipient to write the row that says it is. If the two ever normalised differently
 * the failure is silent and total — every lookup misses, the list looks empty, and mail keeps
 * going to addresses that hard-bounced.
 *
 * Lowercased and trimmed, so a suppression written for one casing covers the other: the local
 * part is case-sensitive per RFC 5321 and no mail provider anybody uses treats it that way,
 * and a bounce report is not guaranteed to echo the casing we sent.
 *
 * Hashed for the reason the column's own note gives: a suppression list is otherwise a
 * harvestable list of every address that ever bounced for a customer.
 */
export function suppressionDigest(target: string): string {
  return hashToken(target.trim().toLowerCase());
}
