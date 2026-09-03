import {
  ChallengeAttemptsExhaustedError,
  ChallengeExpiredError,
  ChallengeInvalidError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
} from "@idenzy/domain/ports/auth-flow";
import {
  MAX_OTP_ATTEMPTS,
  OtpChallengeRepository,
} from "@idenzy/persistence/repository/otp-challenge-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { verifyOtpSchema } from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Completing an email OTP challenge (PROJECT.md 4.7).
 *
 * It signs in and it signs up, because from the code's point of view those are the same
 * proof: someone read a message we sent to that address. An address with no account gets
 * one, verified, which is the strongest statement we can make about an email and is
 * stronger than what password sign-up produces.
 *
 * The attempt counter is written outside the transaction that would issue the session,
 * and that ordering is the point rather than an accident: a wrong guess must persist
 * even though the request fails, or the cap of five never advances and an attacker walks
 * the whole six-digit keyspace.
 */
@Injectable()
export class EmailOtpFlow extends AuthFlow {
  override readonly method = AuthMethod.EmailOtp;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly encryptor: FieldEncryptor,
  ) {
    super(sessions, hooks, audit);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(verifyOtpSchema, credentials);
    const challengeId = PublicId.parse(IdPrefix.Challenge, input.challengeId).uuid;
    const tenant = tenantContextFrom(context);

    const challenge = await this.uow.run(tenant, (tx) =>
      new OtpChallengeRepository(tx, tenant).findById(challengeId),
    );
    // One error for "no such challenge" and "already used", so a challenge id cannot be
    // probed to learn whether it was ever real.
    if (challenge === null || challenge.consumedAt !== null) throw new ChallengeInvalidError();
    if (challenge.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
    if (challenge.attempts >= MAX_OTP_ATTEMPTS) throw new ChallengeAttemptsExhaustedError();

    if (!(await this.hasher.verify(challenge.codeHash, input.code))) {
      await this.countFailure(context, challengeId);
    }

    const email = this.encryptor.decrypt(challenge.targetEncrypted, context.projectId);
    return this.establish(context, challengeId, email);
  }

  /** Always throws. Separated so the caller reads as "a wrong code costs an attempt". */
  private async countFailure(context: FlowContext, challengeId: string): Promise<never> {
    const tenant = tenantContextFrom(context);
    const attempts = await this.uow.run(tenant, (tx) =>
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
    email: string,
  ): Promise<AuthenticatedSubject> {
    const tenant = tenantContextFrom(context);
    return this.uow.run(tenant, async (tx) => {
      const challenges = new OtpChallengeRepository(tx, tenant);
      if (!(await challenges.consume(challengeId, this.clock.now()))) {
        throw new ChallengeInvalidError();
      }

      const users = new UserRepository(tx, tenant);
      const existing = await users.findByEmail(email);
      if (existing === null) {
        const created = await users.create({
          email,
          // Verified, and this is the one place that word is fully earned: they read a
          // message we sent to the address a moment ago.
          emailVerified: true,
          phone: null,
          passwordHash: null,
          passwordAlgoVersion: null,
          displayName: null,
          avatarUrl: null,
        });
        return { userId: created.id, amr: [this.method], requiresMfa: false };
      }

      existing.assertCanSignIn(this.clock);
      if (!existing.emailVerified) await users.setEmailVerified(existing.id, true);
      return { userId: existing.id, amr: [this.method], requiresMfa: false };
    });
  }
}
