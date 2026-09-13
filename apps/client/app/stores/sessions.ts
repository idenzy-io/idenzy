/**
 * Every session on every project the panel can show, and the one thing this screen does
 * to them: end one.
 *
 * The list is the management API's answer now. The account is still joined at read time
 * from the users store rather than copied onto the row, and that is the same decision it
 * always was for a better reason now that both are real: the two screens would otherwise
 * be two lists of people that can disagree, and an erasure on the other one has to arrive
 * here — a session row is nothing but columns that name a person, so an account with
 * `deletedAt` set takes its sessions with it (PROJECT.md 4.13.6).
 *
 * Two fields the server sends as absences rather than guesses, and the screen says so.
 * `deviceBound` is false everywhere because device-bound refresh tokens are 4.4 and phase
 * 3, with no column to read; `network` is null because the IP intelligence behind it is a
 * lookup over a provider we do not have. Both were invented by the generator this replaces,
 * which is exactly the "simulated capability" notes/priorities.md puts first.
 *
 * What revoking does not do is reach the access tokens already minted: those verify
 * offline until they expire unless the customer polls the revocation set (ADR-0009). The
 * dialog is where that is said, and the store must not behave as though it were otherwise.
 */

import type {
  ProjectSession as ApiProjectSession,
  ProjectSessionList,
  RevokedSessions,
} from "@idenzy/protocol/schemas/management";
import type { ProjectSession, RevokeReason, SessionRow } from "~/utils/sessions";
import { managementMessage } from "~/utils/sign-in-errors";

/** One read covers the screen; past this it wants server-side filtering, not more pages. */
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

export const useSessionsStore = defineStore("sessions", () => {
  const users = useUsersStore();
  const projects = useProjectStore();

  const byProject = ref<Record<string, ProjectSession[]>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);
  /** Non-reactive on purpose: mutating a ref inside a computed re-invalidates the computed. */
  const requested = new Set<string>();

  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/sessions`;
  }

  function present(session: ApiProjectSession): ProjectSession {
    return {
      id: session.id,
      projectId: session.projectId,
      userId: session.userId,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      ip: session.ip,
      // Null rather than a plausible verdict: nothing looks an address up yet.
      network: null,
      userAgent: session.userAgent,
      amr: session.amr as ProjectSession["amr"],
      factorVerifiedAt: session.factorVerifiedAt,
      deviceBound: session.deviceBound,
      lastActiveAt: session.lastActiveAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: session.revokedAt,
      revokeReason: session.revokeReason as RevokeReason | null,
      createdAt: session.createdAt,
    };
  }

  async function page(path: string, cursor: string | null): Promise<ProjectSessionList> {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), includeRevoked: "true" });
    if (cursor !== null) query.set("cursor", cursor);
    const { data, error } = await useManagementApi()(`${path}?${query.toString()}`)
      .get()
      .json<ProjectSessionList>();
    if (error.value !== null) throw error.value;
    return data.value ?? { sessions: [], nextCursor: null };
  }

  /**
   * Reads the project's sessions, revoked ones included.
   *
   * `includeRevoked` is on because the screen has a filter for them and a column that
   * shows why one ended; leaving them on the server would make that filter a lie about
   * what exists rather than a view of it.
   */
  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const collected: ProjectSession[] = [];
      let cursor: string | null = null;
      for (let read = 0; read < MAX_PAGES; read += 1) {
        const answer: ProjectSessionList = await page(path, cursor);
        collected.push(...answer.sessions.map(present));
        cursor = answer.nextCursor;
        if (cursor === null) break;
      }
      byProject.value = { ...byProject.value, [projectId]: collected };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function ensure(projectId: string): void {
    if (requested.has(projectId)) return;
    requested.add(projectId);
    void load(projectId);
  }

  /** The sessions of one project, with the account each belongs to joined on. */
  function forProject(projectId: string): SessionRow[] {
    ensure(projectId);
    const byId = new Map(users.forProject(projectId).map((user) => [user.id, user]));
    const rows: SessionRow[] = [];
    for (const session of byProject.value[projectId] ?? []) {
      const user = byId.get(session.userId);
      // A session whose account has gone is not a row: an erasure took it with the account.
      if (user !== undefined) rows.push({ ...session, user });
    }
    return rows;
  }

  /**
   * Ends the named sessions and reports how many were live to end.
   *
   * One call for the whole set rather than one per row: the selection bar ends a set, and
   * a request per row half-succeeds on a slow link and leaves no single answer about what
   * happened. The rows are re-read afterwards rather than patched, because `revoked_at` is
   * the server's timestamp and one invented here is the one the screen shows and the audit
   * trail disputes.
   */
  async function revoke(
    ids: readonly string[],
    _reason: RevokeReason = "admin_revoked",
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const projectId = projectOf(ids[0] ?? "");
    const path = projectId === null ? null : basePath(projectId);
    if (path === null || projectId === null) return 0;

    try {
      const { data, error } = await useManagementApi()(`${path}/revoke`)
        .post({ sessionIds: [...ids] })
        .json<RevokedSessions>();
      if (error.value !== null) throw error.value;
      const ended = data.value?.revoked ?? 0;
      // Both lists are re-read: `activeSessions` on the users screen is defined as what is
      // still live here, and the two disagreeing is the bug this join exists to avoid.
      await load(projectId);
      await users.load(projectId);
      return ended;
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
      return 0;
    }
  }

  function projectOf(sessionId: string): string | null {
    for (const [projectId, list] of Object.entries(byProject.value)) {
      if (list.some((session) => session.id === sessionId)) return projectId;
    }
    return null;
  }

  /** Every session the store holds, for the screens that watch the whole set. */
  const sessions = computed(() => Object.values(byProject.value).flat());

  return { sessions, loading, refusal, load, ensure, forProject, revoke };
});
