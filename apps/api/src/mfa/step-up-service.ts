import { AppConfig } from "@idenzy/config/app-config";
import { ChallengeInvalidError, ReauthenticationRequiredError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import type { FlowContext, IssuedChallenge } from "@idenzy/domain/ports/auth-flow";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaChallengePurpose } from "@idenzy/protocol/enums/auth";
import type { StepUpCompleted, SubmitMfa } from "@idenzy/protocol/schemas/mfa";
import { Injectable } from "@nestjs/common";
import type { SessionPrincipal } from "../session/session.guard.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { MfaFactorRegistry } from "./factor-registry.js";
import { MfaChallengeGate } from "./mfa-challenge-gate.js";
import { MfaChallengeVerifier } from "./mfa-challenge-verifier.js";

/**
 * Proving a factor again, inside a session that already exists (PROJECT.md 4.5).
 *
 * Its own thing rather than a second sign-in, because the answer is different: nothing
 * is created, a session's factor age moves and a fresh access token carries the new
 * `fva`. No refresh token is reissued, since rotating the credential that mints tokens
 * for a check that only reads would be a rotation nobody asked for.
 *
 * A recovery code cannot answer one. It is single use and exists for a lost phone, and
 * spending one to confirm an email change spends the wrong thing; the registry is what
 * enforces that, so the rule holds for anything else that asks for a step-up later.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly gate: MfaChallengeGate,
    private readonly factors: MfaFactorRegistry,
    private readonly challenges: MfaChallengeVerifier,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Refuses an action that needs a recently proved factor.
   *
   * A user with nothing enrolled passes, and that is deliberate rather than a hole: a
   * step-up asks for something the caller holds, and somebody who holds nothing can
   * never satisfy it, so demanding one would lock them out of changing their own address
   * for ever. What it does mean is that this check is worth exactly as much as the second
   * factor behind it, which is the honest shape of the guarantee.
   *
   * Called from the service performing the action rather than from a guard. A guard would
   * have to run after `SessionGuard`, and getting that order wrong is a silent bypass
   * rather than a loud failure; here the check reads in the method that does the thing.
   */
  async assertRecent(context: FlowContext, principal: SessionPrincipal): Promise<void> {
    const maxAgeMs = this.config.get("STEP_UP_MAX_AGE_SECONDS") * 1000;
    const verifiedAt = principal.factorVerifiedAt;
    if (verifiedAt !== null && this.clock.nowMs() - verifiedAt.getTime() <= maxAgeMs) return;

    for (const factor of this.factors.forPurpose(MfaChallengePurpose.StepUp)) {
      if (await factor.enrolled(context, principal.userId)) {
        throw new ReauthenticationRequiredError({
          detail: { userId: principal.userId, reason: "no recent factor verification" },
        });
      }
    }
  }

  /**
   * Starts a challenge pinned to the caller's own session.
   *
   * Null when there is nothing to ask for, which the controller answers as 204: a client
   * that got null and then retried the action will find it goes through, because
   * `assertRecent` lets the same user past for the same reason.
   */
  start(context: FlowContext, principal: SessionPrincipal): Promise<IssuedChallenge | null> {
    return this.gate.issue(
      context,
      principal.userId,
      MfaChallengePurpose.StepUp,
      principal.sessionId,
      [],
    );
  }

  /**
   * Completes one, and moves the session's factor age.
   *
   * The challenge is checked against the caller's own session as well as their user id.
   * Pinning both is what stops a challenge minted in one session from raising the factor
   * age of another, which would let a device that never proved anything inherit a proof
   * made somewhere else.
   */
  async complete(
    context: FlowContext,
    principal: SessionPrincipal,
    input: SubmitMfa,
  ): Promise<StepUpCompleted> {
    const purpose = MfaChallengePurpose.StepUp;
    const challenge = await this.challenges.load(context, input.challengeId, [purpose]);
    if (challenge.userId !== principal.userId || challenge.sessionId !== principal.sessionId) {
      throw new ChallengeInvalidError();
    }

    const proved = await this.challenges.prove(
      context,
      challenge,
      this.factors.byType(purpose, input.factor),
      input,
    );
    await this.challenges.consume(context, challenge.id);

    const tenant = tenantContextFrom(context);
    const at = this.clock.now();
    const amr = [...principal.amr.filter(isAuthMethod), proved, AuthMethod.Mfa];
    // The user is loaded in the same transaction that records the proof, because the
    // project's claim template renders from it and reading it afterwards would be a second
    // round trip for a row this statement already had to touch.
    const { recorded, user } = await this.uow.transaction(async (tx) => ({
      recorded: await new SessionRepository(tx, tenant).recordFactorVerification(
        principal.sessionId,
        principal.userId,
        at,
        dedupe(amr),
      ),
      user: await new UserRepository(tx, tenant).findById(principal.userId),
    }));
    if (!recorded || user === null) throw new ChallengeInvalidError();

    const access = await this.sessions.mintAccessToken(
      tenant,
      user,
      principal.sessionId,
      dedupe(amr),
      at,
    );
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      factorVerifiedAt: at.toISOString(),
    };
  }
}

const METHODS = new Set<string>(Object.values(AuthMethod));

function isAuthMethod(value: string): value is AuthMethod {
  return METHODS.has(value);
}

/** A second step-up in one session must not append `mfa` and the factor twice. */
function dedupe(amr: readonly AuthMethod[]): readonly AuthMethod[] {
  return [...new Set(amr)];
}
