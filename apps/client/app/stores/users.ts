/**
 * The users of every project the panel can show, and what can be done to them.
 *
 * The list is the management API's answer now rather than a generated one. Two of the
 * actions carry a rule the server enforces and the screen has to say. A suspension takes
 * effect at the next token rotation, so an open session keeps working for up to one
 * access-token lifetime — the server deliberately does not end the sessions, and
 * `signOutEverywhere` is the separate thing to call when somebody means both. A deletion is
 * an erasure (PROJECT.md 4.13.6) and is **not wired**, because the field lists it operates
 * on come from `classified()` and the worker that runs them does not exist yet.
 *
 * `forProject` stays synchronous over a cache, because the screen reads it in a computed
 * and a fetch inside one is a request per render. `load` fills the cache; `ensure` is what
 * the screens that only read users indirectly — audit, sessions, security — lean on, since
 * they watch this list and would otherwise sit empty until somebody opened the Users page.
 *
 * Two actions have no endpoint and say so instead of pretending. Creating a user needs
 * password hashing in the management API, which has no `PasswordHasher`; erasing one needs
 * the DSR path. Both refuse with a message naming what is missing, which is the whole point
 * of notes/priorities.md's first row: a fixture switch must not imply working capability.
 */

import { InternalError } from "@idenzy/core/errors";
import type {
  ProjectUser as ApiProjectUser,
  ProjectUserList,
  RevokedSessions,
} from "@idenzy/protocol/schemas/management";
import { managementMessage } from "~/utils/sign-in-errors";
import type { ProjectUser, SignInMethod } from "~/utils/users";

export interface AddUserInput {
  email: string | null;
  phone: string | null;
  displayName: string | null;
  password: string | null;
  emailVerified: boolean;
}

/** How many a page asks for. The API caps at 100 and the screen never shows more. */
const PAGE_SIZE = 100;

/** Ten pages of a hundred. Past that the screen is not the right tool anyway. */
const MAX_PAGES = 10;

