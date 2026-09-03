import { Clock } from "@idenzy/core/time/clock";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Totp } from "@idenzy/crypto/mfa/totp";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import { MfaFactorRepository } from "@idenzy/persistence/repository/mfa-factor-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod, MfaFactorType } from "@idenzy/protocol/enums/auth";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * An authenticator app (RFC 6238).
 *
 * The secret is encrypted rather than hashed, and that is forced rather than chosen: we
 * are the party that computes the expected code, so there is nothing to compare a digest
 * against. It is the same position we are in with an OAuth PKCE verifier and the
 * opposite of every code a user presents to us.
 *
 * The step a code came from is written back, so the same code cannot be presented twice
 * inside its own thirty seconds. Without that a code read over a shoulder, or off a
 * screen share, stays good for as long as it is displayed.
 */
@Injectable()
export class TotpFactor extends MfaFactor {
  override readonly type = MfaFactorType.Totp;
  override readonly method = AuthMethod.Totp;

  private readonly totp: Totp;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly encryptor: FieldEncryptor,
    private readonly clock: Clock,
  ) {
    super();
    this.totp = new Totp(clock);
  }

  override async enrolled(context: FlowContext, userId: string): Promise<boolean> {
    const tenant = tenantContextFrom(context);
    const factors = await this.uow.run(tenant, (tx) =>
      new MfaFactorRepository(tx, tenant).listVerified(userId),
    );
    return factors.some((factor) => factor.type === this.type);
  }

  protected override check(context: FlowContext, userId: string, proof: string): Promise<boolean> {
    const tenant = tenantContextFrom(context);
    return this.uow.run(tenant, async (tx) => {
      const factors = new MfaFactorRepository(tx, tenant);
      const enrolled = (await factors.listVerified(userId)).find(
        (factor) => factor.type === this.type,
      );
      if (enrolled === undefined || enrolled.secretEncrypted === null) return false;

      const secret = this.encryptor.decrypt(enrolled.secretEncrypted, context.projectId);
      const step = this.totp.verify(secret, proof.trim(), enrolled.counter);
      if (step === null) return false;

      await factors.recordUse(enrolled.id, this.clock.now(), step);
      return true;
    });
  }
}
