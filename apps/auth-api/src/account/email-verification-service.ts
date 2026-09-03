import { AppConfig } from "@idenzy/config/app-config";
import {
  ChallengeExpiredError,
  ChallengeInvalidError,
  ResourceNotFoundError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { VerificationTokenRepository } from "@idenzy/persistence/repository/verification-token-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { VerificationPurpose } from "@idenzy/protocol/enums/auth";
import { TemplateType } from "@idenzy/protocol/enums/delivery";
import { Injectable } from "@nestjs/common";
import { Mailer } from "../delivery/mailer.js";
import { RedirectKind, RedirectTargets } from "../delivery/redirect-targets.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Proving an address belongs to the person using it (PROJECT.md 4.5).
 *
 * Requesting needs a session, because it is an action on your own account; confirming
 * does not, because the link is usually opened in a different browser from the one that
 * asked. That asymmetry is deliberate and is the reason the token is single use and
 * short lived rather than the reason to demand a session at both ends.
 *
 * We never require verification before issuing a session. Whether an unverified address
 * may sign in is a per-project policy the customer enforces from the `email_verified`
 * claim in their own UI (PROJECT.md 1.1).
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly targets: RedirectTargets,
    private readonly config: AppConfig,
  ) {}

  async request(context: FlowContext, userId: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("EMAIL_VERIFICATION_TTL_SECONDS");
    const target = await this.targets.forKind(context, RedirectKind.EmailVerification);
    const token = generateOpaqueToken();

    const email = await this.uow.run(tenant, async (tx) => {
      const user = await new UserRepository(tx, tenant).findById(userId);
      if (user === null || user.email === null) {
        throw new ResourceNotFoundError({ detail: { entity: "user_email" } });
      }
      // Already verified is a no-op rather than an error: a user pressing the button
      // twice has done nothing wrong, and a second mail would say nothing new.
      if (user.emailVerified) return null;

      const tokens = new VerificationTokenRepository(tx, tenant);
      await tokens.invalidateOutstanding(
        userId,
        VerificationPurpose.EmailVerification,
        this.clock.now(),
      );
      await tokens.issue({
        userId,
        purpose: VerificationPurpose.EmailVerification,
        tokenHash: hashToken(token),
        expiresAt: this.clock.inSeconds(ttl),
      });
      return user.email;
    });

    if (email === null) return;
    await this.mailer.deliver(context, TemplateType.EmailVerification, email, {
      link: RedirectTargets.withToken(target, token),
      expiresInSeconds: ttl,
    });
  }

  async confirm(context: FlowContext, token: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    await this.uow.run(tenant, async (tx) => {
      const tokens = new VerificationTokenRepository(tx, tenant);
      // Looked up by purpose as well as hash. A reset token accepted here would let
      // anyone who can trigger a reset have an address they do not own marked verified.
      const found = await tokens.findByHash(
        VerificationPurpose.EmailVerification,
        hashToken(token),
      );
      if (found === null || found.consumedAt !== null) throw new ChallengeInvalidError();
      if (found.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
      if (!(await tokens.consume(found.id, this.clock.now()))) throw new ChallengeInvalidError();

      await new UserRepository(tx, tenant).setEmailVerified(found.userId, true);
      await new OutboxRepository(tx, tenant).enqueue("user.email_verified", {
        userId: found.userId,
        at: this.clock.now().toISOString(),
      });
    });
  }
}
