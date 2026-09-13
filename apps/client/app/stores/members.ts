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
 * `/v1/orgs/:orgId/members` is the real list now, joined by the API to the dashboard
 * project's own accounts for the name, the address and the second factor beside each
 * membership. Who is reading the page is real too: `/v1/me` names the caller's own
 * membership and nobody else's, so `currentId` is that id rather than a constant. Every rule
 * on this screen is about what one member may do to another, and a wrong "you" is a wrong
 * rule rather than a cosmetic slip.
 *
 * Two refusals here are facts about the page rather than failures of it. Reading who has
 * been invited is an admin's, so a developer or a viewer is refused and gets an empty list
 * instead of a warning about something they were never meant to see. And the service refuses
 * to demote or remove the owner, because an organisation without one has nobody who can
 * transfer it — the screen says so already, and the store keeps the server's answer rather
 * than an optimistic one of its own when it does not.
 *
 * **Nothing sends an invitation.** The row and its hashed token are real and there is no
 * transport wired to that path, so an address that was invited looks exactly like one that
 * was invited and ignored.
 */

import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type {
  OrgInvitation as ApiInvitation,
  OrgMember as ApiMember,
  OrgInvitationList,
  OrgMemberList,
  OrgSecurity,
} from "@idenzy/protocol/schemas/management";
import { type Invitation, type Member, type MemberRole, withoutMember } from "~/utils/members";
import { isRefusal, managementMessage } from "~/utils/sign-in-errors";

