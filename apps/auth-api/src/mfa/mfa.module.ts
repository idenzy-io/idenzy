import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { MfaFactorRegistry } from "./factor-registry.js";
import { MfaController } from "./mfa.controller.js";
import { MfaEnrolmentService } from "./mfa-enrolment-service.js";
import { RecoveryCodeFactor } from "./recovery-code.factor.js";
import { TotpFactor } from "./totp.factor.js";

/**
 * Second factors (PROJECT.md 4.5, 9.2 MfaModule).
 *
 * The registry is exported rather than the factors themselves, so the thing that asks
 * "what does this user owe" gets the ordering and the per-purpose rules with it. A caller
 * holding a bare `TotpFactor` would be a caller that could offer a recovery code where
 * one must not be offered.
 */
@Module({
  imports: [SessionModule],
  controllers: [MfaController],
  providers: [TotpFactor, RecoveryCodeFactor, MfaFactorRegistry, MfaEnrolmentService],
  exports: [MfaFactorRegistry, MfaEnrolmentService],
})
export class MfaModule {}
