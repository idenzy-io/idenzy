import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OrgMemberRepository } from "@idenzy/persistence/repository/org-member-repository";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { OrgSecuritySettingsRepository } from "@idenzy/persistence/repository/org-security-settings-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { OrgSummary } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";

export interface OrgDetail extends OrgSummary {
  readonly memberCount: number;
  readonly requireMfa: boolean;
}

/**
 * What the panel reads about an organisation and the caller's place in it.
 *
 * Every read past the first goes through `runForOrg`, so `app.org_id` is bound for the
 * life of the transaction and the repositories carry the predicate themselves (ADR-0011).
 * The list is the exception and has to be: it answers "which organisations are mine",
 * which is the question whose answer decides what to bind.
 */
@Injectable()
export class OrgsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly memberships: OrgMembershipReader,
  ) {}

  /** The organisations the signed-in person belongs to, for the switcher. */
  async listFor(userId: string): Promise<OrgSummary[]> {
    const rows = await this.memberships.organisations(userId);
    return rows.map((row) => ({
      id: PublicId.encode(IdPrefix.Org, row.orgId).value,
      name: row.name,
      memberId: PublicId.encode(IdPrefix.Member, row.memberId).value,
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    }));
  }

  /**
   * One organisation, as the settings screen shows it.
   *
   * The name comes back from the membership list rather than from a second read of
   * `orgs`: the caller has already been proved a member, and the figure the screen wants
   * beside it is the team size, which is one query instead of two.
   */
  async detail(context: OrgContext, summary: OrgSummary): Promise<OrgDetail> {
    return await this.uow.runForOrg(context, async (tx) => {
      const members = await new OrgMemberRepository(tx, context).list();
      const requireMfa = await new OrgSecuritySettingsRepository(tx, context).isMfaRequired();
      return { ...summary, memberCount: members.length, requireMfa };
    });
  }
}
