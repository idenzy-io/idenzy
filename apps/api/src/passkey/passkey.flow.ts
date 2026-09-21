import {
  ChallengeExpiredError,
  InternalError,
  WebauthnAssertionInvalidError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { hashToken, safeCompareHex } from "@idenzy/crypto/tokens/random";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import {
  WebauthnCeremony,
  WebauthnChallengeRepository,
} from "@idenzy/persistence/repository/webauthn-challenge-repository";
import { WebauthnCredentialRepository } from "@idenzy/persistence/repository/webauthn-credential-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { finishPasskeyAuthenticationSchema } from "@idenzy/protocol/schemas/webauthn";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { PasskeyCeremony } from "./passkey-ceremony.js";
import { RelyingPartyResolver } from "./relying-party-resolver.js";
import { decodeUserHandle } from "./user-handle.js";

/**
 * Signing in with a passkey (PROJECT.md 4.7).
 *
 * The credential names the user, which is the property that makes this flow usernameless
 * and is also the reason the lookup is the security-critical step. A discoverable
 * credential arrives with an id and a signature and nothing else we can trust; resolving
 * that id inside the tenant, and refusing when it resolves to nothing, is what keeps one
 * project's authenticator from asserting into another's.
 *
 * User verification is required rather than preferred, so a single assertion is a
 * complete authentication and not one factor of two. An authenticator that only proved
 * possession fails verification and never reaches session creation.
 */
@Injectable()
export class PasskeyFlow extends AuthFlow {
  override readonly method = AuthMethod.Passkey;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    actives: ActiveUserMeter,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ceremony: PasskeyCeremony,
    private readonly relyingParties: RelyingPartyResolver,
  ) {
    super(sessions, hooks, audit, mfa, actives);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(finishPasskeyAuthenticationSchema, credentials);
    const rp = await this.relyingParties.resolve(context);
    const tenant = tenantContextFrom(context);
    const challengeId = PublicId.parse(IdPrefix.Challenge, input.challengeId).uuid;

    // The challenge is burnt and the credential is read in one transaction, before any
    // signature is checked. A nonce that survives a failed assertion is one an attacker
    // may keep working against.
    const { claimed, credential } = await this.uow.transaction(async (tx) => ({
      claimed: await new WebauthnChallengeRepository(tx, tenant).claim(
        challengeId,
        this.clock.now(),
      ),
      credential: await new WebauthnCredentialRepository(tx, tenant).findByCredentialId(
        input.response.id,
      ),
    }));

    if (claimed === null || claimed.ceremony !== WebauthnCeremony.Authentication) {
      throw new WebauthnAssertionInvalidError({ detail: { stage: "challenge" } });
    }
    if (claimed.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
    // An unknown credential and a credential belonging to another project are the same
    // answer, because the tenant scope means we cannot tell them apart and should not.
    if (credential === null) {
      throw new WebauthnAssertionInvalidError({ detail: { stage: "credential" } });
    }
    this.assertUserHandleMatches(input.response.response.userHandle, credential.userId);

    const asserted = await this.ceremony.verifyAuthentication(
      rp,
      input.response,
      credential,
      (challenge) => safeCompareHex(hashToken(challenge), claimed.challengeHash),
    );

    return this.establish(context, credential.id, credential.userId, asserted);
  }

  /**
   * The handle the authenticator returned has to be the one we stored for this
   * credential.
   *
   * It decides nothing on its own: the credential id already resolved the user, and this
   * only refuses a response where the two disagree. That combination should be
   * impossible, so treat it as evidence the response was assembled rather than produced,
   * and an absent handle as an authenticator that did not use a discoverable credential.
   */
  private assertUserHandleMatches(handle: string | undefined, userId: string): void {
    if (handle === undefined) return;
    if (decodeUserHandle(handle) !== userId) {
      throw new WebauthnAssertionInvalidError({ detail: { stage: "user_handle" } });
    }
  }

  /**
   * Advances the sign counter and checks the account may sign in.
   *
   * The counter write is not optional and is not deferred. It is the stored half of the
   * clone check: a value that is never written back leaves a comparison that always
   * passes, and a replayed assertion then works forever.
   */
  private establish(
    context: FlowContext,
    credentialId: string,
    userId: string,
    asserted: { readonly signCount: number; readonly backupState: boolean },
  ): Promise<AuthenticatedSubject> {
    const tenant = tenantContextFrom(context);
    return this.uow.transaction(async (tx) => {
      await new WebauthnCredentialRepository(tx, tenant).recordUse(
        credentialId,
        asserted.signCount,
        asserted.backupState,
        this.clock.now(),
      );

      const user = await new UserRepository(tx, tenant).findById(userId);
      if (user === null) {
        throw new InternalError({
          detail: { reason: "a credential outlived its user", userId },
        });
      }
      user.assertCanSignIn(this.clock);
      // User verification is required on this ceremony, so one assertion proved possession
      // and verification together. Reporting the factor age is what stops the gate asking
      // for a code on top of it, and it is what a later step-up is measured against.
      return { userId, amr: [this.method], factorVerifiedAt: this.clock.now() };
    });
  }
}