export const useMembersStore = defineStore("members", () => {
  const bootstrap = useBootstrapStore();
  const projects = useProjectStore();

  const members = ref<Record<string, Member[]>>({});
  const invitations = ref<Record<string, Invitation[]>>({});
  /** Whether the dashboard requires a second factor of everybody on the team. */
  const requireMfa = ref<Record<string, boolean>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);
  const lastSaved = ref<Record<string, string>>({});

  /** Non-reactive on purpose: writing a ref inside a computed re-invalidates the computed. */
  const requested = new Set<string>();

  function path(orgId: string): string {
    return `/v1/orgs/${orgId}/members`;
  }

  async function read<T>(url: string): Promise<T | null> {
    const { data, error } = await useManagementApi()(url).get().json<T>();
    if (error.value !== null) throw error.value;
    return data.value;
  }

  /* Written out rather than passed through, so a change to the wire shape is a type error
     here instead of a field the screen silently stops showing. */
  function presentMember(member: ApiMember): Member {
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      mfaEnrolled: member.mfaEnrolled,
      joinedAt: member.joinedAt,
      lastActiveAt: member.lastActiveAt,
    };
  }

  function presentInvitation(invitation: ApiInvitation): Invitation {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.invitedAt,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Reads the team and the security setting together, then the invitations.
   *
   * The first two in one flight because the band of facts at the top of the screen reads
   * both, and two sequential round trips to fill one band is a band that fills twice.
   */
  async function load(orgId: string): Promise<void> {
    loading.value = true;
    refusal.value = null;
    try {
      const [team, security] = await Promise.all([
        read<OrgMemberList>(path(orgId)),
        read<OrgSecurity>(`${path(orgId)}/security`),
      ]);
      members.value = { ...members.value, [orgId]: (team?.members ?? []).map(presentMember) };
      requireMfa.value = { ...requireMfa.value, [orgId]: security?.requireMfa ?? false };
      await loadInvitations(orgId);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Separate because it is the one read on this screen a member of the team can be refused.
   *
   * `insufficient_scope` leaves the list empty and says nothing: a viewer who cannot see the
   * invitations is not a viewer whose page is broken. Anything else is a real failure and
   * goes back to `load`, which has the banner.
   */
  async function loadInvitations(orgId: string): Promise<void> {
    try {
      const answer = await read<OrgInvitationList>(`${path(orgId)}/invitations`);
      invitations.value = {
        ...invitations.value,
        [orgId]: (answer?.invitations ?? []).map(presentInvitation),
      };
    } catch (cause: unknown) {
      if (!isRefusal(cause, ErrorCode.InsufficientScope)) throw cause;
      invitations.value = { ...invitations.value, [orgId]: [] };
    }
  }

  /** Loads once per organisation, for the screens that read the team without owning it. */
  function ensure(orgId: string): void {
    if (requested.has(orgId)) return;
    requested.add(orgId);
    void load(orgId);
  }

  function forOrg(orgId: string): Member[] {
    ensure(orgId);
    return members.value[orgId] ?? [];
  }

  function invitationsFor(orgId: string): Invitation[] {
    ensure(orgId);
    return invitations.value[orgId] ?? [];
  }

  function mfaRequired(orgId: string): boolean {
    ensure(orgId);
    return requireMfa.value[orgId] ?? false;
  }

  /** The caller's own membership of one organisation, which `/v1/me` names and nothing else. */
  function memberIdOf(orgId: string): string | null {
    return bootstrap.organisations.find((org) => org.id === orgId)?.memberId ?? null;
  }

  /**
   * Which row on this screen is you.
   *
   * The organisation on screen, because the screens read it without an argument and every
   * rule this store enforces is about the current one. Empty until the bootstrap answers,
   * which is the tick before any of them render.
   */
  const currentId = computed(() => memberIdOf(projects.currentOrg.id) ?? "");

  /**
   * You, as a row of the team.
   *
   * Null rather than falling back to the owner, which is what the placeholder did: an actor
   * this store guessed would be an actor the rules are measured against, and "can I remove
   * this person" answered for somebody else is worse than not answered at all.
   */
  function currentMember(orgId: string): Member | null {
    const id = memberIdOf(orgId);
    if (id === null) return null;
    return forOrg(orgId).find((member) => member.id === id) ?? null;
  }

  function stamp(orgId: string): void {
    lastSaved.value = { ...lastSaved.value, [orgId]: new Date().toISOString() };
  }

  /**
   * Runs one write and records what it refused.
   *
   * Caught here rather than thrown at the screen, which is the convention every wired store
   * in this panel keeps: the dialogs close on the awaited call returning, so a rejection
   * would leave one open under an unhandled promise. The refusal is a sentence on the page
   * instead.
   */
  async function attempt(orgId: string, work: () => Promise<void>): Promise<void> {
    refusal.value = null;
    try {
      await work();
      stamp(orgId);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    }
  }

  /**
   * Gives somebody a different role.
   *
   * Ownership is refused here as well as on the wire, where the enum does not contain it, so
   * the screen does not turn one of its own rules into a 400. Moving ownership is `transfer`,
   * which promotes and demotes in one act.
   */
  async function setRole(orgId: string, id: string, role: MemberRole): Promise<void> {
    if (role === "owner") return;
    await attempt(orgId, async () => {
      const { data, error } = await useManagementApi()(`${path(orgId)}/${id}`)
        .patch({ role })
        .json<ApiMember>();
      if (error.value !== null) throw error.value;
      const updated = data.value;
      if (updated === null) return;
      members.value = {
        ...members.value,
        [orgId]: forOrg(orgId).map((member) =>
          member.id === id ? presentMember(updated) : member,
        ),
      };
    });
  }

  async function remove(orgId: string, id: string): Promise<void> {
    await attempt(orgId, async () => {
      const { error } = await useManagementApi()(`${path(orgId)}/${id}`).delete();
      if (error.value !== null) throw error.value;
      // The helper rather than a filter: it is where "the owner cannot be removed" is
      // written down, and the service refuses the same thing a moment earlier.
      members.value = { ...members.value, [orgId]: withoutMember(forOrg(orgId), id) };
    });
  }

  /** One act: the new owner is promoted and the old one demoted, in the API's own statement. */
  async function transfer(orgId: string, toId: string): Promise<void> {
    await attempt(orgId, async () => {
      const { data, error } = await useManagementApi()(`${path(orgId)}/transfer`)
        .post({ memberId: toId })
        .json<OrgMemberList>();
      if (error.value !== null) throw error.value;
      const team = data.value;
      if (team === null) return;
      members.value = { ...members.value, [orgId]: team.members.map(presentMember) };
    });
  }

  async function setMfaRequired(orgId: string, required: boolean): Promise<void> {
    await attempt(orgId, async () => {
      const { data, error } = await useManagementApi()(`${path(orgId)}/security`)
        .patch({ requireMfa: required })
        .json<OrgSecurity>();
      if (error.value !== null) throw error.value;
      requireMfa.value = { ...requireMfa.value, [orgId]: data.value?.requireMfa ?? required };
    });
  }

  /** Creates the invitation. Nothing sends it; see the note at the top of this file. */
  async function invite(orgId: string, email: string, role: MemberRole): Promise<void> {
    if (role === "owner") return;
    await attempt(orgId, async () => {
      const { data, error } = await useManagementApi()(`${path(orgId)}/invitations`)
        .post({ email: email.trim().toLowerCase(), role })
        .json<ApiInvitation>();
      if (error.value !== null) throw error.value;
      const created = data.value;
      if (created === null) return;
      invitations.value = {
        ...invitations.value,
        [orgId]: [presentInvitation(created), ...invitationsFor(orgId)],
      };
    });
  }

  /** Sends it again and restarts the week. The old token stops working in the same statement. */
  async function resend(orgId: string, id: string): Promise<void> {
    await attempt(orgId, async () => {
      const url = `${path(orgId)}/invitations/${id}/resend`;
      // An empty object rather than no body: Fastify refuses a POST that declares a JSON
      // content-type and carries nothing, before the handler is ever reached.
      const { error } = await useManagementApi()(url).post({});
      if (error.value !== null) throw error.value;
      // Re-read rather than patched: the new deadline is the server's clock, and one invented
      // here is the date the row shows and the link in the mailbox disputes.
      await loadInvitations(orgId);
    });
  }

  async function revoke(orgId: string, id: string): Promise<void> {
    await attempt(orgId, async () => {
      const { error } = await useManagementApi()(`${path(orgId)}/invitations/${id}`).delete();
      if (error.value !== null) throw error.value;
      invitations.value = {
        ...invitations.value,
        [orgId]: invitationsFor(orgId).filter((invitation) => invitation.id !== id),
      };
    });
  }

  function lastSavedAt(orgId: string): string | null {
    return lastSaved.value[orgId] ?? null;
  }

  return {
    members,
    invitations,
    loading,
    refusal,
    currentId,
    load,
    ensure,
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
