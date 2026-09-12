/**
 * The project the panel is showing, and the organisation it belongs to.
 *
 * A store rather than state inside the switcher, because the switcher is not the only
 * reader: the bar's breadcrumb names the project, the settings and billing screens name
 * the organisation, and every management API call carries one id or the other.
 *
 * The lists come from `useBootstrapStore`, which loads them once from `GET /v1/me` when a
 * session appears. This store's shape is deliberately unchanged from when they were a
 * fixture — `Project` is still `{ id, name, orgId }`, every method keeps its name and
 * signature — because `projects.current` alone is read in 304 places. What changed is
 * where the data comes from and nothing else.
 *
 * The organisation is here rather than in a store of its own because nothing reads one
 * without the other: a project is always read in the context of the organisation that
 * pays for it, and two stores would be two answers to "which organisation am I in" the
 * first time a switch left one of them behind.
 *
 * The writes below are still placeholders. Renaming and deleting a project are management
 * API calls that do not exist yet, so they change the local list and say so here rather
 * than pretending to have persisted anything.
 */
import type { Org } from "~/utils/organisation";

export interface Project {
  id: string;
  name: string;
  /** The organisation that owns it. Members and billing belong to that, not to this. */
  orgId: string;
}

/** What a write takes, so a control can show its own wait rather than land instantly. */
const SAVE_LATENCY = 600;

/**
 * What `current` answers with before the bootstrap has answered, and only then.
 *
 * Every screen in the panel reads `projects.current.name` without checking, which is safe
 * because the route guard holds them all behind a loaded bootstrap. This exists so the
 * type is honest during the one tick before that is true, rather than for anybody to see.
 */
const PLACEHOLDER_PROJECT: Project = { id: "prj_loading", name: "…", orgId: "org_loading" };

const PLACEHOLDER_ORG: Org = { id: "org_loading", name: "…", createdAt: new Date(0).toISOString() };

export const useProjectStore = defineStore("project", () => {
  const bootstrap = useBootstrapStore();

  /**
   * Read through from the bootstrap rather than copied into refs of their own.
   *
   * A copy would need invalidating every time the bootstrap reloaded, and the one place
   * that reloads it is onboarding — exactly when the drawer has to show a project that
   * did not exist a moment ago. Deriving means there is nothing to forget to refresh.
   */
  const orgs = computed<Org[]>(() =>
    bootstrap.organisations.map((org) => ({
      id: org.id,
      name: org.name,
      // The organisation's own creation date is not on the wire and is read nowhere; the
      // membership's is the honest stand-in for "since when has this been mine".
      createdAt: org.joinedAt,
    })),
  );

  const projects = computed<Project[]>(() =>
    bootstrap.projects.map((project) => ({
      id: project.id,
      name: project.name,
      orgId: project.orgId,
    })),
  );

  /**
   * Which one the panel is showing.
   *
   * Null until the bootstrap answers, and `current` below never hands that null out: a
   * screen reading `projects.current.name` during the first paint would otherwise throw,
   * and every one of the 304 readers assumes a project is there. The guard is what makes
   * that assumption true — nothing inside the panel renders until there is one.
   */
  const selected = ref<string | null>(null);

  const current = computed<Project>(() => {
    const list = projects.value;
    const chosen = list.find((project) => project.id === selected.value);
    return chosen ?? list[0] ?? PLACEHOLDER_PROJECT;
  });

  /**
   * Once the client exists this writes the id there and the screens re-fetch. Until
   * then it changes the name in the drawer and the bar, which is the whole shape.
   */
  function select(project: Project) {
    selected.value = project.id;
  }

  function orgById(orgId: string): Org | null {
    return orgs.value.find((org) => org.id === orgId) ?? null;
  }

  /** The organisation the current project belongs to. Never null while a project exists. */
  const currentOrg = computed<Org>(
    () => orgById(current.value.orgId) ?? orgs.value[0] ?? PLACEHOLDER_ORG,
  );

  /** Every project the organisation holds, which is what one bill covers. */
  function projectsOf(orgId: string): Project[] {
    return projects.value.filter((project) => project.orgId === orgId);
  }

  /** The organisation a project is billed to. */
  function orgOf(projectId: string): Org | null {
    const project = projects.value.find((entry) => entry.id === projectId);
    return project ? orgById(project.orgId) : null;
  }

  /**
   * Renames one, in the list and in `current` together.
   *
   * Here rather than on the settings screen's own store because the name is what the
   * drawer, the breadcrumb and the switcher read, and a rename that updated a settings
   * page while the corner still said the old name would look like a write that failed.
   */
  async function rename(id: string, name: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    // Writes into the bootstrap, which is where the list lives now. Local only: there is
    // no management API route for a rename yet, so this is the screen keeping up with
    // itself rather than anything that survives a reload.
    bootstrap.projects = bootstrap.projects.map((project) =>
      project.id === id ? { ...project, name } : project,
    );
  }

  /** Renames the organisation, which the settings and billing screens both name. */
  async function renameOrg(id: string, name: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    bootstrap.organisations = bootstrap.organisations.map((org) =>
      org.id === id ? { ...org, name } : org,
    );
  }

  /**
   * Whether a project may be deleted at all.
   *
   * The last one in its organisation may not. An organisation with no project has
   * nothing for its own members to sign in to and no screen in this panel that means
   * anything, so the refusal is kinder than the empty state it would otherwise reach.
   */
  const canDelete = computed(() => projectsOf(current.value.orgId).length > 1);

  /** Removes one and moves to whatever is left, because the panel needs a project. */
  async function remove(id: string): Promise<void> {
    if (!canDelete.value) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const wasCurrent = current.value.id === id;
    bootstrap.projects = bootstrap.projects.filter((project) => project.id !== id);
    // Move before the list is read again, or `current` falls back to the first project of
    // whichever organisation happens to sort first.
    if (wasCurrent) {
      const next = projects.value.find((project) => project.orgId === currentOrg.value.id);
      selected.value = next?.id ?? projects.value[0]?.id ?? null;
    }
  }

  return {
    orgs,
    projects,
    current,
    currentOrg,
    canDelete,
    select,
    orgById,
    orgOf,
    projectsOf,
    rename,
    renameOrg,
    remove,
  };
});
