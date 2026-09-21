import { Clock } from "@idenzy/core/time/clock";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import type { FlowAudit, FlowHooks, MfaGate } from "@idenzy/domain/ports/auth-flow";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { Inject, Injectable } from "@nestjs/common";
import { AuthCodeExchangeFlow } from "../flows/auth-code-exchange.flow.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";

/**
 * Redeeming the code a magic-link redirect delivered (PROJECT.md 4.7).
 *
 * Everything about the exchange is inherited. All this class contributes is which method
 * the code must have been minted for, which is exactly the amount a second
 * implementation of one idea should contribute.
 */
@Injectable()
export class MagicLinkFlow extends AuthCodeExchangeFlow {
  override readonly method = AuthMethod.MagicLink;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    actives: ActiveUserMeter,
    uow: UnitOfWork,
    clock: Clock,
  ) {
    super(sessions, hooks, audit, mfa, actives, uow, clock);
  }
}
