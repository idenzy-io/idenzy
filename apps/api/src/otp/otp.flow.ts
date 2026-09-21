import {
  ChallengeAttemptsExhaustedError,
  ChallengeExpiredError,
  ChallengeInvalidError,
} from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import type { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import {
  MAX_OTP_ATTEMPTS,
  OtpChallengeRepository,
} from "@idenzy/persistence/repository/otp-challenge-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { Transaction, UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { verifyOtpSchema } from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { parseOrThrow } from "../common/parse.js";
import type { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Completing a one-time-code challenge, whatever carried it (PROJECT.md 4.7).
 *
 * Written once for both channels because none of it is channel-specific: a code is a
 * code, the attempt cap is the same cap, and the one-shot consumption is the same
 * statement. What differs is which column of `users` the proven target lands in, which
 * is the single method a subclass supplies.
 *
 * The attempt counter is written outside the transaction that would issue the session,
 * and that ordering is the point rather than an accident: a wrong guess must persist
 * even though the request fails, or the cap of five never advances and an attacker walks
 * the whole six-digit keyspace.
 */
export abstract class OtpFlow extends AuthFlow {
  protected constructor(
    sessions: SessionService,
    hooks: FlowHooks,
    audit: FlowAudit,
    mfa: MfaGate,
    actives: ActiveUserMeter,
    protected readonly uow: UnitOfWork,
    protected readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly encryptor: FieldEncryptor,
  ) {
    super(sessions, hooks, audit, mfa, actives);
  }

  /**
   * The channel this flow is the one for.
   *
   * Checked against the challenge's own column, so a challenge handed to the wrong flow
   * is refused rather than resolved. Without it a phone number reaches `findByEmail`,
   * misses, and creates an account with a phone number in the email column, on a valid
   * code: the caller proved nothing wrong, the dispatch did.
   */
  protected abstract readonly channel: string;

  /**
   * Turn a proven target into a subject, creating the account if it has none.
   *
   * Runs inside the transaction that consumed the challenge, and is handed that
   * transaction rather than a repository, because a channel may have more to record than
   * a user row: an SMS verification is also the denominator of the ratio the fraud guard
   * reads.
   */
  protected abstract resolveSubject(
    tx: Transaction,
    tenant: TenantContext,
    target: string,
  ): Promise<AuthenticatedSubject>;

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(verifyOtpSchema, credentials);
    const challengeId = PublicId.parse(IdPrefix.Challenge, input.challengeId).uuid;
    const tenant = tenantContextFrom(context);

    const challenge = await this.uow.transaction((tx) =>
      new OtpChallengeRepository(tx, tenant).findById(challengeId),
    );
    // One error for "no such challenge" and "already used", so a challenge id cannot be
    // probed to learn whether it was ever real.
    if (challenge === null || challenge.consumedAt !== null) throw new ChallengeInvalidError();
    if (challenge.channel !== this.channel) throw new ChallengeInvalidError();
    if (challenge.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
    if (challenge.attempts >= MAX_OTP_ATTEMPTS) throw new ChallengeAttemptsExhaustedError();

    if (!(await this.hasher.verify(challenge.codeHash, input.code))) {
      await this.countFailure(context, challengeId);
    }

    const target = this.encryptor.decrypt(challenge.targetEncrypted, context.projectId);
    return this.establish(context, challengeId, target);
  }

  /** Always throws. Separated so the caller reads as "a wrong code costs an attempt". */
  private async countFailure(context: FlowContext, challengeId: string): Promise<never> {
    const tenant = tenantContextFrom(context);
    const attempts = await this.uow.transaction((tx) =>
      new OtpChallengeRepository(tx, tenant).recordAttempt(challengeId),
    );
    throw attempts >= MAX_OTP_ATTEMPTS
      ? new ChallengeAttemptsExhaustedError()
      : new ChallengeInvalidError();
  }

  /**
   * Consumes the challenge and resolves the subject in one transaction, so a code cannot
   * mint two sessions: the second attempt loses the `consumed_at is null` update and is
   * told the challenge is invalid, which by then it is.
   */
  private establish(
    context: FlowContext,
    challengeId: string,
    target: string,
  ): Promise<AuthenticatedSubject> {
    const tenant = tenantContextFrom(context);
    return this.uow.transaction(async (tx) => {
      const challenges = new OtpChallengeRepository(tx, tenant);
      if (!(await challenges.consume(challengeId, this.clock.now()))) {
        throw new ChallengeInvalidError();
      }
      return this.resolveSubject(tx, tenant, target);
    });
  }
}
