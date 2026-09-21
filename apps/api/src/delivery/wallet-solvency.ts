import { Clock } from "@idenzy/core/time/clock";
import { ProjectSpendStateRepository } from "@idenzy/persistence/repository/project-spend-state-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";

/**
 * Whether a project's organisation may still spend money on its behalf (ADR-0014, ADR-0016).
 *
 * **Only the channels that cost us money the moment they leave.** `ZERO_STOPS` is a short list
 * and `ZERO_KEEPS_WORKING` is the longer one: authentication, refresh, the dashboard, the API and
 * mail on the shared domain do not stop, whatever is owed. Refusing to sign somebody in over an
 * unpaid balance takes a customer's product down and their users with it, which is not a lever
 * worth having.
 *
 * **It reads one row in its own cell, and that is the change worth reading twice.** This used to
 * cross from the project to its organisation and read `org_debts`, `credit_grants` and
 * `usage_charges` — three control-plane tables — on the send path. It was the only place a
 * request crossed planes, and once the control plane has its own database (PROJECT.md 4.13.5)
 * that shape becomes untenable three ways at once: it would give a cell's auth-api control-plane
 * credentials, destroying the blast radius cells exist to bound; it would make a control-plane
 * outage an outage of one-time codes in every cell simultaneously; and it would put a
 * transatlantic query in front of every send from an EU cell.
 *
 * So the drawdown decides and publishes, and this reads what was published.
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
   * **Absent or stale means yes, and that is deliberate.** ADR-0014 already settled the argument
   * this rests on: "a card that expired on Friday does not stop SMS on Saturday, and neither does
   * an outage of ours." A projection nobody refreshed is an outage of ours. Failing closed here
   * would mean a dead worker silently stops one-time codes for paying customers — a far worse
   * failure than a few minutes of spending for one who has stopped paying, which the tolerance
   * was already designed to absorb.
   *
   * A project with no published row has never been through a drawdown pass, which is every new
   * project and every project that owes nothing. Treating that as "no" would refuse the common
   * case.
   */
  async canSpend(projectId: string): Promise<boolean> {
    const tenant = new TenantContext(projectId, "delivery", "system");
    const state = await this.uow.transaction((tx) =>
      new ProjectSpendStateRepository(tx, tenant).current(),
    );
    if (state === null) return true;
    if (state.staleAfter.getTime() <= this.clock.now().getTime()) return true;
    return state.spendable;
  }
}
