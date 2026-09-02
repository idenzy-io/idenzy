import { IdentityAlreadyLinkedError } from "@idenzy/core/errors/errors";

export const LinkDecision = {
  /** The provider account resolves to an existing user. Sign them in. */
  LinkExisting: "link_existing",
  /** Nothing matches. Create a user from the provider profile. */
  CreateUser: "create_user",
  /** An address matches but nobody proved it. Send the user through email OTP first. */
  RequireVerification: "require_verification",
} as const;
export type LinkDecision = (typeof LinkDecision)[keyof typeof LinkDecision];

export interface LinkCandidate {
  /** The user already holding this exact provider account, if any. */
  readonly linkedUserId: string | null;
  /** A user in this project with the same email address, if any. */
  readonly userIdWithSameEmail: string | null;
  /** Whether the provider itself asserts the address is verified. */
  readonly providerAssertsVerifiedEmail: boolean;
}

export interface LinkOutcome {
  readonly decision: LinkDecision;
  /** The user the decision points at, or null when a new one must be created. */
  readonly userId: string | null;
}

/**
 * Decides what an OAuth profile means for account identity (PROJECT.md 4.6).
 *
 * One rule carries most of the weight: never link on an email address the provider has
 * not verified. A provider that lets an attacker set an arbitrary unverified address is
 * otherwise a takeover of any account holding that address, and this is the single most
 * common IdP-based account takeover. Everything else here is bookkeeping around it.
 */
export class AccountLinkingPolicy {
  constructor(private readonly autoLinkVerifiedEmails: boolean = true) {}

  decide(candidate: LinkCandidate): LinkOutcome {
    // A returning user: the provider account is already ours, so the email no longer matters.
    if (candidate.linkedUserId !== null) {
      return { decision: LinkDecision.LinkExisting, userId: candidate.linkedUserId };
    }
    if (candidate.userIdWithSameEmail === null) {
      return { decision: LinkDecision.CreateUser, userId: null };
    }
    if (candidate.providerAssertsVerifiedEmail && this.autoLinkVerifiedEmails) {
      return { decision: LinkDecision.LinkExisting, userId: candidate.userIdWithSameEmail };
    }
    return {
      decision: LinkDecision.RequireVerification,
      userId: candidate.userIdWithSameEmail,
    };
  }

  /**
   * Linking a provider account into a session that already exists.
   *
   * Separate from `decide` because the question is different: here we know who the user
   * is, and the only failure is a provider account that already belongs to someone else.
   */
  assertLinkable(linkedUserId: string | null, actingUserId: string): void {
    if (linkedUserId !== null && linkedUserId !== actingUserId) {
      throw new IdentityAlreadyLinkedError({ detail: { actingUserId } });
    }
  }
}
