import { ChallengeExpiredError, ChallengeInvalidError } from "@idenzy/core/errors/errors";
import { Clock } from "@idenzy/core/time/clock";
import { hashToken } from "@idenzy/crypto/tokens/random";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
} from "@idenzy/domain/ports/auth-flow";
import { AuthCodeRepository } from "@idenzy/persistence/repository/auth-code-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { exchangeCodeSchema } from "@idenzy/protocol/schemas/auth";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Redeeming the code a magic-link redirect delivered (PROJECT.md 4.7).
 *
 * It refuses a code that was not minted for this method, which matters because
 * `auth_codes` is deliberately shared with OAuth: an endpoint that redeemed any code in
 * the table would let a code issued for one route be spent on another, and the `amr` a
 * session claims would stop describing what was actually proved.
 *
 * There is no generic exchange flow yet on purpose. OAuth is the second implementation
 * and it will show what the two really share; building the abstraction now would be
 * guessing at it with one example (PROJECT.md 7.2.6).
 */
@Injectable()
export class MagicLinkFlow extends AuthFlow {
  override readonly method = AuthMethod.MagicLink;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {
    super(sessions, hooks, audit);
  }

  protected override verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(exchangeCodeSchema, credentials);
    const tenant = tenantContextFrom(context);

    return this.uow.run(tenant, async (tx) => {
      const codes = new AuthCodeRepository(tx, tenant);
      const code = await codes.findByHash(hashToken(input.code));
      // One answer for unknown, spent and wrong-method, so the table cannot be probed.
      if (code === null || code.consumedAt !== null) throw new ChallengeInvalidError();
      if (!code.amr.includes(this.method)) throw new ChallengeInvalidError();
      if (code.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
      if (!(await codes.consume(code.id, this.clock.now()))) throw new ChallengeInvalidError();

      const user = await new UserRepository(tx, tenant).findById(code.userId);
      if (user === null) throw new ChallengeInvalidError();
      // Checked here rather than when the code was minted: a ban between the click and
      // the exchange must still take effect.
      user.assertCanSignIn(this.clock);

      // Narrowed rather than cast: the column is text, and a value that is no longer a
      // method we recognise must not reach the amr claim of an access token.
      return { userId: user.id, amr: code.amr.filter(isAuthMethod), requiresMfa: false };
    });
  }
}

const METHODS = new Set<string>(Object.values(AuthMethod));

function isAuthMethod(value: string): value is AuthMethod {
  return METHODS.has(value);
}
