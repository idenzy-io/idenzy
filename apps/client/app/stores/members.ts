/**
 * The project's team, its pending invitations, and whether the dashboard demands a second
 * factor of them.
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
    members.value = { prj_personal: [soloTeam()], prj_acme: acmeTeam() };
    invitations.value = { prj_personal: [], prj_acme: acmeInvitations() };
    requireMfa.value = { prj_personal: false, prj_acme: true };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): Member[] {
    return members.value[projectId] ?? [];
  }

  function invitationsFor(projectId: string): Invitation[] {
    return invitations.value[projectId] ?? [];
  }

  /** Who is reading the page. Falls back to the owner, so a rule always has an actor. */
  function currentMember(projectId: string): Member | null {
    const team = forProject(projectId);
    return (
      team.find((member) => member.id === currentId) ??
      team.find((member) => member.role === "owner") ??
      null
    );
  }

  function mfaRequired(projectId: string): boolean {
    return requireMfa.value[projectId] ?? false;
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function write(projectId: string, next: Member[]) {
    members.value = { ...members.value, [projectId]: next };
    stamp(projectId);
  }

  async function setRole(projectId: string, id: string, role: MemberRole): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, withRole(forProject(projectId), id, role));
  }

  async function remove(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, withoutMember(forProject(projectId), id));
  }

  /** One act: the new owner is promoted and the old one becomes an admin together. */
  async function transfer(projectId: string, toId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, afterTransfer(forProject(projectId), toId));
  }

  async function setMfaRequired(projectId: string, required: boolean): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    requireMfa.value = { ...requireMfa.value, [projectId]: required };
    stamp(projectId);
  }

  function writeInvites(projectId: string, next: Invitation[]) {
    invitations.value = { ...invitations.value, [projectId]: next };
    stamp(projectId);
  }

  async function invite(projectId: string, email: string, role: MemberRole): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const invitedAt = new Date();
    const by = currentMember(projectId)?.name ?? "Somebody on the team";
    writeInvites(projectId, [
      {
        id: `inv_${randomHex(10)}`,
        email: email.trim().toLowerCase(),
        role,
        invitedBy: by,
        invitedAt: invitedAt.toISOString(),
        expiresAt: inviteExpiresAt(invitedAt),
      },
      ...invitationsFor(projectId),
    ]);
  }

  /** Sends it again and restarts the week, because an expired link is the usual reason. */
  async function resend(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const at = new Date();
    writeInvites(
      projectId,
      invitationsFor(projectId).map((invitation) =>
        invitation.id === id
          ? { ...invitation, invitedAt: at.toISOString(), expiresAt: inviteExpiresAt(at) }
          : invitation,
      ),
    );
  }

  async function revoke(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    writeInvites(
      projectId,
      invitationsFor(projectId).filter((invitation) => invitation.id !== id),
    );
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return {
    members,
    invitations,
    loading,
    currentId,
    forProject,
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

/** A project one person made and nobody else has been added to. */
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
