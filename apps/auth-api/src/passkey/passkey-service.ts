import { AppConfig } from "@idenzy/config/app-config";
import {
  ChallengeExpiredError,
  ResourceNotFoundError,
  SignInMethodDisabledError,
  WebauthnAssertionInvalidError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken, safeCompareHex } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import {
  WebauthnCeremony,
  WebauthnChallengeRepository,
} from "@idenzy/persistence/repository/webauthn-challenge-repository";
import {
  WebauthnCredentialRepository,
  type WebauthnCredentialRow,
} from "@idenzy/persistence/repository/webauthn-credential-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type {
  FinishPasskeyRegistration,
  Passkey,
  PasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
} from "@idenzy/protocol/schemas/webauthn";
import { Injectable } from "@nestjs/common";
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { PasskeyCeremony } from "./passkey-ceremony.js";
import { RelyingPartyResolver } from "./relying-party-resolver.js";
import { encodeUserHandle } from "./user-handle.js";

/**
 * Enrolling and managing passkeys (PROJECT.md 4.7).
 *
 * Registration happens inside a session and always has: a passkey is a credential added
 * to an account that already exists, and the account was established by whatever proved
 * the address in the first place. Sign-up straight into a passkey would mean creating a
 * user whose only identifier is a credential nobody can recover, which is a support
 * problem dressed as a feature.
 *
 * Signing in with one is not here. That is `PasskeyFlow`, because it ends in a session
 * and everything that ends in a session goes through `AuthFlow` (PROJECT.md 9.5).
 */
