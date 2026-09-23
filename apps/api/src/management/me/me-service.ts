import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { OrgProjectRepository } from "@idenzy/persistence/repository/org-project-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import type { OrgBalance } from "@idenzy/protocol/schemas/billing";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { Me, OrgSummary, ProjectSummary } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { OrgBalanceReader } from "../billing/org-balance-reader.js";

/**
 * What the panel's shell needs about the signed-in person, assembled once.
 *
 * One call rather than one per screen: the drawer, the switcher and the breadcrumb all
 * want the same facts before anything can render, and three round trips to draw a sidebar
 * is three chances to show a half-built page.
 *
 * The projects are read per organisation, in that organisation's own transaction. A single
 * query across every organisation somebody belongs to is not available and should not be:
 * `projects` is protected by a policy keyed on one bound organisation (ADR-0011), and the
 * only way to read across them would be a SECURITY DEFINER function that reads every
 * project in the database. N is how many organisations one person is in — one, usually —
 * and that is a far better trade than a function with that blast radius.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly memberships: OrgMembershipReader,
    private readonly balances: OrgBalanceReader,
  ) {}

  async load(userId: string, requestId: string): Promise<Me> {
    const memberships = await this.memberships.organisations(userId);

    const organisations: OrgSummary[] = [];
    const projects: ProjectSummary[] = [];
    const balances: OrgBalance[] = [];

    for (const membership of memberships) {
      const orgId = PublicId.encode(IdPrefix.Org, membership.orgId).value;
      organisations.push({
        id: orgId,
        name: membership.name,
        memberId: PublicId.encode(IdPrefix.Member, membership.memberId).value,
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      });

      // Its own transaction per organisation, because an `OrgContext` carries exactly one and
      // the repositories scope to it. Sequential rather than parallel: a pool has
      // a finite number of connections and a person with six organisations must not take
      // six of them to draw a sidebar.
      const context = new OrgContext(
        membership.orgId,
        requestId,
        "customer_staff",
        membership.memberId,
      );
      // Owners and admins only: the wallet answers them and nobody else, and a balance in the
      // header is the wallet's headline.
      if (membership.role === MemberRole.Owner || membership.role === MemberRole.Admin) {
        balances.push(await this.balances.read(context));
      }
      const rows = await this.uow.transaction((tx) => new OrgProjectRepository(tx, context).list());
      for (const row of rows) {
        projects.push({
          id: PublicId.encode(IdPrefix.Project, row.id).value,
          orgId,
          name: row.name,
          plan: row.plan,
          complianceTier: row.complianceTier,
          createdAt: row.createdAt.toISOString(),
        });
      }
    }

    return { organisations, projects, balances };
  }
}
