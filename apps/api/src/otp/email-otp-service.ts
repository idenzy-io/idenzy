import { AppConfig } from "@idenzy/config/app-config";
import { SignInMethodDisabledError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
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
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { Mailer } from "../delivery/mailer.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Starts an email OTP challenge (PROJECT.md 4.7).
 *
 * The response is identical whether or not an account exists, and that costs nothing
 * here because it is not a pretence: an address with no account gets a real code, and
 * verifying it creates the account. There is no branch to leak, which is a better answer
 * than a branch carefully made to look the same.
 *
 * Issuing retires any earlier live code for the address, so pressing "resend" three
 * times leaves one working code rather than three.
 */
@Injectable()
export class EmailOtpService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly encryptor: FieldEncryptor,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
    private readonly settings: ProjectSettingsReader,
  ) {}

  async start(context: FlowContext, email: string): Promise<ChallengeStarted> {
    // Before a code is generated, hashed or sent: a channel the project switched off must
    // not cost us an Argon2 run and an email to find that out.
    const channel = (await this.settings.for(context)).otp.email;
    if (!channel.enabled) throw new SignInMethodDisabledError({ detail: { method: "email_otp" } });

    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("OTP_TTL_SECONDS");
    const expiresAt = this.clock.inSeconds(ttl);

    const code = generateNumericOtp();
    const codeHash = await this.hasher.hash(code);
    const targetHash = hashToken(email);

    const challengeId = await this.uow.transaction(async (tx) => {
      const challenges = new OtpChallengeRepository(tx, tenant);
      await challenges.invalidateOutstanding(Channel.Email, targetHash, this.clock.now());
      return challenges.create({
        channel: Channel.Email,
        targetHash,
        targetEncrypted: this.encryptor.encrypt(email, context.projectId),
        codeHash: codeHash.hash,
        // Provenance rather than a second factor: it records which request minted this
        // code, so an abuse investigation can tie a challenge to the call that made it.
        flowId: context.requestId,
        expiresAt,
      });
    });

    // Sent after the row commits. The other order can deliver a code for a challenge
    // that rolled back, which is a user staring at a valid-looking code that never works.
    await this.mailer.deliver(context, TemplateType.EmailOtp, email, {
      otp: code,
      expiresInSeconds: ttl,
    });

    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, challengeId).value,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
