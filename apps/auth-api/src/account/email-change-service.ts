import { AppConfig } from "@idenzy/config/app-config";
import {
  ChallengeExpiredError,
  ChallengeInvalidError,
  ResourceConflictError,
  ResourceNotFoundError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { EmailChangeRepository } from "@idenzy/persistence/repository/email-change-repository";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { TemplateType } from "@idenzy/protocol/enums/delivery";
import { Injectable } from "@nestjs/common";
import { Mailer } from "../delivery/mailer.js";
import { RedirectKind, RedirectTargets } from "../delivery/redirect-targets.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Moving the address on an account, which takes two confirmations (PROJECT.md 4.5).
 *
 * The new address has to be confirmed because otherwise an account could be pointed at
 * one nobody controls. The old address has to be confirmed because otherwise the first
 * thing an attacker does with a stolen session is move the account somewhere the owner
 * cannot reach, and the notice to the old address is the only warning that owner gets.
 * Either half alone changes nothing.
 *
 * Step-up authentication belongs in front of this (PROJECT.md 4.5 asks for a recent
 * factor verification) and lands with MFA in phase 2. Until then it takes a session and
 * says so, rather than claiming a check it does not make.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly targets: RedirectTargets,
    private readonly config: AppConfig,
  ) {}

  async request(context: FlowContext, userId: string, newEmail: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("EMAIL_CHANGE_TTL_SECONDS");
    const target = await this.targets.forKind(context, RedirectKind.EmailChange);
    const oldToken = generateOpaqueToken();
    const newToken = generateOpaqueToken();

    const oldEmail = await this.uow.run(tenant, async (tx) => {
      const users = new UserRepository(tx, tenant);
      const user = await users.findById(userId);
      if (user === null || user.email === null) {
        throw new ResourceNotFoundError({ detail: { entity: "user_email" } });
      }
      if (user.email === newEmail) {
        throw new ResourceConflictError({ message: "That is already the address on file." });
      }
      // The unique index is the real check and it runs when the change is applied. This
      // one exists so a user finds out now rather than after both confirmations.
      if ((await users.findByEmail(newEmail)) !== null) {
        throw new ResourceConflictError({ message: "That address is already in use." });
      }

      const changes = new EmailChangeRepository(tx, tenant);
      await changes.cancelOutstanding(userId, this.clock.now());
      await changes.open({
        userId,
        newEmail,
        oldTokenHash: hashToken(oldToken),
        newTokenHash: hashToken(newToken),
        expiresAt: this.clock.inSeconds(ttl),
      });
      return user.email;
    });

    await this.mailer.deliver(context, TemplateType.EmailChangeOld, oldEmail, {
      link: RedirectTargets.withToken(target, oldToken),
      new_email: newEmail,
      expiresInSeconds: ttl,
    });
    await this.mailer.deliver(context, TemplateType.EmailChangeNew, newEmail, {
      link: RedirectTargets.withToken(target, newToken),
      expiresInSeconds: ttl,
    });
  }

  /**
   * Confirms one side and applies the change when both are in.
   *
   * Returns whether the address actually moved, so the customer's UI can say "we still
   * need the other confirmation" rather than "done" after the first click.
   */
  confirm(context: FlowContext, token: string): Promise<boolean> {
    const tenant = tenantContextFrom(context);
    return this.uow.run(tenant, async (tx) => {
      const changes = new EmailChangeRepository(tx, tenant);
      const matched = await changes.findByToken(hashToken(token));
      if (matched === null || matched.appliedAt !== null) throw new ChallengeInvalidError();
      if (matched.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();

      const now = this.clock.now();
      const state = await changes.confirm(matched.id, matched.side, now);
      if (state === null) throw new ChallengeInvalidError();
      if (state.oldConfirmedAt === null || state.newConfirmedAt === null) return false;

      // Whoever wins this update is the one that moves the address, so two simultaneous
      // second confirmations cannot both apply it.
      if (!(await changes.markApplied(matched.id, now))) return false;

      const users = new UserRepository(tx, tenant);
      // Verified, because confirming the link to the new address is exactly the proof
      // that verification asks for. Making them do it twice would be theatre.
      await users.setEmail(state.userId, state.newEmail, true);
      await new OutboxRepository(tx, tenant).enqueue("user.email_changed", {
        userId: state.userId,
        at: now.toISOString(),
      });
      return true;
    });
  }
}
