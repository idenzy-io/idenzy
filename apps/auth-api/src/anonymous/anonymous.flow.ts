import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { Inject, Injectable } from "@nestjs/common";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * A session for someone who has not identified themselves (PROJECT.md 3.1).
 *
 * For a cart, a draft, a game save: state that has to belong to somebody before that
 * somebody has an account. It is an `AuthFlow` like every other, so the session it
 * produces is a real revocable one that appears in the session list and carries `anon`
 * in its amr, which is what lets a customer treat it differently without us guessing how.
 *
 * `verify` creates the row rather than finding it, which is the same shape password
 * sign-up takes: establishing the subject means creating them. There is nothing to check
 * because nothing was claimed, and that is the honest reading of an anonymous session
 * rather than a check that was skipped.
 */
@Injectable()
export class AnonymousFlow extends AuthFlow {
  override readonly method = AuthMethod.Anonymous;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    private readonly uow: UnitOfWork,
  ) {
    super(sessions, hooks, audit, mfa);
  }

  protected override verify(context: FlowContext): Promise<AuthenticatedSubject> {
    const tenant = tenantContextFrom(context);
    return this.uow.run(tenant, async (tx) => {
      const user = await new UserRepository(tx, tenant).create({
        email: null,
        emailVerified: false,
        phone: null,
        passwordHash: null,
        passwordAlgoVersion: null,
        displayName: null,
        avatarUrl: null,
      });
      return { userId: user.id, amr: [this.method], factorVerifiedAt: null };
    });
  }
}
