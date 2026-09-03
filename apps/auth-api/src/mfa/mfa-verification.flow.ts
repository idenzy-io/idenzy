import {
  ChallengeAttemptsExhaustedError,
  ChallengeExpiredError,
  ChallengeInvalidError,
  MfaFactorInvalidError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import type { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import {
  MAX_MFA_ATTEMPTS,
  MfaChallengeRepository,
  type MfaChallengeRow,
} from "@idenzy/persistence/repository/mfa-challenge-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaChallengePurpose } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { submitMfaSchema } from "@idenzy/protocol/schemas/mfa";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { MfaFactorRegistry } from "./factor-registry.js";

/**
 * The second half of a sign-in that stopped at a challenge (PROJECT.md 4.5).
 *
 * An `AuthFlow` like every other way in, and for the usual reason: the session it
 * produces has to be created on the same inherited path, with the same hooks and the
 * same audit ordering. A service that issued one itself would be the flow that quietly
 * skipped them.
 *
 * Its `method` is `mfa` rather than the factor that ran, because the factor is not known
 * until the proof is checked. What actually lands on the session is the `amr` this flow
 * returns: what the first factor proved, what the second proved, and RFC 8176's `mfa`
 * saying there were two.
 *
 * The attempt is counted outside the transaction that would issue the session, which is
 * the same ordering `OtpFlow` uses and for the same reason: a wrong guess has to persist
 * even though the request fails, or the cap of five never advances and a six-digit code
 * is a keyspace an attacker walks.
 */
@Injectable()
export class MfaVerificationFlow extends AuthFlow {
  override readonly method = AuthMethod.Mfa;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly factors: MfaFactorRegistry,
  ) {
    super(sessions, hooks, audit, mfa);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(submitMfaSchema, credentials);
    const challenge = await this.load(context, input.challengeId, MfaChallengePurpose.SignIn);

    const factor = this.factors.byType(MfaChallengePurpose.SignIn, input.factor);
    const proved = await this.prove(context, challenge, factor, input.code);

    return this.establish(context, challenge, proved);
  }

  /**
   * Reads a challenge and refuses everything that is not a live one of the right purpose.
   *
   * Unknown, spent and minted-for-something-else are one answer, so a challenge id
   * cannot be probed to learn whether it was ever real. The purpose check is what stops a
   * step-up challenge, which is minted inside a session the caller already holds, from
   * being spent to create a new one.
   */
  protected async load(
    context: FlowContext,
    publicId: string,
    purpose: MfaChallengePurpose,
  ): Promise<MfaChallengeRow> {
    const tenant = tenantContextFrom(context);
    const id = PublicId.parse(IdPrefix.Challenge, publicId).uuid;
    const challenge = await this.uow.run(tenant, (tx) =>
      new MfaChallengeRepository(tx, tenant).findById(id),
    );

    if (challenge === null || challenge.consumedAt !== null) throw new ChallengeInvalidError();
    if (challenge.purpose !== purpose) throw new ChallengeInvalidError();
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
   */
  protected async prove(
    context: FlowContext,
    challenge: MfaChallengeRow,
    factor: MfaFactor | null,
    code: string,
  ): Promise<AuthMethod> {
    if (factor === null) return this.countFailure(context, challenge.id);
    try {
      return await factor.prove(context, challenge.userId, code);
    } catch (error: unknown) {
      if (error instanceof MfaFactorInvalidError) await this.countFailure(context, challenge.id);
      throw error;
    }
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

  /**
   * Spends the challenge and names the subject, in one transaction.
   *
   * The consumption is what stops one proved factor minting two sessions: the second
   * attempt loses the `consumed_at is null` update and is told the challenge is invalid,
   * which by then it is. The ban check is here rather than where the challenge was minted
   * so a ban applied between the two takes effect.
   */
  private establish(
    context: FlowContext,
    challenge: MfaChallengeRow,
    proved: AuthMethod,
  ): Promise<AuthenticatedSubject> {
    const tenant = tenantContextFrom(context);
    const now = this.clock.now();
    return this.uow.run(tenant, async (tx) => {
      if (!(await new MfaChallengeRepository(tx, tenant).consume(challenge.id, now))) {
        throw new ChallengeInvalidError();
      }
      const user = await new UserRepository(tx, tenant).findById(challenge.userId);
      if (user === null) throw new ChallengeInvalidError();
      user.assertCanSignIn(this.clock);

      return {
        userId: user.id,
        amr: [...challenge.amr.filter(isAuthMethod), proved, AuthMethod.Mfa],
        factorVerifiedAt: now,
      };
    });
  }
}

const METHODS = new Set<string>(Object.values(AuthMethod));

/** Narrowed rather than cast: the column is text and only real methods reach a claim. */
function isAuthMethod(value: string): value is AuthMethod {
  return METHODS.has(value);
}
