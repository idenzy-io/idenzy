import { AppConfig } from "@idenzy/config/app-config";
import { IdenzyError } from "@idenzy/core/errors/idenzy-error";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken, safeCompareHex } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import {
  WebauthnCeremony,
  WebauthnChallengeRepository,
} from "@idenzy/persistence/repository/webauthn-challenge-repository";
import { WebauthnCredentialRepository } from "@idenzy/persistence/repository/webauthn-credential-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaFactorType } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { MfaPasskeyOptions, MfaProof } from "@idenzy/protocol/schemas/mfa";
import { Injectable } from "@nestjs/common";
import { PasskeyCeremony } from "../passkey/passkey-ceremony.js";
import { RelyingPartyResolver } from "../passkey/relying-party-resolver.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * A passkey answering a second-factor challenge (PROJECT.md 3.2).
 *
 * The one factor in the family whose proof is a ceremony rather than a code, which is
 * why it takes two calls: `options` mints the nonce the authenticator signs over, and the
 * assertion comes back naming it.
 *
 * It never demands a challenge. A passkey is a credential somebody enrolled to sign in
 * with, and treating it as a reason to be challenged would mean enrolling one silently
 * changed what every password sign-in on that account does. What it is is a way to answer
 * a challenge something else demanded, and a phishing-resistant one, which is why the
 * registry offers it first.
 *
 * Unlike the ceremony at the door this one names credentials. That is safe here and only
 * here: the caller has already proved a first factor for this account, so
 * `allowCredentials` tells them nothing they did not know, and without it a browser
 * holding keys for several accounts cannot tell which is wanted.
 */
@Injectable()
export class PasskeyFactor extends MfaFactor {
  override readonly type = MfaFactorType.Passkey;
  override readonly method = AuthMethod.Passkey;
  override readonly demandsChallenge = false;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly ceremony: PasskeyCeremony,
    private readonly relyingParties: RelyingPartyResolver,
  ) {
    super();
  }

  override async enrolled(context: FlowContext, userId: string): Promise<boolean> {
    const tenant = tenantContextFrom(context);
    const credentials = await this.uow.run(tenant, (tx) =>
      new WebauthnCredentialRepository(tx, tenant).listForUser(userId),
    );
    return credentials.length > 0;
  }

  /**
   * The ceremony options, pinned to the user the challenge already named.
   *
   * Its own nonce in `webauthn_challenges` under its own ceremony kind, because a nonce
   * minted here must not be spendable at the door: a sign-in challenge names no user and
   * resolves to whoever the credential belongs to, and this one has already decided who
   * is being asked.
   */
  async options(context: FlowContext, userId: string): Promise<MfaPasskeyOptions> {
    const rp = await this.relyingParties.resolve(context);
    const tenant = tenantContextFrom(context);
    const challenge = generateOpaqueToken();
    const ttlSeconds = this.config.get("WEBAUTHN_CHALLENGE_TTL_SECONDS");
    const expiresAt = this.clock.inSeconds(ttlSeconds);

    const { ceremonyId, credentials } = await this.uow.run(tenant, async (tx) => ({
      credentials: await new WebauthnCredentialRepository(tx, tenant).listForUser(userId),
      ceremonyId: await new WebauthnChallengeRepository(tx, tenant).create({
        ceremony: WebauthnCeremony.SecondFactor,
        challengeHash: hashToken(challenge),
        userId,
        expiresAt,
      }),
    }));

    const publicKey = this.ceremony.authenticationOptions(rp, challenge, ttlSeconds * 1000);
    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, ceremonyId).value,
      expiresAt: expiresAt.toISOString(),
      publicKey: {
        ...publicKey,
        allowCredentials: credentials.map((credential) => ({
          id: credential.credentialId,
          type: "public-key" as const,
          ...(credential.transports.length === 0 ? {} : { transports: [...credential.transports] }),
        })),
      },
    };
  }

  /**
   * Claims the nonce, then verifies the assertion against it.
   *
   * Claimed first and unconditionally, as everywhere else a nonce is spent: one burnt only
   * on success is one an attacker can keep signing against. Every failure returns false
   * rather than throwing, including the ones `@simplewebauthn/server` raises, because the
   * base owns the refusal and a distinguishable one here would say which of a wrong
   * account, a stale nonce and a bad signature happened.
   */
  protected override async check(
    context: FlowContext,
    userId: string,
    proof: MfaProof,
  ): Promise<boolean> {
    if (proof.factor !== this.type) return false;
    const rp = await this.relyingParties.resolve(context);
    const tenant = tenantContextFrom(context);
    const ceremonyId = PublicId.parse(IdPrefix.Challenge, proof.ceremonyId).uuid;

    const { claimed, credential } = await this.uow.run(tenant, async (tx) => ({
      claimed: await new WebauthnChallengeRepository(tx, tenant).claim(
        ceremonyId,
        this.clock.now(),
      ),
      credential: await new WebauthnCredentialRepository(tx, tenant).findByCredentialId(
        proof.response.id,
      ),
    }));

    if (claimed === null || claimed.ceremony !== WebauthnCeremony.SecondFactor) return false;
    if (claimed.userId !== userId) return false;
    if (claimed.expiresAt <= this.clock.now()) return false;
    // The credential has to be this user's. Without it a nonce minted for one account
    // could be answered with any passkey in the project, which is the whole check.
    if (credential === null || credential.userId !== userId) return false;

    try {
      const asserted = await this.ceremony.verifyAuthentication(
        rp,
        proof.response,
        credential,
        (value) => safeCompareHex(hashToken(value), claimed.challengeHash),
      );
      await this.uow.run(tenant, (tx) =>
        new WebauthnCredentialRepository(tx, tenant).recordUse(
          credential.id,
          asserted.signCount,
          asserted.backupState,
          this.clock.now(),
        ),
      );
      return true;
    } catch (error: unknown) {
      // Ours are refusals and become the family's one refusal. Anything else is a bug or
      // an outage and must not be reported as a wrong code.
      if (error instanceof IdenzyError) return false;
      throw error;
    }
  }
}
