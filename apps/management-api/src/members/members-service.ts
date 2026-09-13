import { ResourceConflictError, ResourceNotFoundError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import {
  OrgInvitationRepository,
  type OrgInvitationRow,
} from "@idenzy/persistence/repository/org-invitation-repository";
import {
  OrgMemberRepository,
  type OrgMemberRow,
} from "@idenzy/persistence/repository/org-member-repository";
import { OrgSecuritySettingsRepository } from "@idenzy/persistence/repository/org-security-settings-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { AssignableRole, OrgInvitation, OrgMember } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { DashboardUsers } from "./dashboard-users.js";

/** How long an invitation stands: long enough for somebody on holiday, short enough to expire. */
const INVITATION_DAYS = 7;

/**
 * An organisation's team, and the invitations that have not been answered (PROJECT.md 3.2).
 *
 * Every read and write goes through `runForOrg`, which binds `app.org_id` for the life of
 * the transaction, so the repositories carry the predicate themselves rather than relying on
 * a filter somebody has to remember (ADR-0011). The one exception is the name-and-address
 * join, which reads the dashboard project's own users under a scope fixed in configuration —
 * see `DashboardUsers` for why that cannot come from the request.
 *
 * Ownership is the rule this service exists to protect. It never arrives by invitation and
 * never by a role change: `transferOwnership` is the only path, it moves ownership and
 * demotes the previous owner in one statement, and a partial unique index refuses two owners
 * underneath all of it. An API that let `role: "owner"` through would be relying on that
 * index to be the error message.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly people: DashboardUsers,
  ) {}

  async list(context: OrgContext): Promise<readonly OrgMember[]> {
    const rows = await this.uow.runForOrg(context, (tx) =>
      new OrgMemberRepository(tx, context).list(),
    );
    const people = await this.people.byId(
      rows.map((row) => row.userId),
      context.requestId,
    );
    return rows.map((row) => present(row, people.get(row.userId)));
  }

  async setRole(context: OrgContext, memberId: string, role: AssignableRole): Promise<OrgMember> {
    const id = PublicId.parse(IdPrefix.Member, memberId).uuid;
    const row = await this.uow.runForOrg(context, async (tx) => {
      const members = new OrgMemberRepository(tx, context);
      const existing = (await members.list()).find((member) => member.id === id);
      if (existing === undefined) return null;
      // The owner cannot be demoted by a role change, only by handing ownership on. Left
      // to the database this is a unique-index violation reported as a conflict with no
      // explanation; said here it is a sentence the screen can show.
      if (existing.role === MemberRole.Owner) {
        throw new ResourceConflictError({
          message: "The owner's role changes by transferring ownership, not by assignment.",
          detail: { memberId },
        });
      }
      return await members.setRole(id, role as MemberRole);
    });
    if (row === null) throw notFound(memberId);
    return await this.decorate(context, row);
  }

  async remove(context: OrgContext, memberId: string): Promise<void> {
    const id = PublicId.parse(IdPrefix.Member, memberId).uuid;
    const removed = await this.uow.runForOrg(context, async (tx) => {
      const members = new OrgMemberRepository(tx, context);
      const existing = (await members.list()).find((member) => member.id === id);
      if (existing === undefined) return false;
      // An organisation with no owner has nobody who can transfer ownership or delete it,
      // which is a state with no way out rather than an unusual one.
      if (existing.role === MemberRole.Owner) {
        throw new ResourceConflictError({
          message: "Transfer ownership before removing the owner.",
          detail: { memberId },
        });
      }
      return await members.remove(id);
    });
    if (!removed) throw notFound(memberId);
  }

  /** Moves ownership and demotes the previous owner, in the repository's own statement. */
  async transfer(context: OrgContext, memberId: string): Promise<readonly OrgMember[]> {
    const id = PublicId.parse(IdPrefix.Member, memberId).uuid;
    await this.uow.runForOrg(context, async (tx) => {
      const members = new OrgMemberRepository(tx, context);
      const target = (await members.list()).find((member) => member.id === id);
      if (target === undefined) throw notFound(memberId);
      if (target.role === MemberRole.Owner) return;
      await members.transferOwnership(id);
    });
    return await this.list(context);
  }

  async invitations(context: OrgContext): Promise<readonly OrgInvitation[]> {
    const rows = await this.uow.runForOrg(context, (tx) =>
      new OrgInvitationRepository(tx, context).listOpen(this.clock.now()),
    );
    return await this.nameInviters(context, rows);
  }

  /**
   * Creates one and answers with the row.
   *
   * The token is generated here, hashed here, and the digest is what reaches the database —
   * so a backup is not a set of live invitations. `invitedBy` is an `org_members.id` and not
   * a user id: the column names the membership, and `nameInviters` below joins on it. **Nothing sends it**: there is no email
   * transport wired to this path yet, which the screen has to say rather than imply, because
   * an invitation nobody receives looks identical to one that was sent and ignored.
   */
  async invite(
    context: OrgContext,
    email: string,
    role: AssignableRole,
    invitedBy: string,
  ): Promise<OrgInvitation> {
    const row = await this.uow.runForOrg(context, async (tx) => {
      const members = new OrgMemberRepository(tx, context);
      const people = await this.people.byId(
        (await members.list()).map((member) => member.userId),
        context.requestId,
      );
      if ([...people.values()].some((person) => person.email === email)) {
        throw new ResourceConflictError({
          message: "That address is already a member of this organisation.",
          detail: { email },
        });
      }
      return await new OrgInvitationRepository(tx, context).create({
        email,
        role: role as MemberRole,
        tokenHash: hashToken(generateOpaqueToken()),
        invitedBy,
        expiresAt: this.clock.inSeconds(INVITATION_DAYS * 24 * 60 * 60),
      });
    });
    const [named] = await this.nameInviters(context, [row]);
    return named ?? presentInvitation(row, "Unknown");
  }

  /** A fresh token and a fresh deadline. The old token stops working in the same statement. */
  async resend(context: OrgContext, invitationId: string): Promise<void> {
    const id = PublicId.parse(IdPrefix.Invitation, invitationId).uuid;
    const done = await this.uow.runForOrg(context, (tx) =>
      new OrgInvitationRepository(tx, context).resend(
        id,
        hashToken(generateOpaqueToken()),
        this.clock.inSeconds(INVITATION_DAYS * 24 * 60 * 60),
      ),
    );
    if (!done) throw notFound(invitationId);
  }

  async revoke(context: OrgContext, invitationId: string): Promise<void> {
    const id = PublicId.parse(IdPrefix.Invitation, invitationId).uuid;
    const done = await this.uow.runForOrg(context, (tx) =>
      new OrgInvitationRepository(tx, context).revoke(id, this.clock.now()),
    );
    if (!done) throw notFound(invitationId);
  }

  async requireMfa(context: OrgContext): Promise<boolean> {
    return await this.uow.runForOrg(context, (tx) =>
      new OrgSecuritySettingsRepository(tx, context).isMfaRequired(),
    );
  }

  async setRequireMfa(context: OrgContext, required: boolean, actorId: string): Promise<boolean> {
    await this.uow.runForOrg(context, (tx) =>
      new OrgSecuritySettingsRepository(tx, context).setMfaRequired(required, actorId),
    );
    return required;
  }

  private async decorate(context: OrgContext, row: OrgMemberRow): Promise<OrgMember> {
    const people = await this.people.byId([row.userId], context.requestId);
    return present(row, people.get(row.userId));
  }

  /** Invitations name who sent them, which is a member id needing the same join. */
  private async nameInviters(
    context: OrgContext,
    rows: readonly OrgInvitationRow[],
  ): Promise<readonly OrgInvitation[]> {
    if (rows.length === 0) return [];
    const members = await this.uow.runForOrg(context, (tx) =>
      new OrgMemberRepository(tx, context).list(),
    );
    const byMemberId = new Map(members.map((member) => [member.id, member.userId]));
    const people = await this.people.byId(
      members.map((member) => member.userId),
      context.requestId,
    );
    return rows.map((row) => {
      const userId = byMemberId.get(row.invitedBy);
      const person = userId === undefined ? undefined : people.get(userId);
      return presentInvitation(row, person?.name ?? "Unknown");
    });
  }
}

function notFound(id: string): ResourceNotFoundError {
  return new ResourceNotFoundError({ detail: { id } });
}

function present(
  row: OrgMemberRow,
  person: { name: string; email: string; mfaEnrolled: boolean } | undefined,
): OrgMember {
  return {
    id: PublicId.encode(IdPrefix.Member, row.id).toString(),
    name: person?.name ?? "Unknown",
    email: person?.email ?? "",
    role: row.role,
    mfaEnrolled: person?.mfaEnrolled ?? false,
    joinedAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
  };
}

function presentInvitation(row: OrgInvitationRow, invitedBy: string): OrgInvitation {
  return {
    id: PublicId.encode(IdPrefix.Invitation, row.id).toString(),
    email: row.email,
    role: row.role as OrgInvitation["role"],
    invitedBy,
    invitedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}
