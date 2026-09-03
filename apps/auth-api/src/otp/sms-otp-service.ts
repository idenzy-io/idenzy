import { AppConfig } from "@idenzy/config/app-config";
import { Clock } from "@idenzy/core/time/clock";
import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { generateNumericOtp, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { OtpChallengeRepository } from "@idenzy/persistence/repository/otp-challenge-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel, TemplateType } from "@idenzy/protocol/enums/delivery";
import type { ChallengeStarted } from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";
import { Texter } from "../delivery/texter.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Starts an SMS OTP challenge (PROJECT.md 4.7, 4.8).
 *
 * The email twin of this class, with one difference that is not cosmetic: the challenge
 * row is written before the message is sent, and the send is what may be refused. Every
 * fraud control lives inside the provider's own `send`, so a refused number leaves a
 * challenge nobody can answer and costs nothing. Writing the row afterwards would mean
 * doing the expensive part first.
 *
 * Like email, the answer is the same whether or not an account exists, and that costs
 * nothing because there is no branch: an unknown number gets a real code and verifying
 * it creates the account.
 */
@Injectable()
export class SmsOtpService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly encryptor: FieldEncryptor,
    private readonly texter: Texter,
    private readonly config: AppConfig,
  ) {}

  async start(context: FlowContext, phone: E164PhoneNumber): Promise<ChallengeStarted> {
    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("OTP_TTL_SECONDS");
    const expiresAt = this.clock.inSeconds(ttl);

    const code = generateNumericOtp();
    const codeHash = await this.hasher.hash(code);
    const targetHash = hashToken(phone.value);

    const challengeId = await this.uow.run(tenant, async (tx) => {
      const challenges = new OtpChallengeRepository(tx, tenant);
      await challenges.invalidateOutstanding(Channel.Sms, targetHash, this.clock.now());
      return challenges.create({
        channel: Channel.Sms,
        targetHash,
        targetEncrypted: this.encryptor.encrypt(phone.value, context.projectId),
        codeHash: codeHash.hash,
        flowId: context.requestId,
        expiresAt,
      });
    });

    // Sent after the row commits, for the reason the email service gives, and refused
    // here rather than earlier: the fraud guard and the spend cap are inside the send.
    await this.texter.deliver(context, TemplateType.SmsOtp, phone, {
      otp: code,
      expiresInSeconds: ttl,
    });

    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, challengeId).value,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
