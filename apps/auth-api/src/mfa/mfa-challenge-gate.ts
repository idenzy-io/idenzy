import { AppConfig } from "@idenzy/config/app-config";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type {
  AuthenticatedSubject,
  FlowContext,
  IssuedChallenge,
  MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import { MfaChallengeRepository } from "@idenzy/persistence/repository/mfa-challenge-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  type AuthMethod,
  MfaChallengePurpose,
  type MfaFactorType,
} from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { MfaFactorRegistry } from "./factor-registry.js";

/**
 * Whether a proved first factor is enough (PROJECT.md 4.5).
 *
 * Three things decide it, and all of them are here rather than in any flow. A subject
 * that already proved a factor age owes nothing, which is what keeps a passkey sign-in
 * from asking for a code on top of a ceremony that was already two factors. A user with
 * nothing enrolled owes nothing, because there is no such thing as a challenge nobody can
 * answer: issuing one would be a sign-in that cannot be completed rather than one that is
 * refused. And a user holding only factors that answer without demanding owes nothing
 * either, which is the difference between a passkey and an authenticator.
 */
@Injectable()
export class MfaChallengeGate implements MfaGate {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly factors: MfaFactorRegistry,
  ) {}

  challengeFor(
    context: FlowContext,
    subject: AuthenticatedSubject,
  ): Promise<IssuedChallenge | null> {
    if (subject.factorVerifiedAt !== null) return Promise.resolve(null);
    return this.issue(context, subject.userId, MfaChallengePurpose.SignIn, null, subject.amr);
  }

  /**
   * Mints a challenge, or answers null when the user holds nothing to answer it with.
   *
   * Shared with step-up, which differs only in what it pins and what a completed
   * challenge produces. The `amr` carried here is what the first factor proved, so the
   * session that comes out of the challenge claims both halves rather than only the
   * second.
   */
  async issue(
    context: FlowContext,
    userId: string,
    purpose: MfaChallengePurpose,
    sessionId: string | null,
    amr: readonly AuthMethod[],
  ): Promise<IssuedChallenge | null> {
    const available: MfaFactorType[] = [];
    let demanded = false;
    for (const factor of this.factors.forPurpose(purpose)) {
      if (!(await factor.enrolled(context, userId))) continue;
      available.push(factor.type);
      demanded ||= factor.demandsChallenge;
    }
    // Something has to demand the challenge, not merely be able to answer one. A passkey
    // is the case this exists for: enrolling one to sign in with must not quietly turn
    // MFA on for the password the account also has.
    if (!demanded || available.length === 0) return null;

    const tenant = tenantContextFrom(context);
    const expiresAt = this.clock.inSeconds(this.config.get("MFA_CHALLENGE_TTL_SECONDS"));
    const challengeId = await this.uow.run(tenant, (tx) =>
      new MfaChallengeRepository(tx, tenant).create({
        userId,
        purpose,
        sessionId,
        amr,
        expiresAt,
      }),
    );

    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, challengeId).value,
      purpose,
      factors: available,
      expiresAt,
    };
  }
}
