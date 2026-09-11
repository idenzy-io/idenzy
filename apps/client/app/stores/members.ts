/**
 * The organisation's team, its pending invitations, and whether the dashboard demands a
 * second factor of them.
 *
 * Keyed by organisation and never by project. A person is invited to an organisation and
 * reaches every project under it, which is what the schema says by hanging `org_id` off
 * `projects`, and it is the answer to the scope P1 the members note raises: a removal has
 * to name what access actually ends, and "this project" would be a lie on an organisation
 * holding three.
 *
 * The names here are the ones the audit log's placeholder writes about, deliberately: two
 * screens inventing two teams would be two screens nobody could read against each other,
 * and "who changed the role of Ana Rodríguez" has to be answerable from this page.
 *
 * Who is signed in is a placeholder too. Every rule on this screen is about what one
 * member may do to another, so a screen with no "you" in it could not be built at all.
 *
 * A placeholder until the management client exists, like every store here.
 */

import {
  afterTransfer,
  type Invitation,
  inviteExpiresAt,
  type Member,
  type MemberRole,
  withoutMember,
  withRole,
} from "~/utils/members";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useMembersStore = defineStore("members", () => {
  const members = ref<Record<string, Member[]>>({});
  const invitations = ref<Record<string, Invitation[]>>({});
  /** Whether the dashboard requires a second factor of everybody on the team. */
  const requireMfa = ref<Record<string, boolean>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  /** The signed-in member, which every rule on the screen is measured against. */
  const currentId = "mem_hasan";

  setTimeout(() => {
    members.value = { org_hasan: [soloTeam()], org_acme: acmeTeam() };
    invitations.value = { org_hasan: [], org_acme: acmeInvitations() };
    requireMfa.value = { org_hasan: false, org_acme: true };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forOrg(orgId: string): Member[] {
    return members.value[orgId] ?? [];
  }

  function invitationsFor(orgId: string): Invitation[] {
    return invitations.value[orgId] ?? [];
  }

  /** Who is reading the page. Falls back to the owner, so a rule always has an actor. */
  function currentMember(orgId: string): Member | null {
    const team = forOrg(orgId);
    return (
      team.find((member) => member.id === currentId) ??
      team.find((member) => member.role === "owner") ??
      null
    );
  }

  function mfaRequired(orgId: string): boolean {
    return requireMfa.value[orgId] ?? false;
  }

  function stamp(orgId: string) {
    lastSaved.value = { ...lastSaved.value, [orgId]: new Date().toISOString() };
  }

  function write(orgId: string, next: Member[]) {
    members.value = { ...members.value, [orgId]: next };
    stamp(orgId);
  }

  async function setRole(orgId: string, id: string, role: MemberRole): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(orgId, withRole(forOrg(orgId), id, role));
  }

  async function remove(orgId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(orgId, withoutMember(forOrg(orgId), id));
  }

  /** One act: the new owner is promoted and the old one becomes an admin together. */
  async function transfer(orgId: string, toId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(orgId, afterTransfer(forOrg(orgId), toId));
  }

  async function setMfaRequired(orgId: string, required: boolean): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    requireMfa.value = { ...requireMfa.value, [orgId]: required };
    stamp(orgId);
  }

  function writeInvites(orgId: string, next: Invitation[]) {
    invitations.value = { ...invitations.value, [orgId]: next };
    stamp(orgId);
  }

  async function invite(orgId: string, email: string, role: MemberRole): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const invitedAt = new Date();
    const by = currentMember(orgId)?.name ?? "Somebody on the team";
    writeInvites(orgId, [
      {
        id: `inv_${randomHex(10)}`,
        email: email.trim().toLowerCase(),
        role,
        invitedBy: by,
        invitedAt: invitedAt.toISOString(),
        expiresAt: inviteExpiresAt(invitedAt),
      },
      ...invitationsFor(orgId),
    ]);
  }

  /** Sends it again and restarts the week, because an expired link is the usual reason. */
  async function resend(orgId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const at = new Date();
    writeInvites(
      orgId,
      invitationsFor(orgId).map((invitation) =>
        invitation.id === id
          ? { ...invitation, invitedAt: at.toISOString(), expiresAt: inviteExpiresAt(at) }
          : invitation,
      ),
    );
  }

  async function revoke(orgId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    writeInvites(
      orgId,
      invitationsFor(orgId).filter((invitation) => invitation.id !== id),
    );
  }

  function lastSavedAt(orgId: string): string | null {
    return lastSaved.value[orgId] ?? null;
  }

  return {
    members,
    invitations,
    loading,
    currentId,
    forOrg,
    invitationsFor,
    currentMember,
    mfaRequired,
    setRole,
    remove,
    transfer,
    setMfaRequired,
    invite,
    resend,
    revoke,
    lastSavedAt,
  };
});

/*
 * The placeholder.
 */

function randomHex(bytes: number): string {
  let out = "";
  for (let index = 0; index < bytes * 2; index += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** A personal organisation: one member, which is what makes it personal rather than a team. */
function soloTeam(): Member {
  return {
    id: "mem_hasan",
    name: "Hasan Musluoglu",
    email: "hasan@example.com",
    role: "owner",
    mfaEnrolled: true,
    joinedAt: daysAgo(240),
    lastActiveAt: daysAgo(0),
  };
}

/** The team the audit log writes about, so the two screens name the same people. */
function acmeTeam(): Member[] {
  return [
    {
      id: "mem_hasan",
      name: "Hasan Musluoglu",
      email: "hasan@example.com",
      role: "owner",
      mfaEnrolled: true,
      joinedAt: daysAgo(240),
      lastActiveAt: daysAgo(0),
    },
    {
      id: "mem_ana",
      name: "Ana Rodríguez",
      email: "ana@acme.com",
      role: "admin",
      mfaEnrolled: true,
      joinedAt: daysAgo(180),
      lastActiveAt: daysAgo(0),
    },
    {
      id: "mem_pieter",
      name: "Pieter de Vries",
      email: "pieter@acme.com",
      role: "developer",
      mfaEnrolled: true,
      joinedAt: daysAgo(96),
      lastActiveAt: daysAgo(2),
    },
    {
      /* One without a second factor, because that is the state the requirement is for. */
      id: "mem_mei",
      name: "Mei Tanaka",
      email: "mei@acme.com",
      role: "developer",
      mfaEnrolled: false,
      joinedAt: daysAgo(31),
      lastActiveAt: daysAgo(9),
    },
    {
      /* Invited, accepted, never came back. A row that reads as a question. */
      id: "mem_auditor",
      name: "Lucie Fontaine",
      email: "lucie@auditpartners.fr",
      role: "viewer",
      mfaEnrolled: false,
      joinedAt: daysAgo(14),
      lastActiveAt: null,
    },
  ];
}

function acmeInvitations(): Invitation[] {
  return [
    {
      id: "inv_fresh",
      email: "sam.oduya@acme.com",
      role: "developer",
      invitedBy: "Ana Rodríguez",
      invitedAt: daysAgo(2),
      expiresAt: inviteExpiresAt(new Date(Date.now() - 2 * 86_400_000)),
    },
    {
      /* Expired, which is the row the resend button exists for. */
      id: "inv_stale",
      email: "contractor@example.dev",
      role: "viewer",
      invitedBy: "Hasan Musluoglu",
      invitedAt: daysAgo(11),
      expiresAt: inviteExpiresAt(new Date(Date.now() - 11 * 86_400_000)),
    },
  ];
}