@Injectable()
export class PasskeyService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly ceremony: PasskeyCeremony,
    private readonly relyingParties: RelyingPartyResolver,
    private readonly settings: ProjectSettingsReader,
  ) {}

  /**
   * Options for enrolling a new passkey on the signed-in account.
   *
   * The existing credentials go out as `excludeCredentials`, which is the one place a
   * WebAuthn endpoint of ours names credentials at all. It enumerates nothing: the
   * caller is holding a session for the account whose credentials they are being told
   * about.
   */
  async startRegistration(
    context: FlowContext,
    userId: string,
  ): Promise<PasskeyRegistrationOptions> {
    const rp = await this.relyingParties.resolve(context);
    const tenant = tenantContextFrom(context);
    const challenge = generateOpaqueToken();
    const expiresAt = this.clock.inSeconds(this.ttlSeconds());

    const { challengeId, publicKey } = await this.uow.run(tenant, async (tx) => {
      const users = new UserRepository(tx, tenant);
      const user = await users.findById(userId);
      if (user === null) throw new ResourceNotFoundError({ detail: { entity: "user" } });

      const existing = await new WebauthnCredentialRepository(tx, tenant).listForUser(userId);
      const id = await new WebauthnChallengeRepository(tx, tenant).create({
        ceremony: WebauthnCeremony.Registration,
        challengeHash: hashToken(challenge),
        // Pinned to the account the ceremony may enrol onto, so a challenge minted in
        // one session cannot attach a credential to a different user.
        userId,
        expiresAt,
      });
      const label = user.email ?? user.publicId;
      return {
        challengeId: id,
        publicKey: this.ceremony.registrationOptions(
          rp,
          {
            userHandle: encodeUserHandle(userId),
            name: label,
            displayName: user.toPublic().displayName ?? label,
          },
          challenge,
          existing,
          this.ttlSeconds() * 1000,
        ),
      };
    });

    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, challengeId).value,
      expiresAt: expiresAt.toISOString(),
      publicKey,
    };
  }

  /**
   * Verifies the attestation and stores the credential.
   *
   * The challenge is claimed before anything is verified, so a failed attestation costs
   * the attempt. The alternative leaves a live nonce for however long the browser is
   * willing to keep trying against it.
   */
  async finishRegistration(
    context: FlowContext,
    userId: string,
    input: FinishPasskeyRegistration,
  ): Promise<Passkey> {
    const rp = await this.relyingParties.resolve(context);
    const tenant = tenantContextFrom(context);
    const challengeId = PublicId.parse(IdPrefix.Challenge, input.challengeId).uuid;

    const claimed = await this.uow.run(tenant, (tx) =>
      new WebauthnChallengeRepository(tx, tenant).claim(challengeId, this.clock.now()),
    );
    if (
      claimed === null ||
      claimed.ceremony !== WebauthnCeremony.Registration ||
      claimed.userId !== userId
    ) {
      throw new WebauthnAssertionInvalidError({ detail: { stage: "challenge" } });
    }
    if (claimed.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();

    const registered = await this.ceremony.verifyRegistration(rp, input.response, (challenge) =>
      safeCompareHex(hashToken(challenge), claimed.challengeHash),
    );

    const stored = await this.uow.run(tenant, (tx) =>
      new WebauthnCredentialRepository(tx, tenant).register({
        userId,
        credentialId: registered.credentialId,
        publicKey: registered.publicKey,
        signCount: registered.signCount,
        transports: registered.transports,
        aaguid: registered.aaguid,
        backupEligible: registered.backupEligible,
        backupState: registered.backupState,
        name: input.name ?? null,
      }),
    );
    return present(stored);
  }

  /** Options for a sign-in that does not yet know whose it is. */
  async startAuthentication(context: FlowContext): Promise<PasskeyAuthenticationOptions> {
    // Refused before a challenge is minted. A project with passkeys off must not hand out
    // a nonce that a later ceremony would then have to refuse, which reads as a broken
    // browser rather than as a setting.
    if (!(await this.settings.for(context)).passkeys.enabled) {
      throw new SignInMethodDisabledError({ detail: { method: "passkey" } });
    }

    const rp = await this.relyingParties.resolve(context);
    const tenant = tenantContextFrom(context);
    const challenge = generateOpaqueToken();
    const expiresAt = this.clock.inSeconds(this.ttlSeconds());

    const challengeId = await this.uow.run(tenant, (tx) =>
      new WebauthnChallengeRepository(tx, tenant).create({
        ceremony: WebauthnCeremony.Authentication,
        challengeHash: hashToken(challenge),
        userId: null,
        expiresAt,
      }),
    );

    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, challengeId).value,
      expiresAt: expiresAt.toISOString(),
      publicKey: this.ceremony.authenticationOptions(rp, challenge, this.ttlSeconds() * 1000),
    };
  }

  async list(context: FlowContext, userId: string): Promise<readonly Passkey[]> {
    const tenant = tenantContextFrom(context);
    const rows = await this.uow.run(tenant, (tx) =>
      new WebauthnCredentialRepository(tx, tenant).listForUser(userId),
    );
    return rows.map(present);
  }

  async rename(
    context: FlowContext,
    userId: string,
    passkeyId: string,
    name: string,
  ): Promise<void> {
    const tenant = tenantContextFrom(context);
    const id = PublicId.parse(IdPrefix.Passkey, passkeyId).uuid;
    const renamed = await this.uow.run(tenant, (tx) =>
      new WebauthnCredentialRepository(tx, tenant).rename(id, userId, name),
    );
    if (!renamed) throw new ResourceNotFoundError({ detail: { entity: "webauthn_credential" } });
  }

  /**
   * Removes a passkey.
   *
   * Scoped to the owner, so somebody else's id answers 404 rather than deleting their
   * credential. That is the same rule session revocation follows, and for the same
   * reason: an authenticated request is not an authorization to touch every row.
   */
  async remove(context: FlowContext, userId: string, passkeyId: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    const id = PublicId.parse(IdPrefix.Passkey, passkeyId).uuid;
    const removed = await this.uow.run(tenant, (tx) =>
      new WebauthnCredentialRepository(tx, tenant).remove(id, userId),
    );
    if (!removed) throw new ResourceNotFoundError({ detail: { entity: "webauthn_credential" } });
  }

  private ttlSeconds(): number {
    return this.config.get("WEBAUTHN_CHALLENGE_TTL_SECONDS");
  }
}

/** The owner's view. The credential id stays out of it, as does the public key. */
function present(row: WebauthnCredentialRow): Passkey {
  return {
    id: PublicId.encode(IdPrefix.Passkey, row.id).value,
    name: row.name,
    transports: [...row.transports],
    backupEligible: row.backupEligible,
    backedUp: row.backupState,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
