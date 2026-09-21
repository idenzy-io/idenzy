import {
  PasswordBreachedError,
  PasswordTooShortError,
  SignInMethodDisabledError,
  SignUpDisabledError,
} from "@idenzy/core/errors";
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
import { signUpWithPasswordSchema } from "@idenzy/protocol/schemas/auth";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Sign-up with a password.
 *
 * It is an `AuthFlow` rather than a service that later calls one, because a sign-up ends
 * in a session and everything the base owns applies: hooks, MFA gating, session creation
 * and event ordering. Establishing the subject here means creating them, which is the
 * same shape `AnonymousFlow` takes.
 *
 * The address is created unverified. Requiring verification before a session is a
 * per-project policy, not a platform rule, and a customer who wants it enforces it with
 * the `email_verified` claim in their own UI (PROJECT.md 1.1).
 */
@Injectable()
export class PasswordSignUpFlow extends AuthFlow {
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
    private readonly settings: ProjectSettingsReader,
  ) {
    super(sessions, hooks, audit, mfa, actives);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(signUpWithPasswordSchema, credentials);
    const policy = (await this.settings.for(context)).password;

    // The project's own rules, before any work is done. Refusing here rather than after
    // the Argon2 run is what stops a disabled method being a free way to spend our CPU.
    if (!policy.enabled) throw new SignInMethodDisabledError({ detail: { method: "password" } });
    if (!policy.allowSignUp) throw new SignUpDisabledError({ detail: { method: "password" } });
    // The customer's minimum, which may exceed the protocol's floor and never goes below
    // it: `passwordSchema` has already refused anything under eight.
    if (input.password.length < policy.minLength) {
      throw new PasswordTooShortError(policy.minLength);
    }

    // Before hashing, so a breached password costs an HTTP round trip rather than an
    // Argon2 run, and so the check cannot be skipped by a later refactor of the insert.
    if (policy.breachCheck && (await this.breached.isBreached(input.password))) {
      throw new PasswordBreachedError();
    }

    const hashed = await this.hasher.hash(input.password);
    const tenant = tenantContextFrom(context);

    const userId = await this.uow.transaction(async (tx) => {
      // A duplicate address surfaces as a 409 from the unique index rather than as a
      // check-then-insert, which would be a race and an enumeration oracle at once.
      const user = await new UserRepository(tx, tenant).create({
        email: input.email,
        emailVerified: false,
        phone: null,
        passwordHash: hashed.hash,
        passwordAlgoVersion: hashed.algorithmVersion,
        displayName: input.displayName ?? null,
        avatarUrl: null,
      });
      return user.id;
    });

    return { userId, amr: [this.method], factorVerifiedAt: null };
  }
}
