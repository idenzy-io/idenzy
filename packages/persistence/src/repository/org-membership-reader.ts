import type { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { orgMembers, orgs } from "../schema/organisation.js";

export interface Membership {
  readonly memberId: string;
  readonly role: MemberRole;
  /**
   * When this member was last seen, or null for one who has never been.
   *
   * Returned by the check rather than read separately because the caller's only use for
   * it is deciding whether to write it again, and a second query to answer that would be
   * a second round trip on the busiest path in the dashboard.
   */
  readonly lastActiveAt: Date | null;
}

/**
 * One row of the organisation switcher.
 *
 * It names the two fields it shares with {@link Membership} rather than extending it. The
 * two answer different questions — this one is "which of these am I in, and as what", the
 * other is "may this request proceed, and when was this person last here" — and
 * `last_active_at` is on the second for a reason the switcher has no use for. Inheriting
 * it would mean `orgs_for_user` returning a column nothing reads.
 */
export interface OrgSummaryRow {
  readonly orgId: string;
  readonly name: string;
  readonly memberId: string;
  readonly role: MemberRole;
  readonly joinedAt: Date;
}

/**
 * Which organisations a person belongs to, before any of them is chosen (ADR-0011).
 *
 * Not an `OrgRepository` and it cannot be one: those are org-scoped by construction, and
 * this is the code that works out which organisation to scope to. It is the one reader in
 * the package whose input is a user rather than a tenant, so it takes the pool directly.
 *
 * These were two SECURITY DEFINER functions, `resolve_org_membership` and `orgs_for_user`,
 * added when `org_members` was first read this way. They existed for one reason: it carried a
 * row policy keyed on the bound organisation, and this is the lookup that decides *which* one,
 * so under the policy it correctly returned nothing. With the policies gone there is
 * nothing to step around and they are ordinary selects — which is better, because a
 * definer-rights function is a standing privilege whether or not anything needs it.
 *
 * The safety property is unchanged and is worth restating: the subject is always a user id
 * from a verified access token, and neither query takes an argument that could name a
 * different one. `orgs.name` comes back from the list, and that is an authorized read
 * rather than a leak — it is the name of an organisation the caller is a member of.
 */
export class OrgMembershipReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** The membership, or null where the person is not on this organisation's team. */
  async membership(userId: string, orgId: string): Promise<Membership | null> {
    const rows = await this.db
      .select({
        memberId: orgMembers.id,
        role: orgMembers.role,
        lastActiveAt: orgMembers.lastActiveAt,
      })
      .from(orgMembers)
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    // Safe: the column is written only from MemberRole.
    return { ...row, role: row.role as MemberRole };
  }

  /** Everything the person belongs to, oldest membership first. The switcher's list. */
  async organisations(userId: string): Promise<OrgSummaryRow[]> {
    const rows = await this.db
      .select({
        orgId: orgs.id,
        name: orgs.name,
        memberId: orgMembers.id,
        role: orgMembers.role,
        joinedAt: orgMembers.createdAt,
      })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
      .where(eq(orgMembers.userId, userId))
      .orderBy(asc(orgMembers.createdAt), asc(orgMembers.id));
    // Safe: the column is written only from MemberRole.
    return rows.map((row) => ({ ...row, role: row.role as MemberRole }));
  }
}
