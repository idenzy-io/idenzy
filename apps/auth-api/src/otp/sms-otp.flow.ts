import { Clock } from "@idenzy/core/time/clock";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import type { AuthenticatedSubject, FlowAudit, FlowHooks } from "@idenzy/domain/ports/auth-flow";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { Transaction } from "@idenzy/persistence/tenancy/unit-of-work";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { Inject, Injectable } from "@nestjs/common";
import { FLOW_AUDIT, FLOW_HOOKS } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { OtpFlow } from "./otp.flow.js";

/**
 * Completing an SMS OTP challenge (PROJECT.md 4.7).
 *
 * The email flow's twin, and it signs up the same way: a number with no account gets
 * one, phone verified, because somebody read a message we sent to that handset.
 *
 * It also records the verification, which is the half that matters beyond this request.
 * Sends and verifications are what the fraud guard's ratio is built from, and a scheme
 * that has defeated every other control still cannot make anybody type the code in. That
 * counter is only trustworthy if it is written here, in the same transaction that
 * consumed the challenge, rather than anywhere a retry could inflate it.
 */
@Injectable()
export class SmsOtpFlow extends OtpFlow {
  override readonly method = AuthMethod.SmsOtp;
  protected override readonly channel = Channel.Sms;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    uow: UnitOfWork,
    clock: Clock,
    hasher: PasswordHasher,
    encryptor: FieldEncryptor,
  ) {
    super(sessions, hooks, audit, uow, clock, hasher, encryptor);
  }

  protected override async resolveSubject(
    tx: Transaction,
    tenant: TenantContext,
    phone: string,
  ): Promise<AuthenticatedSubject> {
    await new UsageRepository(tx, tenant).recordSmsVerified(this.clock.now());

    const users = new UserRepository(tx, tenant);
    const existing = await users.findByPhone(phone);
    if (existing === null) {
      const created = await users.create({
        email: null,
        emailVerified: false,
        phone,
        phoneVerified: true,
        passwordHash: null,
        passwordAlgoVersion: null,
        displayName: null,
        avatarUrl: null,
      });
      return { userId: created.id, amr: [this.method], requiresMfa: false };
    }

    existing.assertCanSignIn(this.clock);
    if (!existing.phoneVerified) await users.setPhoneVerified(existing.id, true);
    return { userId: existing.id, amr: [this.method], requiresMfa: false };
  }
}
