import { ChallengeInvalidError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { FlowContext, IssuedSession } from "@idenzy/domain/ports/auth-flow";
import { OtpChallengeRepository } from "@idenzy/persistence/repository/otp-challenge-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { type VerifyOtp, verifyOtpSchema } from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { EmailOtpFlow } from "./email-otp.flow.js";
import { SmsOtpFlow } from "./sms-otp.flow.js";

/**
 * Sends a code to the flow that issued it.
 *
 * The channel comes from the row rather than from the request. A client that had to name
 * it could name a different one, and the schema has no field for it precisely so that it
 * cannot: a challenge id already identifies everything about the challenge.
 *
 * The extra read is one indexed lookup of one column, and it buys the property that a
 * flow only ever sees challenges of its own channel. Each flow checks that again for
 * itself, because this dispatch is a convenience and that check is a guarantee.
 */
@Injectable()
export class OtpVerification {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly email: EmailOtpFlow,
    private readonly sms: SmsOtpFlow,
  ) {}

  async authenticate(context: FlowContext, credentials: VerifyOtp): Promise<IssuedSession> {
    const input = parseOrThrow(verifyOtpSchema, credentials);
    const challengeId = PublicId.parse(IdPrefix.Challenge, input.challengeId).uuid;
    const tenant = tenantContextFrom(context);

    const channel = await this.uow.run(tenant, (tx) =>
      new OtpChallengeRepository(tx, tenant).channelOf(challengeId),
    );
    // An unknown id and a used one answer the same way here as they do inside a flow, so
    // dispatch is not a place to learn whether a challenge was ever real.
    if (channel === null) throw new ChallengeInvalidError();

    return channel === Channel.Sms
      ? this.sms.authenticate(context, credentials)
      : this.email.authenticate(context, credentials);
  }
}
