import { ResourceConflictError } from "@idenzy/core/errors";
import type { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { orgInvitations } from "../schema/organisation.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

export interface OrgInvitationRow {
  readonly id: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly invitedBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface NewOrgInvitation {
  readonly email: string;
  readonly role: MemberRole;
  readonly tokenHash: string;
  readonly invitedBy: string;
  readonly expiresAt: Date;
}

function toRow(row: typeof orgInvitations.$inferSelect): OrgInvitationRow {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    // Safe: written only from ASSIGNABLE_MEMBER_ROLES, which are MemberRole values.
    role: row.role as MemberRole,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** An open invitation is one nobody has answered and nobody has taken back. */
const isOpen = and(isNull(orgInvitations.acceptedAt), isNull(orgInvitations.revokedAt));

/**
 * Invitations to join an organisation (ADR-0011).
 *
 * `findByTokenHash` is the only read that is not org-scoped, and it cannot be: somebody
 * following a link is not inside the organisation yet, so there is no `app.org_id` to
 * bind. It answers with the row's own `org_id`, which is what the caller then opens an
 * org transaction with. That is why it takes a hash and never an id — a guessable handle
 * on an unscoped lookup would be a way into somebody else's organisation.
 */
export class OrgInvitationRepository extends OrgRepository<typeof orgInvitations> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, orgInvitations);
  }

  async listOpen(now: Date): Promise<OrgInvitationRow[]> {
    const rows = await this.tx
      .select()
      .from(orgInvitations)
      .where(and(this.orgScope(), isOpen, gt(orgInvitations.expiresAt, now)))
      .orderBy(orgInvitations.createdAt);
    return rows.map(toRow);
  }

  async create(invitation: NewOrgInvitation): Promise<OrgInvitationRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(orgInvitations)
        .values({ orgId: this.context.orgId, ...invitation })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { email: invitation.email } });
    return toRow(row);
  }

  /**
   * Replaces the token and pushes the deadline out, on the invitation already standing.
   *
   * A resend is not a second invitation. Issuing one would trip the open-per-address
   * index, and the older link would stay live, which is a second way in for a mailbox
   * somebody may no longer control.
   */
  async resend(id: string, tokenHash: string, expiresAt: Date): Promise<boolean> {
    const rows = await this.guard(() =>
      this.tx
        .update(orgInvitations)
        .set({ tokenHash, expiresAt })
        .where(and(this.orgScope(), eq(orgInvitations.id, id), isOpen))
        .returning({ id: orgInvitations.id }),
    );
    return rows.length === 1;
  }

  async revoke(id: string, now: Date): Promise<boolean> {
    const rows = await this.tx
      .update(orgInvitations)
      .set({ revokedAt: now })
      .where(and(this.orgScope(), eq(orgInvitations.id, id), isOpen))
      .returning({ id: orgInvitations.id });
    return rows.length === 1;
  }

  /**
   * Spends the invitation, and answers whether it was this call that spent it.
   *
   * The `accepted_at is null` predicate is the whole guard: two clicks on one link race,
   * and the loser must get false rather than a second membership. Written as one
   * conditional update because a read-then-write would let both reads see null.
   */
  async accept(id: string, now: Date): Promise<boolean> {
    const rows = await this.tx
      .update(orgInvitations)
      .set({ acceptedAt: now })
      .where(
        and(this.orgScope(), eq(orgInvitations.id, id), isOpen, gt(orgInvitations.expiresAt, now)),
      )
      .returning({ id: orgInvitations.id });
    return rows.length === 1;
  }

  /**
   * Resolves a link to the organisation it joins, before any organisation is bound.
   *
   * Static and taking the transaction directly, because there is no `OrgContext` to
   * construct a repository with at this point in the flow — which is also why it runs
   * through a SECURITY DEFINER function rather than a plain select: the RLS policy on
   * this table would correctly match nothing. The function is narrow by construction; it
   * takes a hash and returns routing, the shape `resolve_project_by_key_hash` has.
   */
  static async findByTokenHash(
    tx: Transaction,
    tokenHash: string,
    now: Date,
  ): Promise<OrgInvitationRow | null> {
    const result = await tx.execute<{
      id: string;
      org_id: string;
      email: string;
      role: string;
      invited_by: string;
      created_at: Date;
      expires_at: Date;
    }>(sql`select * from resolve_open_invitation(${tokenHash}, ${now.toISOString()})`);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      email: row.email,
      role: row.role as MemberRole,
      invitedBy: row.invited_by,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }
}
