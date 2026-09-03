import { ClaimTemplateUnsatisfiedError } from "@idenzy/core/errors";
import { type ClaimMapping, ClaimSource, MAX_CLAIM_BYTES } from "@idenzy/protocol/schemas/claims";
import type { User } from "../entities/user.js";

/**
 * A project's mapping from what we hold into what its tokens carry (PROJECT.md 4.2).
 *
 * It costs nothing at issue time and that is the reason it exists as configuration rather
 * than as a hook: the user row is already loaded and the template is a read the same
 * transaction was making anyway, where a synchronous `customize-claims` call would put a
 * customer's HTTP round trip inside every sign-in.
 *
 * Two of its rules are here because nowhere else can enforce them. A required claim that
 * resolves to nothing fails the issue rather than producing a token without it, because a
 * claim a customer branches on is one where absent and false read the same. And the
 * rendered bytes are measured, because a template of three short names can still render a
 * profile blob, and a token that a proxy rejects for header size fails somewhere with no
 * sign of what did it.
 */
export class ClaimTemplate {
  private constructor(private readonly mappings: readonly ClaimMapping[]) {}

  static of(mappings: readonly ClaimMapping[]): ClaimTemplate {
    return new ClaimTemplate(mappings);
  }

  /** What a project that has configured nothing gets, and what every project starts as. */
  static empty(): ClaimTemplate {
    return new ClaimTemplate([]);
  }

  get isEmpty(): boolean {
    return this.mappings.length === 0;
  }

  /**
   * The custom claims for one user, or a refusal.
   *
   * Null and undefined are the same answer here on purpose: a mapping onto a field the
   * user has not filled in is absent, not `null`, because a verifier reading `null` has to
   * decide what it means and every one of them decides differently.
   */
  render(user: User): Readonly<Record<string, unknown>> {
    const claims: Record<string, unknown> = {};
    for (const mapping of this.mappings) {
      const value = resolve(user, mapping);
      if (value === undefined || value === null) {
        if (mapping.required) {
          throw new ClaimTemplateUnsatisfiedError({
            detail: { claim: mapping.name, reason: "required claim resolved to nothing" },
          });
        }
        continue;
      }
      claims[mapping.name] = value;
    }
    this.assertWithinBudget(claims);
    return claims;
  }

  /**
   * Measured on what was rendered, not on what was configured.
   *
   * The save-time check bounds the names; only this one sees the values, and a single
   * metadata key can hold more than a header will carry. Failing is deliberate: a token
   * silently trimmed of the claim an authorisation check reads is worse than a sign-in
   * that says it could not be completed.
   */
  private assertWithinBudget(claims: Readonly<Record<string, unknown>>): void {
    const bytes = Buffer.byteLength(JSON.stringify(claims), "utf8");
    if (bytes > MAX_CLAIM_BYTES) {
      throw new ClaimTemplateUnsatisfiedError({
        detail: { reason: "rendered claims exceed the token budget", bytes, max: MAX_CLAIM_BYTES },
      });
    }
  }
}

/**
 * One value, from the source the mapping names.
 *
 * The user source reads the public profile rather than the entity, so what a claim can
 * carry is exactly what `/v1/users/me` already returns and the two cannot drift. Metadata
 * is read by top-level key only: a dotted path would need an escape rule for a key that
 * contains a dot, and a customer who wants a nested value can flatten it where they write
 * it, once, instead of us guessing on every token.
 */
function resolve(user: User, mapping: ClaimMapping): unknown {
  if (mapping.source === ClaimSource.User) {
    return (user.toPublic() as Record<string, unknown>)[mapping.path];
  }
  const metadata =
    mapping.source === ClaimSource.MetadataPrivate ? user.metadataPrivate : user.metadataPublic;
  return metadata[mapping.path];
}
