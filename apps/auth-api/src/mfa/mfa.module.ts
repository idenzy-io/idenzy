import { Global, Module } from "@nestjs/common";
import { MFA_GATE } from "../flows/flow-tokens.js";
import { SessionModule } from "../session/session.module.js";
import { MfaFactorRegistry } from "./factor-registry.js";
import { MfaController } from "./mfa.controller.js";
import { MfaChallengeGate } from "./mfa-challenge-gate.js";
import { MfaChallengeVerifier } from "./mfa-challenge-verifier.js";
import { MfaEnrolmentService } from "./mfa-enrolment-service.js";
import { MfaVerificationFlow } from "./mfa-verification.flow.js";
import { RecoveryCodeFactor } from "./recovery-code.factor.js";
import { StepUpService } from "./step-up-service.js";
import { TotpFactor } from "./totp.factor.js";

/**
 * Second factors (PROJECT.md 4.5, 9.2 MfaModule).
 *
 * Global, and for the same reason `FlowsModule` is: every `AuthFlow` in the system takes
 * the gate, so a flow that could be constructed without one would be a flow that signs a
 * user in on one factor. The token is bound here rather than beside the other two flow
 * ports because the only implementation needs the factor registry.
 *
 * The registry is what is exported, never the factors themselves. A caller holding a
 * bare `TotpFactor` is a caller that can offer a recovery code where one must not be
 * offered.
 */
@Global()
@Module({
  imports: [SessionModule],
  controllers: [MfaController],
  providers: [
    TotpFactor,
    RecoveryCodeFactor,
    MfaFactorRegistry,
    MfaChallengeGate,
    { provide: MFA_GATE, useExisting: MfaChallengeGate },
    MfaChallengeVerifier,
    MfaEnrolmentService,
    MfaVerificationFlow,
    StepUpService,
  ],
  exports: [MFA_GATE, MfaChallengeGate, MfaFactorRegistry, MfaEnrolmentService, StepUpService],
})
export class MfaModule {}
