import { randomBytes } from "node:crypto";
import { InvalidCredentialsError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import type { User } from "@idenzy/domain/entities/user";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
} from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { signInWithPasswordSchema } from "@idenzy/protocol/schemas/auth";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Email and password sign-in (PROJECT.md 4.5).
 *
 * Everything security-relevant about this flow is about not answering questions. A
 * missing user and a wrong password produce the same error, after the same amount of
 * work, because an attacker who can tell them apart has an account enumeration oracle
 * and a very cheap one.
 */
@Injectable()
export class PasswordSignInFlow extends AuthFlow {
  override readonly method = AuthMethod.Password;

  /** Verified against when no user exists, so the two paths cost the same. */
  private decoyHash: Promise<string> | null = null;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
  ) {
    super(sessions, hooks, audit);
  }

  protected override verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    // Parsed rather than asserted, even though the controller already validated: the
    // base hands every flow `unknown`, and a cast here would be a type without a check.
    const { email, password } = parseOrThrow(signInWithPasswordSchema, credentials);
    const tenant = tenantContextFrom(context);

    return this.uow.run(tenant, async (tx) => {
      const users = new UserRepository(tx, tenant);
      const user = await users.findByEmail(email);
      const hash = user?.passwordHash ?? (await this.decoy());

      const matches = await this.hasher.verify(hash, password);
      // The order matters: the decoy verify above has already run, so a missing user and
      // a bad password leave by the same door at the same time.
      if (!matches || user === null) throw new InvalidCredentialsError();

      user.assertCanSignIn(this.clock);
      await this.upgradeHashIfStale(users, user, password);

      return { userId: user.id, amr: [this.method], requiresMfa: false };
    });
  }

  /**
   * Raising Argon2 parameters, or importing a bcrypt hash, upgrades the user here on
   * their next successful sign-in. That is what makes a migration invisible: nobody is
   * ever asked to reset a password because our cost factors changed.
   */
  private async upgradeHashIfStale(
    users: UserRepository,
    user: User,
    password: string,
  ): Promise<void> {
    const current = user.passwordHash;
    if (current === null || !this.hasher.needsRehash(current)) return;
    const upgraded = await this.hasher.hash(password);
    await users.setPassword(user.id, upgraded.hash, upgraded.algorithmVersion);
  }

  /**
   * One decoy per process, hashed from random bytes it then forgets. Computed lazily so
   * boot is not delayed, and cached so the first sign-in against an unknown address is
   * not measurably slower than the second.
   */
  private decoy(): Promise<string> {
    this.decoyHash ??= this.hasher
      .hash(randomBytes(32).toString("hex"))
      .then((result) => result.hash);
    return this.decoyHash;
  }
}
