import { createHash } from "node:crypto";
import { ChallengeExpiredError, ChallengeInvalidError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { hashToken, safeCompareHex } from "@idenzy/crypto/tokens/random";
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

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(exchangeCodeSchema, credentials);
    const tenant = tenantContextFrom(context);

    const redeemed = await this.uow.run(tenant, async (tx) => {
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
      return {
        challenge: code.codeChallenge,
        subject: { userId: user.id, amr: code.amr.filter(isAuthMethod), requiresMfa: false },
      };
    });

    // Checked after the transaction has committed, so the code stays spent when the check
    // fails. Throwing from inside would roll back the very consumption that makes a stolen
    // code worthless, and the thief could simply try again with the right verifier once they
    // had it. `RefreshService` defers its revocations for the same reason.
    assertPkce(redeemed.challenge, input.codeVerifier);
    return redeemed.subject;
  }
}

/**
 * PKCE on our own exchange code, S256 only (PROJECT.md 4.6).
 *
 * Mandatory to verify once a challenge was stored, which is what stops an attacker simply
 * omitting the verifier to skip the check. A code minted with no challenge accepts a verifier
 * and ignores it: a server-side exchange with a secret key legitimately has none, and magic
 * links never do because they are clicked in a different browser from the one that started
 * them.
 *
 * Every failure is `challenge_invalid`, identical to unknown and to already-spent, so a thief
 * holding a stolen code learns nothing about whether it was ever real.
 */
function assertPkce(challenge: string | null, verifier: string | undefined): void {
  if (challenge === null) return;
  if (verifier === undefined) throw new ChallengeInvalidError();
  const presented = createHash("sha256").update(verifier).digest("base64url");
  if (!safeCompareHex(hashToken(presented), hashToken(challenge))) {
    throw new ChallengeInvalidError();
  }
}

const METHODS = new Set<string>(Object.values(AuthMethod));

function isAuthMethod(value: string): value is AuthMethod {
  return METHODS.has(value);
}
