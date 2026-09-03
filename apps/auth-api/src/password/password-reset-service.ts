import { AppConfig } from "@idenzy/config/app-config";
import {
  ChallengeExpiredError,
  ChallengeInvalidError,
  PasswordBreachedError,
} from "@idenzy/core/errors";
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
    private readonly config: AppConfig,
    private readonly revocations: RevocationPublisher,
  ) {}

  async request(context: FlowContext, email: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("PASSWORD_RESET_TTL_SECONDS");
    // Resolved before the user lookup so a project with no reset page fails the same way
    // whether or not the address exists.
    const target = await this.targets.forKind(context, RedirectKind.PasswordReset);
    const token = generateOpaqueToken();

    const issued = await this.uow.run(tenant, async (tx) => {
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
   * Sets the new password and, by default, ends every session the account holds.
   *
   * Revoking is the default rather than an option with a safe-looking name, because the
   * common reason to reset a password is that someone else may have had it, and a reset
   * that leaves the attacker's session alive fixes nothing.
   */
  async confirm(context: FlowContext, input: ConfirmPasswordReset): Promise<void> {
    if (await this.breached.isBreached(input.password)) throw new PasswordBreachedError();
    const hashed = await this.hasher.hash(input.password);
    const tenant = tenantContextFrom(context);

    const signedOut = await this.uow.run(tenant, async (tx) => {
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
      await users.setPassword(token.userId, hashed.hash, hashed.algorithmVersion);
      // Every other outstanding reset dies too: two links in a mailbox and only the one
      // just used should have meant anything.
      await tokens.invalidateOutstanding(token.userId, VerificationPurpose.PasswordReset, now);

      if (input.signOutOtherSessions) {
        const ended = await new SessionRepository(tx, tenant).revokeAllForUser(
          token.userId,
          SessionRevokeReason.PasswordChanged,
          now,
        );
        await new RefreshTokenRepository(tx, tenant).revokeForSessions(ended, now);
      }

      await new OutboxRepository(tx, tenant).enqueue("user.password_changed", {
        userId: token.userId,
        via: "reset",
        signedOutOtherSessions: input.signOutOtherSessions,
        at: now.toISOString(),
      });
      return input.signOutOtherSessions ? token.userId : null;
    });

    // A watermark rather than the session list, because a reset is exactly the case where
    // the list can be long and the reason to publish it is that somebody else may hold
    // one of them (ADR-0009). After the commit, like every other publish.
    if (signedOut !== null) await this.revocations.userRevoked(tenant, signedOut);
  }
}
