import type { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface Membership {
  readonly memberId: string;
  readonly role: MemberRole;
}

export interface OrgSummaryRow extends Membership {
  readonly orgId: string;
  readonly name: string;
  readonly joinedAt: Date;
}

/**
 * Which organisations a person belongs to, before any of them is bound (ADR-0011).
 *
 * Not an `OrgRepository` and it cannot be one: those are org-scoped by construction, and
 * this is the code that works out which organisation to scope to. `org_members` is
 * protected by a policy keyed on `app.org_id`, so under it this lookup would correctly
 * return nothing — the same shape of problem `AuditEventReader` has, and solved the same
 * way, through the SECURITY DEFINER functions from migration 0036.
 *
 * It lives here rather than in `management-api` because this is the only layer that talks
 * to the database. An application service asks a repository; it does not write a
 * statement. `ProjectResolver` in auth-api predates that rule and is the odd one out.
 *
 * The subject is always a user id from a verified access token, and neither function
 * takes an argument that could name a different one. That is what makes bypassing the
 * policy a narrow authorized read rather than a hole in it.
 */
export class OrgMembershipReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** The membership, or null where the person is not on this organisation's team. */
  async membership(userId: string, orgId: string): Promise<Membership | null> {
    const rows = await this.db.execute<{ member_id: string; role: string }>(
      sql`select * from resolve_org_membership(${userId}::uuid, ${orgId}::uuid)`,
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    // Safe: the column is written only from MemberRole.
    return { memberId: row.member_id, role: row.role as MemberRole };
  }

  /** Everything the person belongs to, oldest membership first. The switcher's list. */
  async organisations(userId: string): Promise<OrgSummaryRow[]> {
    const rows = await this.db.execute<{
      org_id: string;
      name: string;
      member_id: string;
      role: string;
      joined_at: Date;
    }>(sql`select * from orgs_for_user(${userId}::uuid)`);
    return rows.rows.map((row) => ({
      orgId: row.org_id,
      name: row.name,
      memberId: row.member_id,
      role: row.role as MemberRole,
      joinedAt: new Date(row.joined_at),
    }));
  }
}
