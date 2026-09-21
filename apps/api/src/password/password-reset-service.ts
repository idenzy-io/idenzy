import {
  ChallengeExpiredError,
  ChallengeInvalidError,
  PasswordBreachedError,
  PasswordTooShortError,
} from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { RefreshTokenRepository } from "@idenzy/persistence/repository/refresh-token-repository";
import { SessionRepository } from "@idenzy/persistence/repository/session-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { VerificationTokenRepository } from "@idenzy/persistence/repository/verification-token-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { SessionRevokeReason, VerificationPurpose } from "@idenzy/protocol/enums/auth";
import { TemplateType } from "@idenzy/protocol/enums/delivery";
import type { ConfirmPasswordReset } from "@idenzy/protocol/schemas/auth";
import { Injectable } from "@nestjs/common";
import { ProjectSettingsReader } from "../config/project-settings-reader.js";
import { Mailer } from "../delivery/mailer.js";
import { RedirectKind, RedirectTargets } from "../delivery/redirect-targets.js";
import { RevocationPublisher } from "../session/revocation-publisher.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Forgotten passwords (PROJECT.md 4.5).
 *
 * `request` answers 202 for every address, known or not, and there is nothing else it
 * could honestly do: a different answer for an unknown address turns the reset form into
 * an account enumeration oracle, which is the classic way this endpoint leaks. What is
 * not equalized is timing, because sending a mail costs a provider round trip and not
 * sending one does not. Rate limiting this route is what bounds that (PROJECT.md 6.3),
 * and it is why the limit is not optional.
 *
 * The link lands on a URI the project registered, not one the caller supplies, because
 * we render no reset form of our own.
 *
 * Three things about a reset are the project's answer and not this code's or the caller's:
 * how long the link lives, whether confirming it ends the account's other sessions, and
 * whether the account is told afterwards. They are edited on the Passwords screen, stored
 * in `projects.settings`, and were read by nothing until this service asked.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly hasher: PasswordHasher,
    private readonly breached: BreachedPasswordChecker,
    private readonly mailer: Mailer,
    private readonly targets: RedirectTargets,
    private readonly settings: ProjectSettingsReader,
    private readonly revocations: RevocationPublisher,
    private readonly logger: Logger,
  ) {}

  async request(context: FlowContext, email: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    // The project's own clock. §4.5 promised this was the customer's to set and it was
    // `PASSWORD_RESET_TTL_SECONDS`, a deployment-wide environment variable, until the
    // settings document existed — which is the contradiction the Lifetimes screen was
    // documenting: it called this value deployment-fixed while the Passwords screen
    // offered a control for it. The variable is deleted rather than left as a fallback,
    // because this was its only reader and a second answer to one question is how
    // `SESSION_IDLE_TTL_SECONDS` came to be read on rotation while the setting was read
    // on issuance — with different defaults, so every session quietly changed window on
    // its first refresh. That one is fixed too, and the variable is gone with it.
    const ttl = (await this.settings.for(context)).password.resetLifetime * 60;
    // Resolved before the user lookup so a project with no reset page fails the same way
    // whether or not the address exists.
    const target = await this.targets.forKind(context, RedirectKind.PasswordReset);
    const token = generateOpaqueToken();

    const issued = await this.uow.transaction(async (tx) => {
      const user = await new UserRepository(tx, tenant).findByEmail(email);
      if (user === null || user.isDeleted()) return false;

      const tokens = new VerificationTokenRepository(tx, tenant);
      // Requesting a new link kills the old one, so the oldest mail in the mailbox is
      // not the one that still works.
      await tokens.invalidateOutstanding(
        user.id,
        VerificationPurpose.PasswordReset,
        this.clock.now(),
      );
      await tokens.issue({
        userId: user.id,
        purpose: VerificationPurpose.PasswordReset,
        tokenHash: hashToken(token),
        expiresAt: this.clock.inSeconds(ttl),
      });
      return true;
    });

    if (!issued) return;
    await this.mailer.deliver(context, TemplateType.PasswordReset, email, {
      link: RedirectTargets.withToken(target, token),
      expiresInSeconds: ttl,
    });
  }

  /**
   * Sets the new password and, unless the project says otherwise, ends every session the
   * account holds.
   *
   * Revoking is the default rather than an option with a safe-looking name, because the
   * common reason to reset a password is that someone else may have had it, and a reset
   * that leaves the attacker's session alive fixes nothing. The project may turn it off,
   * and only the project: the caller used to carry a `signOutOtherSessions` flag, which
   * let whoever built the reset form switch off a protection the account's owner had been
   * shown as on.
   */
  async confirm(context: FlowContext, input: ConfirmPasswordReset): Promise<void> {
    const policy = (await this.settings.for(context)).password;

    // The same two rules `PasswordSignUpFlow` applies, in the same order, because a reset
    // sets a password and a project's minimum that only one of the two paths enforced was
    // not a minimum: an unauthenticated caller holding a link could put an eight-character
    // password on an account whose project demands twenty. Refusing before the Argon2 run
    // for the reason sign-up gives — a refusal must not cost us the hash.
    if (input.password.length < policy.minLength) {
      throw new PasswordTooShortError(policy.minLength);
    }
    // Gated rather than unconditional, which is the other half of the same drift: the
    // Passwords screen says the corpus is checked "at sign-up and at reset", and a project
    // that turned it off was still paying the round trip and still being refused here.
    if (policy.breachCheck && (await this.breached.isBreached(input.password))) {
      throw new PasswordBreachedError();
    }

    const hashed = await this.hasher.hash(input.password);
    const tenant = tenantContextFrom(context);

    const outcome = await this.uow.transaction(async (tx) => {
      const tokens = new VerificationTokenRepository(tx, tenant);
      const token = await tokens.findByHash(
        VerificationPurpose.PasswordReset,
        hashToken(input.token),
      );
      // One answer for unknown and already-used, so a spent token cannot be told from a
      // token that never existed.
      if (token === null || token.consumedAt !== null) throw new ChallengeInvalidError();
      if (token.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
      if (!(await tokens.consume(token.id, this.clock.now()))) throw new ChallengeInvalidError();

      const now = this.clock.now();
      const users = new UserRepository(tx, tenant);
      // Read for the address the notification goes to. The row is here either way, and a
      // second read outside the transaction could see a different one.
      const user = await users.findById(token.userId);
      await users.setPassword(token.userId, hashed.hash, hashed.algorithmVersion);
      // Every other outstanding reset dies too: two links in a mailbox and only the one
      // just used should have meant anything.
      await tokens.invalidateOutstanding(token.userId, VerificationPurpose.PasswordReset, now);

      if (policy.signOutOnReset) {
        const ended = await new SessionRepository(tx, tenant).revokeAllForUser(
          token.userId,
          SessionRevokeReason.PasswordChanged,
          now,
        );
        await new RefreshTokenRepository(tx, tenant).revokeForSessions(ended, now);
      }

      await new OutboxRepository(tx, tenant).enqueue("user.password_changed", {
        userId: token.userId,
        // Three topics become one `user.updated` event, so each says which of them it was.
        changed: "password",
        via: "reset",
        signedOutOtherSessions: policy.signOutOnReset,
        at: now.toISOString(),
      });
      return {
        email: user?.email ?? null,
        signedOut: policy.signOutOnReset ? { userId: token.userId, at: now } : null,
      };
    });

    // A watermark rather than the session list, because a reset is exactly the case where
    // the list can be long and the reason to publish it is that somebody else may hold
    // one of them (ADR-0009). After the commit, like every other publish.
    if (outcome.signedOut !== null) {
      await this.revocations.userRevoked(tenant, outcome.signedOut.userId, outcome.signedOut.at);
    }

    if (policy.notifyOnChange && outcome.email !== null) {
      await this.notify(context, outcome.email);
    }
  }

  /**
   * Tells the account that its password changed, which is how an owner who did not do it
   * finds out (PROJECT.md 4.5).
   *
   * Nothing here may throw. The password is already committed by the time this runs, so a
   * failed mail reported as a failed reset would send the user back to a form their new
   * password already works against. Same trade as `RevocationPublisher` never throwing
   * and a metering flush never failing a sign-in.
   *
   * It carries no link, which is the template's decision and recorded there: the only URI
   * we hold is registered for where a reset *token* lands, and we render no page of our
   * own to offer instead. That also keeps this send resolvable from nothing but the
   * address, so there is no second thing here that can fail.
   */
  private async notify(context: FlowContext, email: string): Promise<void> {
    try {
      await this.mailer.deliver(context, TemplateType.PasswordChanged, email, {});
    } catch (error) {
      // The class of the failure and never its message: an error that quotes the value it
      // choked on is exactly what the log allowlist exists to keep out (PROJECT.md 4.13.8).
      this.logger.warn("password change notification not sent", {
        projectId: context.projectId,
        requestId: context.requestId,
        component: "delivery",
        outcome: "dropped",
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}
