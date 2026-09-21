import { Clock } from "@idenzy/core/time/clock";
import { hashRecoveryCode } from "@idenzy/crypto/mfa/recovery-codes";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import { MfaRecoveryCodeRepository } from "@idenzy/persistence/repository/mfa-recovery-code-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaFactorType } from "@idenzy/protocol/enums/auth";
import type { MfaProof } from "@idenzy/protocol/schemas/mfa";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * The way back in when the authenticator is gone (PROJECT.md 4.5).
 *
 * Checking and spending are one statement, scoped to the user. Two requests cannot
 * spend one code, and a digest that belongs to somebody else in the same project is not
 * a match here, which matters because a recovery code is compared by value: a lookup on
 * the digest alone would sign the caller in as whoever owned it.
 *
 * It is not offered as a factor for a step-up. Burning a single-use code that exists for
 * a lost phone in order to confirm an email change spends the wrong thing, and a session
 * already exists in that case, so there is a cheaper way to ask.
 */
@Injectable()
export class RecoveryCodeFactor extends MfaFactor {
  override readonly type = MfaFactorType.RecoveryCode;
  override readonly method = AuthMethod.RecoveryCode;
  /**
   * A sheet on its own is not a reason to be challenged: it is what a second factor falls
   * back to, and it only exists because one was enrolled.
   */
  override readonly demandsChallenge = false;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {
    super();
  }

  override async enrolled(context: FlowContext, userId: string): Promise<boolean> {
    const tenant = tenantContextFrom(context);
    const remaining = await this.uow.transaction((tx) =>
      new MfaRecoveryCodeRepository(tx, tenant).countUnused(userId),
    );
    return remaining > 0;
  }

  protected override check(
    context: FlowContext,
    userId: string,
    proof: MfaProof,
  ): Promise<boolean> {
    if (proof.factor !== this.type) return Promise.resolve(false);
    const tenant = tenantContextFrom(context);
    return this.uow.transaction((tx) =>
      new MfaRecoveryCodeRepository(tx, tenant).consume(
        userId,
        hashRecoveryCode(proof.code),
        this.clock.now(),
      ),
    );
  }
}
