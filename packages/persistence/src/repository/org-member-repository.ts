import { ResourceConflictError, ResourceNotFoundError } from "@idenzy/core/errors";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { and, eq, ne, sql } from "drizzle-orm";
import { orgMembers } from "../schema/organisation.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface OrgMemberRow {
  readonly id: string;
  readonly userId: string;
  readonly role: MemberRole;
  readonly invitedBy: string | null;
  readonly createdAt: Date;
  readonly lastActiveAt: Date | null;
}

function toRow(row: typeof orgMembers.$inferSelect): OrgMemberRow {
  return {
    id: row.id,
    // Safe: the column is written only from MemberRole, and the single-owner index
    // constrains the one value the rest of this class branches on.
    role: row.role as MemberRole,
    userId: row.userId,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
  };
}

/**
 * The organisation's team (PROJECT.md 4.13.7, ADR-0011).
 *
 * Two rules live here rather than in a service, because they are the ones a caller must
 * not be able to get past: ownership moves by transfer and never by assignment, and the
 * owner cannot be removed. Both are also held by `org_members_single_owner_key`, so a
 * bug here fails as a constraint violation rather than as a team with two owners.
 */
export class OrgMemberRepository extends OrgRepository<typeof orgMembers> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, orgMembers);
  }

  async list(): Promise<OrgMemberRow[]> {
    const rows = await this.tx
      .select()
      .from(orgMembers)
      .where(this.orgScope())
      .orderBy(orgMembers.createdAt);
    return rows.map(toRow);
  }

  async findByUserId(userId: string): Promise<OrgMemberRow | null> {
    const rows = await this.tx
      .select()
      .from(orgMembers)
      .where(and(this.orgScope(), eq(orgMembers.userId, userId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  async add(userId: string, role: MemberRole, invitedBy: string | null): Promise<OrgMemberRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(orgMembers)
        .values({ orgId: this.context.orgId, userId, role, invitedBy })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { userId } });
    return toRow(row);
  }

  /**
   * Gives somebody a different role.
   *
   * Refuses to touch the owner in either direction. A change that assigned ownership
   * would make a second owner, and one that demoted the owner would leave the
   * organisation without the seat that can always undo a mistake.
   */
  async setRole(id: string, role: MemberRole): Promise<OrgMemberRow> {
    if (role === MemberRole.Owner) {
      throw new ResourceConflictError({
        message: "Ownership moves by transfer, not by assignment.",
        detail: { memberId: id },
      });
    }
    const rows = await this.guard(() =>
      this.tx
        .update(orgMembers)
        .set({ role })
        .where(and(this.orgScope(), eq(orgMembers.id, id), ne(orgMembers.role, MemberRole.Owner)))
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { memberId: id } });
    return toRow(row);
  }

  /**
   * Moves the organisation to somebody else.
   *
   * One statement, so there is never a moment with two owners and never one with none,
   * including the moment in the middle. A promote followed by a demote would trip the
   * single-owner index between them; a demote followed by a promote would leave the
   * organisation ownerless if the second half failed.
   */
  async transferOwnership(toId: string): Promise<void> {
    const rows = await this.guard(() =>
      this.tx
        .update(orgMembers)
        .set({
          role: sql`case when ${orgMembers.id} = ${toId} then ${MemberRole.Owner} else ${MemberRole.Admin} end`,
        })
        .where(
          and(
            this.orgScope(),
            sql`(${orgMembers.id} = ${toId} or ${orgMembers.role} = ${MemberRole.Owner})`,
          ),
        )
        .returning({ id: orgMembers.id }),
    );
    // Two rows: the new owner and the old one. Fewer means the target was not on this
    // team, or was already the owner, and neither is a transfer that happened.
    if (rows.length !== 2) {
      throw new ResourceNotFoundError({ detail: { memberId: toId } });
    }
  }

  /** Takes somebody off the team. The owner is refused, which keeps the seat filled. */
  async remove(id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(orgMembers)
      .where(and(this.orgScope(), eq(orgMembers.id, id), ne(orgMembers.role, MemberRole.Owner)))
      .returning({ id: orgMembers.id });
    return rows.length === 1;
  }

  /** What makes a dormant seat visible. Best-effort: a missed touch is not an error. */
  async touch(id: string): Promise<void> {
    await this.tx
      .update(orgMembers)
      .set({ lastActiveAt: new Date() })
      .where(and(this.orgScope(), eq(orgMembers.id, id)));
  }
}
