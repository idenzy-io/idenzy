import { RateLimitStrategy } from "@idenzy/cache/rate-limit-strategy";
import { AppConfig } from "@idenzy/config/app-config";
import { SendingDomainRequiredError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { UsageMeter } from "@idenzy/domain/ports/email-provider";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";
import { SendingDomains } from "./sending-domains.js";

/**
 * The shared sender's two ceilings (PROJECT.md 11.2).
 *
 * A burst of three refilling at one a minute, and two hundred in a day. The burst is what
 * makes it pleasant to develop against — testing sign-up and then password reset back to
 * back should not look like a bug — and the daily figure is what makes it impossible to
 * run a product on. Two hundred is generous for building an integration and hopeless for
 * anything else, which is exactly the line we are drawing.
 */
/**
 * Each carries its own scope, and that is not decoration.
 *
 * `RateLimitStrategy` keys on `scope:identifier`, so two rules sharing a scope share a
 * counter: the daily check would increment the burst's count and a project would be
 * refused on its second send rather than its fourth. Found by the test, which is the only
 * place it would have been found — both rules allow the first call, so the interference
 * only shows up a few sends in.
 */
const SHARED_RULES = [
  { scope: "email:shared:burst", rule: { limit: 3, windowSeconds: 60 } },
  { scope: "email:shared:daily", rule: { limit: 200, windowSeconds: 24 * 60 * 60 } },
] as const;

/**
 * Counts what was sent, and refuses what the shared sender must not carry (PROJECT.md 5.1,
 * 11.2, risks.md).
 *
 * **`mail.idenzy.io` is a place to build an integration against, not to run a product on.**
 * Every project that has configured nothing sends from it, and SES scores reputation per
 * domain, so one project blasting to scraped addresses puts every other such project's
 * verification mail in spam — people who did nothing wrong and cannot fix it. The ceiling
 * is therefore deliberately far below any production volume: a customer who means to ship
 * verifies a domain of their own, whatever they are paying us.
 *
 * **This is not about money and does not consult the wallet.** A paying customer with a
 * retry loop damages the domain exactly as fast as a delinquent one. The wallet gate is a
 * separate control with a separate reason, and both may refuse.
 *
 * **A verified sending domain is not limited here**, because the reputation at stake is
 * then mostly the customer's own. Not entirely — mail still leaves through our SES account,
 * and an account-level bounce rate is an AWS review for everybody — which is why risks.md
 * keeps a bounce-rate breaker on the open list. It needs the SNS receiver that does not
 * exist yet, so it is named rather than pretended.
 */
@Injectable()
export class DatabaseUsageMeter implements UsageMeter {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly domains: SendingDomains,
    private readonly limiter: RateLimitStrategy,
    private readonly config: AppConfig,
  ) {}

  async assertWithinQuota(projectId: string, channel: Channel): Promise<void> {
    if (channel !== Channel.Email) return;
    // We run the panel on our own product (PROJECT.md 9.5), so our own dashboard sends real
    // mail to real customers through this path. Until it has a verified sending domain of
    // its own it would be held to a developer's allowance and our sign-ups would stop at
    // two hundred a day. Named here rather than hidden, and listed in risks.md as the
    // carve-out it is — the durable fix is to verify a domain for it, which also makes us
    // the first user of the feature.
    if (projectId === this.dashboardProjectId()) return;

    const identity = await this.domains.forProject(projectId);
    if (!identity.shared) return;

    for (const { scope, rule } of SHARED_RULES) {
      // Strictly, so a cache we cannot reach refuses rather than allows. The opposite of
      // the call `check` makes for sign-in, and the same one `SmsFraudGuard` makes: an
      // authentication we could not count is an authentication, and an email we could not
      // count is our domain's reputation. A developer blocked by a Valkey outage is a
      // minor inconvenience; an unmetered window on a shared sender is not.
      const decision = await this.limiter.checkStrictly(scope, projectId, rule);
      if (!decision.allowed) {
        throw new SendingDomainRequiredError({
          detail: { projectId, retryAfterSeconds: decision.retryAfterSeconds },
        });
      }
    }
  }

  /**
   * Our own dashboard project, as a uuid.
   *
   * `DASHBOARD_PROJECT_ID` is configured in the public `prj_…` form, because that is what a
   * person copies out of a screen, and everything on this path carries the uuid. Comparing
   * the two directly is a check that can never match — which is how the carve-out came to
   * be written, tested, and silently doing nothing.
   */
  private dashboardProjectId(): string | null {
    const configured = this.config.get("DASHBOARD_PROJECT_ID");
    if (configured === undefined) return null;
    try {
      return PublicId.parse(IdPrefix.Project, configured).uuid;
    } catch {
      return null;
    }
  }

  async record(
    projectId: string,
    channel: Channel,
    _meta: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (channel !== Channel.Email) return;
    const tenant = new TenantContext(projectId, "delivery", "system");
    await this.uow.run(tenant, (tx) =>
      new UsageRepository(tx, tenant).recordEmailSent(this.clock.now()),
    );
  }
}