export const useUsersStore = defineStore("users", () => {
  const projects = useProjectStore();

  const byProject = ref<Record<string, ProjectUser[]>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);

  /**
   * Projects a load has already been started for.
   *
   * Without it `ensure` inside a computed is a request per render, which is the trap the
   * keys store names. A project appears here before the call resolves, so a second render
   * during the flight adds nothing.
   */
  const requested = ref<Set<string>>(new Set());

  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/users`;
  }

  function present(user: ApiProjectUser): ProjectUser {
    return {
      id: user.id,
      projectId: user.projectId,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      methods: user.methods as readonly SignInMethod[],
      mfaEnabled: user.mfaEnabled,
      activeSessions: user.activeSessions,
      bannedUntil: user.bannedUntil,
      lastSignInAt: user.lastSignInAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      metadataPublic: user.metadataPublic,
    };
  }

  /**
   * Reads every page the project has, up to the cap.
   *
   * The screen filters and sorts client-side, so it wants the set rather than a page; the
   * cursor is followed here instead of being pushed into the component. A project with more
   * users than the cap is the point at which this has to become server-side search, and the
   * loop stops rather than paging forever.
   */
  /** One page. Split out so `load` is a loop and an error handler and nothing else. */
  async function page(path: string, cursor: string | null): Promise<ProjectUserList> {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor !== null) query.set("cursor", cursor);
    const { data, error } = await useManagementApi()(`${path}?${query.toString()}`)
      .get()
      .json<ProjectUserList>();
    if (error.value !== null) throw error.value;
    return data.value ?? { users: [], nextCursor: null };
  }

  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const collected: ProjectUser[] = [];
      let cursor: string | null = null;
      // Ten pages of a hundred. Past that the screen is not the right tool anyway.
      for (let read = 0; read < MAX_PAGES; read += 1) {
        const answer: ProjectUserList = await page(path, cursor);
        collected.push(...answer.users.map(present));
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

  /** Loads once per project, for the screens that read this list without owning it. */
  function ensure(projectId: string): void {
    if (requested.value.has(projectId)) return;
    requested.value = new Set(requested.value).add(projectId);
    void load(projectId);
  }

  /** Every user this store has for the project. Triggers the first load, then is a read. */
  function forProject(projectId: string): ProjectUser[] {
    ensure(projectId);
    return byProject.value[projectId] ?? [];
  }

  /** Replaces the rows the server just answered with, wherever they are cached. */
  function absorb(updated: readonly ProjectUser[]): void {
    if (updated.length === 0) return;
    const byId = new Map(updated.map((user) => [user.id, user]));
    const next: Record<string, ProjectUser[]> = {};
    for (const [projectId, list] of Object.entries(byProject.value)) {
      next[projectId] = list.map((user) => byId.get(user.id) ?? user);
    }
    byProject.value = next;
  }

  function projectOf(id: string): string | null {
    for (const [projectId, list] of Object.entries(byProject.value)) {
      if (list.some((user) => user.id === id)) return projectId;
    }
    return null;
  }

  /**
   * Runs one call per user and answers with how many succeeded.
   *
   * Sequential rather than parallel, and that is the selection bar's semantics: a partial
   * failure has to leave the rows it did change changed, and a count the screen can report
   * honestly. `Promise.all` would abandon the remainder on the first refusal.
   */
  async function each(
    ids: readonly string[],
    call: (path: string, id: string) => Promise<ApiProjectUser | null>,
  ): Promise<number> {
    const updated: ProjectUser[] = [];
    let failed = 0;
    for (const id of ids) {
      const projectId = projectOf(id);
      const path = projectId === null ? null : basePath(projectId);
      if (path === null) {
        failed += 1;
        continue;
      }
      try {
        const answer = await call(path, id);
        if (answer !== null) updated.push(present(answer));
      } catch (cause: unknown) {
        refusal.value = managementMessage(cause);
        failed += 1;
      }
    }
    absorb(updated);
    return ids.length - failed;
  }

  async function suspend(ids: readonly string[], until: string): Promise<number> {
    const api = useManagementApi();
    return await each(ids, async (path, id) => {
      const { data, error } = await api(`${path}/${id}/suspend`)
        .post({ until })
        .json<ApiProjectUser>();
      if (error.value !== null) throw error.value;
      return data.value;
    });
  }

  async function restore(ids: readonly string[]): Promise<number> {
    const api = useManagementApi();
    return await each(ids, async (path, id) => {
      // An empty object rather than no body: Fastify refuses a POST that declares a JSON
      // content-type and carries nothing, before the handler is ever reached.
      const { data, error } = await api(`${path}/${id}/restore`).post({}).json<ApiProjectUser>();
      if (error.value !== null) throw error.value;
      return data.value;
    });
  }

  /**
   * Ends every session each account holds, and refreshes the counts from the server.
   *
   * The count of sessions is not returned by the revoke, so the user is re-read: reporting
   * "signed out everywhere" while the row on screen still says three live sessions is the
   * kind of half-truth this whole exercise is about removing.
   */
  /** Ends one account's sessions and reads the row back, so the count on screen is real. */
  async function revokeOne(path: string, id: string): Promise<{ revoked: number }> {
    const api = useManagementApi();
    const { data, error } = await api(`${path}/${id}/sessions/revoke`)
      .post({})
      .json<RevokedSessions>();
    if (error.value !== null) throw error.value;
    return { revoked: data.value?.revoked ?? 0 };
  }

  /**
   * Answers with how many sessions were ended, not how many accounts were touched.
   *
   * `each` does the caching, so this only has to sum. The re-read inside it is the point:
   * reporting "signed out everywhere" while the row on screen still says three live
   * sessions is exactly the half-truth this exercise is about removing.
   */
  async function signOutEverywhere(ids: readonly string[]): Promise<number> {
    let signedOut = 0;
    await each(ids, async (path, id) => {
      signedOut += (await revokeOne(path, id)).revoked;
      const { data, error } = await useManagementApi()(`${path}/${id}`)
        .get()
        .json<ApiProjectUser>();
      if (error.value !== null) throw error.value;
      return data.value;
    });
    return signedOut;
  }

  /** Kept for the sessions screen, which recounts locally after revoking one session. */
  function setActiveSessions(id: string, count: number): void {
    const projectId = projectOf(id);
    if (projectId === null) return;
    byProject.value = {
      ...byProject.value,
      [projectId]: (byProject.value[projectId] ?? []).map((user) =>
        user.id === id ? { ...user, activeSessions: count } : user,
      ),
    };
  }

  /** No endpoint. Creating an account needs password hashing the management API lacks. */
  function add(_projectId: string, _input: AddUserInput): Promise<ProjectUser> {
    return Promise.reject(
      new InternalError({
        detail: { reason: "creating a user from the panel is not built (todo.md 1.6)" },
      }),
    );
  }

  /** No endpoint. Erasure is the DSR path and its worker does not exist (PROJECT.md 4.13.6). */
  function remove(_ids: readonly string[]): Promise<number> {
    return Promise.reject(
      new InternalError({
        detail: { reason: "erasure runs through the DSR path, which is not built" },
      }),
    );
  }

  /** Every user the store holds, for the screens that watch the whole set. */
  const users = computed(() => Object.values(byProject.value).flat());

  return {
    users,
    loading,
    refusal,
    load,
    ensure,
    forProject,
    add,
    suspend,
    restore,
    signOutEverywhere,
    setActiveSessions,
    remove,
  };
});
