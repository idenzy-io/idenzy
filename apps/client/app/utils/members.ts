/**
 * Who is on the project's team, what each of them may do, and the rules that stop a team
 * locking itself out (PROJECT.md 3.3, 4.13.7).
 *
 * Two invariants hold the whole screen up, and both are enforced here rather than in the
 * template, because a rule a button merely hides is a rule an API call gets past.
 *
 * There is exactly one owner, always. A role change can never produce a second one or
 * none: moving it is a transfer, which is one act that demotes the old owner in the same
 * breath as it promotes the new one. Every other product that models this as "set role to
 * owner" ends up with two owners and an argument about which one may remove the other.
 *
 * Nobody can be left unable to administer the project. The owner cannot be removed and
 * cannot be demoted, so the seat that can always undo a mistake is one nobody can delete
 * by accident.
 *
 * The third thing worth stating is what this is not. A role is a boundary in the
 * dashboard, and anybody who can mint an API key has whatever the management API allows,
 * whatever their role says afterwards. That is written into the capability list rather
 * than glossed, because a permission model that implies a guarantee it does not hold is
 * worse than one that admits its edge.
 */

/*
 * The roles.
 */

export type MemberRole = "owner" | "admin" | "developer" | "viewer";

/** In order of what they may do, which is the order the picker and the matrix use. */
export const MEMBER_ROLES: readonly MemberRole[] = ["owner", "admin", "developer", "viewer"];

/** The roles a member can be given. Ownership moves by transfer and never by assignment. */
export const ASSIGNABLE_ROLES: readonly MemberRole[] = ["admin", "developer", "viewer"];

export interface RoleInfo {
  id: MemberRole;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  note: string;
}

export const ROLE_INFO: Record<MemberRole, RoleInfo> = {
  owner: {
    id: "owner",
    label: "Owner",
    icon: "material-symbols:workspace-premium-outline",
    note: "One per project, and the only seat that can transfer the project or delete it. It cannot be removed or demoted, so there is always somebody who can undo anything else on this page.",
  },
  admin: {
    id: "admin",
    label: "Admin",
    icon: "material-symbols:shield-person-outline",
    note: "Everything the owner can do except hand the project on or delete it. Manages the team, the billing and every setting.",
  },
  developer: {
    id: "developer",
    label: "Developer",
    icon: "material-symbols:code",
    note: "Configures how the product signs people in and holds the keys that do it. No access to the team or the billing.",
  },
  viewer: {
    id: "viewer",
    label: "Viewer",
    icon: "material-symbols:visibility-outline",
    note: "Reads everything and changes nothing, the audit trail included. For an auditor, or somebody being shown around.",
  },
};

export function roleInfo(role: MemberRole): RoleInfo {
  return ROLE_INFO[role];
}

/*
 * What each role may do.
 */

export type Capability =
  | "auth_settings"
  | "delivery"
  | "keys"
  | "end_users"
  | "data_requests"
  | "members"
  | "billing"
  | "audit"
  | "project";

export interface CapabilityInfo {
  id: Capability;
  label: string;
  note: string;
  /** Who has it. The owner has everything, so the owner is implied and not listed. */
  roles: readonly MemberRole[];
}

export const CAPABILITIES: readonly CapabilityInfo[] = [
  {
    id: "auth_settings",
    label: "Sign-in methods and token settings",
    note: "Passwords, passkeys, one-time codes, providers, lifetimes and claim templates.",
    roles: ["owner", "admin", "developer"],
  },
  {
    id: "delivery",
    label: "Email, SMS and domains",
    note: "Templates, sending domains, the SMS policy and what it may spend.",
    roles: ["owner", "admin", "developer"],
  },
  {
    id: "keys",
    label: "API keys and webhooks",
    note: "Creating a secret key hands over whatever the management API allows, which is why this is the line the roles below it stop at.",
    roles: ["owner", "admin", "developer"],
  },
  {
    id: "end_users",
    label: "Your users and their sessions",
    note: "Suspending an account, revoking a session, deleting somebody.",
    roles: ["owner", "admin", "developer"],
  },
  {
    id: "data_requests",
    label: "Data requests",
    note: "Logging an access or erasure request and marking it done. The deadline is statutory either way.",
    roles: ["owner", "admin", "developer"],
  },
  {
    id: "audit",
    label: "The audit log",
    note: "Reading what everybody did. Nobody can change it: the database grants no update or delete on that table to anyone.",
    roles: ["owner", "admin", "developer", "viewer"],
  },
  {
    id: "members",
    label: "The team",
    note: "Inviting, removing and changing what somebody may do.",
    roles: ["owner", "admin"],
  },
  {
    id: "billing",
    label: "Billing and usage",
    note: "The card, the invoices and what the month is costing.",
    roles: ["owner", "admin"],
  },
  {
    id: "project",
    label: "Transfer or delete the project",
    note: "The two acts nobody else can undo, so they belong to one seat.",
    roles: ["owner"],
  },
];

export function canRole(role: MemberRole, capability: Capability): boolean {
  return CAPABILITIES.find((entry) => entry.id === capability)?.roles.includes(role) ?? false;
}

/*
 * A member.
 */

export interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  /** Whether they hold a second factor for the dashboard. */
  mfaEnrolled: boolean;
  joinedAt: string;
  /** Null for somebody who has never signed in since being added. */
  lastActiveAt: string | null;
}

/** The one owner. Never null on a project that exists, and asserted by the transitions. */
export function ownerOf(members: readonly Member[]): Member | null {
  return members.find((member) => member.role === "owner") ?? null;
}

export function membersWithoutMfa(members: readonly Member[]): Member[] {
  return members.filter((member) => !member.mfaEnrolled);
}

/*
 * What one member may do to another.
 */

export type MemberAction = "change_role" | "remove" | "transfer";

export type ActionRefusal =
  | "not_permitted"
  | "owner_is_fixed"
  | "owner_cannot_leave"
  | "only_owner_transfers";

export const REFUSAL_LABELS: Record<ActionRefusal, string> = {
  not_permitted: "Only an owner or an admin can change the team.",
  owner_is_fixed:
    "The owner's role cannot be changed. Transfer the project instead, which moves it in one act rather than leaving two owners or none.",
  owner_cannot_leave:
    "The owner cannot be removed. Transfer the project to somebody else first, and then they can remove you.",
  only_owner_transfers: "Only the owner can hand the project on.",
};

/**
 * Whether the actor may do this to the target, and why not when they may not.
 *
 * A refusal is a sentence rather than a hidden button. Somebody who cannot do a thing
 * should be told which rule stopped them, or they will conclude the page is broken and
 * ask somebody who can.
 */
export function refusalFor(
  action: MemberAction,
  actor: Member,
  target: Member,
): ActionRefusal | null {
  if (action === "transfer") {
    return actor.role === "owner" ? null : "only_owner_transfers";
  }
  if (!canRole(actor.role, "members")) return "not_permitted";
  if (target.role === "owner") {
    return action === "remove" ? "owner_cannot_leave" : "owner_is_fixed";
  }
  return null;
}

export function mayAct(action: MemberAction, actor: Member, target: Member): boolean {
  return refusalFor(action, actor, target) === null;
}

/*
 * Changing the team.
 */

/**
 * Gives somebody a different role. Ownership is not assignable here: a change that tried
 * to would either make a second owner or leave the project without one, and both are
 * states nothing else on this screen knows how to read.
 */
export function withRole(members: readonly Member[], id: string, role: MemberRole): Member[] {
  const target = members.find((member) => member.id === id);
  if (!target || target.role === "owner" || role === "owner") return [...members];
  return members.map((member) => (member.id === id ? { ...member, role } : member));
}

/**
 * Moves the project to somebody else. One act: the new owner is promoted and the old one
 * becomes an admin in the same change, so there is never a moment with two owners and
 * never one with none.
 */
export function afterTransfer(members: readonly Member[], toId: string): Member[] {
  const target = members.find((member) => member.id === toId);
  if (!target || target.role === "owner") return [...members];
  return members.map((member) => {
    if (member.id === toId) return { ...member, role: "owner" as const };
    return member.role === "owner" ? { ...member, role: "admin" as const } : member;
  });
}

/** Takes somebody off the team. The owner is refused, which is what keeps the seat filled. */
export function withoutMember(members: readonly Member[], id: string): Member[] {
  const target = members.find((member) => member.id === id);
  if (!target || target.role === "owner") return [...members];
  return members.filter((member) => member.id !== id);
}

/*
 * Invitations.
 */

export interface Invitation {
  id: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

/**
 * How long an invitation stands. A week: long enough for somebody on holiday, short
 * enough that a link in a mailbox nobody reads is not a way into a project a year later.
 */
export const INVITE_TTL_DAYS = 7;

export function inviteExpiresAt(invitedAt: Date): string {
  return new Date(invitedAt.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
}

export function isInviteExpired(invitation: Invitation, now: Date): boolean {
  return new Date(invitation.expiresAt) <= now;
}

export type InviteIssue = "email_invalid" | "already_member" | "already_invited";

export const INVITE_ISSUE_LABELS: Record<InviteIssue, string> = {
  email_invalid: "An address the invitation can be sent to.",
  already_member: "That person is already on this team.",
  already_invited:
    "They already have an invitation waiting. Resend it rather than making a second one, or two links exist and only one can be used.",
};

/* Deliberately permissive: an address is proved by the invitation arriving at it, not by
   a pattern here, and a regular expression that refuses a valid address is worse than one
   that accepts an invalid one nobody can act on. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInvite(
  email: string,
  members: readonly Member[],
  invitations: readonly Invitation[],
): InviteIssue | null {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) return "email_invalid";
  if (members.some((member) => member.email.toLowerCase() === address)) return "already_member";
  if (invitations.some((invitation) => invitation.email.toLowerCase() === address)) {
    return "already_invited";
  }
  return null;
}

/*
 * What the team costs.
 */

/**
 * Nothing. There is no per-seat line in the price list and there is not going to be one:
 * a team charged by the head is a team that shares a login, and shared logins are what
 * this product exists to end. Stated on the screen because every comparable product does
 * charge, so a reader assumes it until told.
 */
export const SEATS_ARE_FREE = true;
