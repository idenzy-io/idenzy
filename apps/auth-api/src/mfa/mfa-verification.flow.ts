import { ChallengeInvalidError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import type { MfaChallengeRow } from "@idenzy/persistence/repository/mfa-challenge-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaChallengePurpose } from "@idenzy/protocol/enums/auth";
import { submitMfaSchema } from "@idenzy/protocol/schemas/mfa";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { MfaFactorRegistry } from "./factor-registry.js";
import { MfaChallengeVerifier } from "./mfa-challenge-verifier.js";

/**
 * The second half of a sign-in that stopped at a challenge (PROJECT.md 4.5).
 *
 * An `AuthFlow` like every other way in, and for the usual reason: the session it
 * produces has to be created on the same inherited path, with the same hooks and the
 * same audit ordering. A service that issued one itself would be the flow that quietly
 * skipped them.
 *
 * Its `method` is `mfa` rather than the factor that ran, because which factor ran is not
 * known until the proof is checked. What lands on the session is the `amr` this flow
 * returns: what the first factor proved, what the second proved, and RFC 8176's `mfa`
 * saying there were two.
 */
@Injectable()
export class MfaVerificationFlow extends AuthFlow {
  override readonly method = AuthMethod.Mfa;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    actives: ActiveUserMeter,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly factors: MfaFactorRegistry,
    private readonly challenges: MfaChallengeVerifier,
  ) {
    super(sessions, hooks, audit, mfa, actives);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(submitMfaSchema, credentials);
    const purpose = MfaChallengePurpose.SignIn;

    const challenge = await this.challenges.load(context, input.challengeId, [purpose]);
    const proved = await this.challenges.prove(
      context,
      challenge,
      this.factors.byType(purpose, input.factor),
      input,
    );
    return this.establish(context, challenge, proved);
  }

  /**
   * Spends the challenge and names the subject.
   *
   * The consumption is what stops one proved factor minting two sessions. The ban check
   * is here rather than where the challenge was minted, so a ban applied between the two
   * takes effect.
   */
  private async establish(
    context: FlowContext,
    challenge: MfaChallengeRow,
    proved: AuthMethod,
  ): Promise<AuthenticatedSubject> {
    await this.challenges.consume(context, challenge.id);

    const tenant = tenantContextFrom(context);
    const user = await this.uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findById(challenge.userId),
    );
    if (user === null) throw new ChallengeInvalidError();
    user.assertCanSignIn(this.clock);

    return {
      userId: user.id,
      amr: [...challenge.amr.filter(isAuthMethod), proved, AuthMethod.Mfa],
      factorVerifiedAt: this.clock.now(),
    };
  }
}

const METHODS = new Set<string>(Object.values(AuthMethod));

/** Narrowed rather than cast: the column is text and only real methods reach a claim. */
function isAuthMethod(value: string): value is AuthMethod {
  return METHODS.has(value);
}
