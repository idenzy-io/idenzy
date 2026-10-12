import { LinkingRequiresVerificationError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { AccountLinkingPolicy, LinkDecision } from "@idenzy/domain/policies/account-linking-policy";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import type { ProviderProfile } from "@idenzy/domain/ports/oauth-provider";
import { IdentityRepository } from "@idenzy/persistence/repository/identity-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import type { Transaction } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

export interface ProviderSignInInput {
  readonly provider: string;
  readonly profile: ProviderProfile;
  /** Set when an existing session is attaching the provider rather than signing in with it. */
  readonly linkUserId: string | null;
  /** Provider tokens to keep, already encrypted, or null. Only the redirect flow has any. */
  readonly encryptedTokens: string | null;
}

/**
 * For the one decision that does not depend on the project's rule.
 *
 * `assertLinkable` refuses an identity that is already another account's, which is a fact
 * about the rows rather than a policy choice; `autoLink` never reaches it.
 */
const LINK_THEFT_CHECK = new AccountLinkingPolicy(true);

/**
 * Who a provider account is in this project: found, linked on a verified address, or
 * created (PROJECT.md 4.6).
 *
 * Shared by the two ways a provider proves an account, the OAuth redirect and a native ID
 * token, because the takeover defence lives here and one copy of it is the only number of
 * copies that stays right. A second implementation that linked on an unverified address
 * would reopen the attack for whichever way in it served.
 */
@Injectable()
export class ProviderSignIn {
  constructor(
    private readonly clock: Clock,
    private readonly settings: ProjectSettingsReader,
  ) {}

  /** Resolves the user, links or refreshes the identity, and refuses a user who may not sign in. */
  async resolve(
    tx: Transaction,
    context: FlowContext,
    input: ProviderSignInInput,
  ): Promise<string> {
    const tenant = tenantContextFrom(context);
    const identities = new IdentityRepository(tx, tenant);
    const users = new UserRepository(tx, tenant);
    const { profile } = input;
    const existing = await identities.findByAccount(input.provider, profile.providerUserId);

    const userId =
      input.linkUserId === null
        ? await this.resolveSignIn(context, users, existing?.userId ?? null, profile)
        : this.resolveLink(existing?.userId ?? null, input.linkUserId);

    const providerData = { displayName: profile.displayName, avatarUrl: profile.avatarUrl };
    if (existing === null) {
      await identities.link({
        userId,
        provider: input.provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        providerData,
        encryptedTokens: input.encryptedTokens,
      });
    } else {
      await identities.touch(existing.id, profile.email, providerData, input.encryptedTokens);
    }

    const user = await users.findById(userId);
    user?.assertCanSignIn(this.clock);
    return userId;
  }

  /**
   * The linking decision, and the single most consequential branch in either flow.
   *
   * The policy refuses to match on an address the provider has not verified, which is
   * the defence against the classic IdP takeover: a provider that lets an attacker set
   * an arbitrary unverified address would otherwise hand them any account holding it.
   * The answer in that case is not to fail permanently but to send the user through
   * email OTP, which is what the error code tells the customer's UI to do.
   */
  private async resolveSignIn(
    context: FlowContext,
    users: UserRepository,
    linkedUserId: string | null,
    profile: ProviderProfile,
  ): Promise<string> {
    const sameEmail =
      profile.email === null || linkedUserId !== null
        ? null
        : await users.findByEmail(profile.email);

    // Built per decision from the project's own rule rather than injected once. The
    // policy is a value object over one boolean, so a policy per project would be a cache
    // keyed on a tenant holding objects that differ by a flag.
    const { autoLink } = (await this.settings.for(context)).linking;
    const outcome = new AccountLinkingPolicy(autoLink).decide({
      linkedUserId,
      userIdWithSameEmail: sameEmail?.id ?? null,
      providerAssertsVerifiedEmail: profile.emailVerified,
    });

    if (outcome.decision === LinkDecision.RequireVerification) {
      throw new LinkingRequiresVerificationError();
    }
    if (outcome.decision === LinkDecision.LinkExisting && outcome.userId !== null) {
      return outcome.userId;
    }

    const created = await users.create({
      email: profile.email,
      // Carried across rather than assumed. A provider that does not assert a verified
      // address leaves the account unverified, exactly as password sign-up would.
      emailVerified: profile.emailVerified,
      phone: null,
      passwordHash: null,
      passwordAlgoVersion: null,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    });
    return created.id;
  }

  /**
   * Attaching a provider to a session that already exists. The only failure is theft.
   *
   * `assertLinkable` asks whether this identity already belongs to somebody else, which is
   * true or false regardless of what the project decided about auto-linking — so it uses a
   * fixed instance rather than reading a setting that cannot change the answer.
   */
  private resolveLink(linkedUserId: string | null, actingUserId: string): string {
    LINK_THEFT_CHECK.assertLinkable(linkedUserId, actingUserId);
    return actingUserId;
  }
}
