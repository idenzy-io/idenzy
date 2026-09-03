import { ChallengeExpiredError, ChallengeInvalidError } from "@idenzy/core/errors/errors";
import { Clock } from "@idenzy/core/time/clock";
import { hashToken } from "@idenzy/crypto/tokens/random";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type SessionIssuer,
} from "@idenzy/domain/ports/auth-flow";
import { AuthCodeRepository } from "@idenzy/persistence/repository/auth-code-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { exchangeCodeSchema } from "@idenzy/protocol/schemas/auth";
import { parseOrThrow } from "../common/parse.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Redeeming the single-use code a browser redirect delivered (PROJECT.md 4.6, 4.7).
 *
 * Every flow that ends at a customer's own route finishes here: the magic link and OAuth
 * both send the browser somewhere with a code, and the SDK posts it back. Written once
 * because the two really are the same exchange, which is a claim the magic link alone
 * could not support and OAuth now does (PROJECT.md 7.2.6).
 *
 * A subclass supplies only its `method`, and the base refuses any code not minted for
 * that method. That check is the reason one shared table is safe: without it a code
 * issued for one route could be spent on another, and the `amr` a session claims would
 * stop describing what was actually proved.
 */
export abstract class AuthCodeExchangeFlow extends AuthFlow {
  protected constructor(
    sessions: SessionIssuer,
    hooks: FlowHooks,
    audit: FlowAudit,
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
      // Checked at the exchange and not when the code was minted, so a ban applied
      // between the redirect and the POST still takes effect.
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
