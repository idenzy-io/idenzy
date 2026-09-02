import { createHash } from "node:crypto";

/**
 * Checks a password against a breach corpus without sending the password (PROJECT.md 4.5).
 *
 * The k-anonymity split lives in this base and not in a subclass, which is the whole
 * point: the base computes the SHA-1, keeps the suffix in memory and passes only the
 * first five hex characters outward, so no implementation can be written that leaks more
 * than that. A subclass sees a prefix and returns candidate suffixes; it never sees the
 * password.
 */
export abstract class BreachedPasswordChecker {
  /** Candidate suffixes for a 5-character prefix. Case is normalized by the base. */
  protected abstract fetchRange(prefix: string): Promise<readonly string[]>;

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash("sha1")
      .update(password.normalize("NFKC"))
      .digest("hex")
      .toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const candidates = await this.fetchRange(prefix);
    return candidates.some((candidate) => candidate.toUpperCase() === suffix);
  }
}

/**
 * Passes everything. For local development and for tests that are not about breach
 * checking, so that a missing outbound dependency never quietly becomes "no check ran"
 * in an environment nobody looked at.
 */
export class AllowAllPasswordChecker extends BreachedPasswordChecker {
  protected override fetchRange(_prefix: string): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}
