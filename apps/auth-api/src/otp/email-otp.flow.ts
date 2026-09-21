import { Clock } from "@idenzy/core/time/clock";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import type {
  AuthenticatedSubject,
  FlowAudit,
  FlowHooks,
  MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { CellTx } from "@idenzy/persistence/tenancy/unit-of-work";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { Inject, Injectable } from "@nestjs/common";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { OtpFlow } from "./otp.flow.js";

/**
 * Completing an email OTP challenge (PROJECT.md 4.7).
 *
 * It signs in and it signs up, because from the code's point of view those are the same
 * proof: someone read a message we sent to that address. An address with no account gets
 * one, verified, which is the strongest statement we can make about an email and is
 * stronger than what password sign-up produces.
 */
@Injectable()
export class EmailOtpFlow extends OtpFlow {
  override readonly method = AuthMethod.EmailOtp;
  protected override readonly channel = Channel.Email;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    actives: ActiveUserMeter,
    uow: UnitOfWork,
    clock: Clock,
    hasher: PasswordHasher,
    encryptor: FieldEncryptor,
  ) {
    super(sessions, hooks, audit, mfa, actives, uow, clock, hasher, encryptor);
  }

  protected override async resolveSubject(
    tx: CellTx,
    tenant: TenantContext,
    email: string,
  ): Promise<AuthenticatedSubject> {
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
      return { userId: created.id, amr: [this.method], factorVerifiedAt: null };
    }

    existing.assertCanSignIn(this.clock);
    if (!existing.emailVerified) await users.setEmailVerified(existing.id, true);
    return { userId: existing.id, amr: [this.method], factorVerifiedAt: null };
  }
}
