import {
  ChallengeAttemptsExhaustedError,
  ChallengeExpiredError,
  ChallengeInvalidError,
  MfaFactorInvalidError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import type { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import {
  MAX_MFA_ATTEMPTS,
  MfaChallengeRepository,
  type MfaChallengeRow,
} from "@idenzy/persistence/repository/mfa-challenge-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { AuthMethod, MfaChallengePurpose } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { MfaProof } from "@idenzy/protocol/schemas/mfa";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Reading, proving and spending a second-factor challenge (PROJECT.md 4.5).
 *
 * Its own collaborator because two things complete a challenge and they must do it the
 * same way: a sign-in, which ends in a session, and a step-up, which ends in a fresh
 * access token for a session that already exists. The half that differs is what happens
 * afterwards; the half that must not differ is the attempt cap, the one-shot
 * consumption, and the refusal that tells a caller nothing.
 */
@Injectable()
export class MfaChallengeVerifier {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * A live challenge of the right purpose, or a refusal.
   *
   * Unknown, spent and minted-for-something-else are one answer, so a challenge id
   * cannot be probed to learn whether it was ever real. The purpose check is what stops
   * a step-up challenge, which is minted inside a session the caller already holds, from
   * being spent to create a new one. It takes a list because one caller legitimately
   * accepts both: the passkey options route only reads which user the challenge names.
   */
  async load(
    context: FlowContext,
    publicId: string,
    purposes: readonly MfaChallengePurpose[],
  ): Promise<MfaChallengeRow> {
    const tenant = tenantContextFrom(context);
    const id = PublicId.parse(IdPrefix.Challenge, publicId).uuid;
    const challenge = await this.uow.run(tenant, (tx) =>
      new MfaChallengeRepository(tx, tenant).findById(id),
    );

    if (challenge === null || challenge.consumedAt !== null) throw new ChallengeInvalidError();
    if (!purposes.some((purpose) => purpose === challenge.purpose)) {
      throw new ChallengeInvalidError();
    }
    if (challenge.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
    if (challenge.attempts >= MAX_MFA_ATTEMPTS) throw new ChallengeAttemptsExhaustedError();
    return challenge;
  }

  /**
   * Proves the factor, counting the attempt when it fails.
   *
   * A factor that may not answer this challenge is refused exactly as a wrong code is,
   * and costs an attempt in exactly the same way. Answering "that factor is not offered
   * here" would tell whoever holds a stolen first factor which ones are.
   *
   * The counter is written outside the transaction that would issue anything, which is
   * the ordering `OtpFlow` uses and for the same reason: a wrong guess has to persist
   * even though the request fails, or the cap of five never advances.
   */
  async prove(
    context: FlowContext,
    challenge: MfaChallengeRow,
    factor: MfaFactor | null,
    proof: MfaProof,
  ): Promise<AuthMethod> {
    if (factor === null) return this.countFailure(context, challenge.id);
    try {
      return await factor.prove(context, challenge.userId, proof);
    } catch (error: unknown) {
      if (error instanceof MfaFactorInvalidError) await this.countFailure(context, challenge.id);
      throw error;
    }
  }

  /**
   * Spends the challenge. The loser of a race is told it is invalid, which by then it is.
   *
   * Its own call rather than part of `prove`, because what happens between them differs:
   * a sign-in resolves the user in the same transaction, and a step-up writes the factor
   * age onto a session instead.
   */
  async consume(context: FlowContext, challengeId: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    const spent = await this.uow.run(tenant, (tx) =>
      new MfaChallengeRepository(tx, tenant).consume(challengeId, this.clock.now()),
    );
    if (!spent) throw new ChallengeInvalidError();
  }

  /** Always throws. Separated so the caller reads as "a wrong code costs an attempt". */
  private async countFailure(context: FlowContext, challengeId: string): Promise<never> {
    const tenant = tenantContextFrom(context);
    const attempts = await this.uow.run(tenant, (tx) =>
      new MfaChallengeRepository(tx, tenant).recordAttempt(challengeId),
    );
    throw attempts >= MAX_MFA_ATTEMPTS
      ? new ChallengeAttemptsExhaustedError()
      : new MfaFactorInvalidError();
  }
}
