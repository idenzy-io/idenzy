import type { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import { MfaChallengePurpose, type MfaFactorType } from "@idenzy/protocol/enums/auth";
import { Injectable } from "@nestjs/common";
import { PasskeyFactor } from "./passkey.factor.js";
import { RecoveryCodeFactor } from "./recovery-code.factor.js";
import { TotpFactor } from "./totp.factor.js";

/**
 * Which factors exist, and which of them a given challenge may be answered with.
 *
 * The order is the prompting order, strongest first, and a customer's UI is meant to
 * read it that way: offer the first and put the rest behind "try another way". A passkey
 * leads because it is the only one of the three that phishing cannot carry away.
 *
 * A recovery code answers a sign-in and never a step-up. It is single use and exists for
 * a lost phone, so spending one to confirm an email change spends the wrong thing, and a
 * step-up already has a session, which means there is a cheaper way to ask.
 */
@Injectable()
export class MfaFactorRegistry {
  constructor(
    private readonly passkey: PasskeyFactor,
    private readonly totp: TotpFactor,
    private readonly recovery: RecoveryCodeFactor,
  ) {}

  forPurpose(purpose: MfaChallengePurpose): readonly MfaFactor[] {
    return purpose === MfaChallengePurpose.StepUp
      ? [this.passkey, this.totp]
      : [this.passkey, this.totp, this.recovery];
  }

  /** The passkey factor, for the options call that has to exist before it can be proved. */
  get passkeys(): PasskeyFactor {
    return this.passkey;
  }

  /** The factor a submission named, or null when it may not answer this challenge. */
  byType(purpose: MfaChallengePurpose, type: MfaFactorType): MfaFactor | null {
    return this.forPurpose(purpose).find((factor) => factor.type === type) ?? null;
  }
}
