import { PasswordBreachedError, ResourceConflictError } from "@idenzy/core/errors";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { upgradeAnonymousSchema } from "@idenzy/protocol/schemas/auth";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * The subject comes from the session guard, never from the body.
 *
 * Declared here rather than in the protocol because it is not a wire type: a caller
 * cannot send `userId`, and the controller spreads it in last so a body that tried to
 * would be overwritten (PROJECT.md 4.1).
 */
const upgradeInput = upgradeAnonymousSchema.extend({ userId: z.uuid() });

/**
 * Turning an anonymous account into a real one (PROJECT.md 3.1).
 *
 * The user id does not change, which is the entire point: everything the customer
 * attached to it, orders, drafts, progress, is still attached afterwards. An upgrade
 * that minted a new id would be a migration the customer had to write themselves, and
 * most of them would get it wrong.
 *
 * It is an `AuthFlow` because it ends in a session, and the new session is what makes
 * the amr claim honest: the old one says `anon` forever, and a customer gating on that
 * claim would keep treating an upgraded account as anonymous. The old session is left
 * alone rather than revoked, since it belongs to the same person on the same device and
 * ending it would sign them out of the tab they are looking at.
 */
@Injectable()
export class AnonymousUpgradeFlow extends AuthFlow {
  override readonly method = AuthMethod.Password;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    actives: ActiveUserMeter,
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly breached: BreachedPasswordChecker,
  ) {
    super(sessions, hooks, audit, mfa, actives);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(upgradeInput, credentials);
    if (await this.breached.isBreached(input.password)) throw new PasswordBreachedError();
    const hashed = await this.hasher.hash(input.password);
    const tenant = tenantContextFrom(context);

    return this.uow.transaction(async (tx) => {
      const users = new UserRepository(tx, tenant);
      const user = await users.findById(input.userId);
      // Refusing a non-anonymous account is not defensiveness: this route sets a
      // password without asking for the current one, so allowing it on an account that
      // already has credentials would be a password change with no proof behind it.
      if (user === null || !user.isAnonymous()) {
        throw new ResourceConflictError({ message: "This account is not anonymous." });
      }

      // The address arrives unverified, exactly as password sign-up leaves it. A
      // duplicate surfaces as a 409 from the unique index rather than a check-then-write.
      await users.attachCredentials(
        input.userId,
        input.email,
        hashed.hash,
        hashed.algorithmVersion,
      );
      return { userId: input.userId, amr: [this.method], factorVerifiedAt: null };
    });
  }
}
