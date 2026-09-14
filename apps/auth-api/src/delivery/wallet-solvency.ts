import { Clock } from "@idenzy/core/time/clock";
import { CreditGrantRepository } from "@idenzy/persistence/repository/credit-grant-repository";
import { ProjectRepository } from "@idenzy/persistence/repository/project-repository";
import { UsageDrawdownRepository } from "@idenzy/persistence/repository/usage-drawdown-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { TOLERANCE_WINDOW_DAYS, toleranceCents } from "@idenzy/protocol/billing/price-list";
import { Injectable } from "@nestjs/common";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a project's organisation may still spend money on its behalf (ADR-0014).
 *
 * **Only the channels that cost us money the moment they leave.** `ZERO_STOPS` is a short
 * list and `ZERO_KEEPS_WORKING` is the longer one: authentication, refresh, the dashboard,
 * the API and mail on the shared domain do not stop, whatever is owed. Refusing to sign
 * somebody in over an unpaid balance takes a customer's product down and their users with
 * it, which is not a lever worth having.
 *
 * **It is not a zero check.** An organisation may go into debt up to a tolerance — a share
 * of what it has been charged recently — so a card that expired on Friday does not stop
 * SMS on Saturday, and neither does an outage of ours. Past the tolerance the metered
 * channels refuse, because at that point the alternative is spending money on behalf of
 * somebody who has stopped paying for it.
 *
 * This crosses from a project to its organisation, which is the one place on the request
 * path that does. A project is where the send happens and an organisation is where the
 * money is, so something has to; `projects.org_id` is the only row that knows, and reading
 * it is already scoped to the caller's own project by the policy on that table.
 */
@Injectable()
export class WalletSolvency {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * Whether the organisation behind this project is inside its tolerance.
   *
   * Three indexed reads, on a path that already makes several and is orders of magnitude
   * lower in volume than sign-in. The project-config cache PROJECT.md 4.2 assumes is where
   * this belongs when it lands; until then the honest version is the slow one, because a
   * gate that is cached before it is correct is a gate that is wrong for the length of a
   * TTL.
   */
  async canSpend(projectId: string): Promise<boolean> {
    const tenant = new TenantContext(projectId, "delivery", "system");
    const project = await this.uow.run(tenant, (tx) => new ProjectRepository(tx, tenant).current());
    // A project that cannot be read is one the caller does not own. Refusing is the safe
    // direction: the alternative is spending on a project nobody can be billed for.
    if (project === null) return false;

    const context = new OrgContext(project.orgId, "delivery", "system");
    const now = this.clock.now();
    return await this.uow.runForOrg(context, async (tx) => {
      const drawdown = new UsageDrawdownRepository(tx, context);
      const debt = await drawdown.debtCents();
      // Nothing owed is the common case and settles it without the other two reads.
      if (debt === 0) return true;

      const credit = await new CreditGrantRepository(tx, context).balanceCents(now);
      if (credit >= debt) return true;

      const since = new Date(now.getTime() - TOLERANCE_WINDOW_DAYS * DAY_MS);
      const charged = await drawdown.chargedSince(since);
      return debt - credit <= toleranceCents(charged);
    });
  }
}
