/**
 * The project the panel is showing, and the organisation it belongs to.
 *
 * A store rather than state inside the switcher, because the switcher is not the only
 * reader: the bar's breadcrumb names the project, the settings and billing screens name
 * the organisation, and every management API call will carry one id or the other. The
 * list is a placeholder until that API answers with the organisations the signed-in user
 * belongs to, and selecting a project reloads nothing yet.
 *
 * The organisation is here rather than in a store of its own because nothing reads one
 * without the other: a project is always read in the context of the organisation that
 * pays for it, and two stores would be two answers to "which organisation am I in" the
 * first time a switch left one of them behind.
 */
import type { Org } from "~/utils/organisation";
import { DURATIONS } from "~/utils/time";

export interface Project {
  id: string;
  name: string;
  /** The organisation that owns it. Members and billing belong to that, not to this. */
  orgId: string;
}

const ORGS: Org[] = [
  {
    id: "org_hasan",
    name: "Hasan's org",
    createdAt: new Date(Date.now() - 412 * DURATIONS.DAY).toISOString(),
  },
  {
    id: "org_acme",
    name: "Acme Inc.",
    createdAt: new Date(Date.now() - 240 * DURATIONS.DAY).toISOString(),
  },
];

const personal: Project = { id: "prj_personal", name: "Personal Team", orgId: "org_hasan" };

/** What a write takes, so a control can show its own wait rather than land instantly. */
const SAVE_LATENCY = 600;

export const useProjectStore = defineStore("project", () => {
  const orgs = ref<Org[]>(ORGS);
  const projects = ref<Project[]>([
    personal,
    { id: "prj_acme", name: "Acme Inc.", orgId: "org_acme" },
    /* A second project under the same organisation, because one wallet paying for two
       applications is the case the billing and settings screens are scoped against. */
    { id: "prj_acme_mobile", name: "Acme Mobile", orgId: "org_acme" },
  ]);
  const current = ref<Project>(personal);

  /**
   * Once the client exists this writes the id there and the screens re-fetch. Until
   * then it changes the name in the drawer and the bar, which is the whole shape.
   */
  function select(project: Project) {
    current.value = project;
  }

  function orgById(orgId: string): Org | null {
    return orgs.value.find((org) => org.id === orgId) ?? null;
  }

  /** The organisation the current project belongs to. Never null while a project exists. */
  const currentOrg = computed<Org>(
    () =>
      orgById(current.value.orgId) ??
      ORGS[0] ?? { id: "org_unknown", name: "Organisation", createdAt: new Date().toISOString() },
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
    projects.value = projects.value.map((project) =>
      project.id === id ? { ...project, name } : project,
    );
    if (current.value.id === id) current.value = { ...current.value, name };
  }

  /** Renames the organisation, which the settings and billing screens both name. */
  async function renameOrg(id: string, name: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    orgs.value = orgs.value.map((org) => (org.id === id ? { ...org, name } : org));
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
    const remaining = projects.value.filter((project) => project.id !== id);
    projects.value = remaining;
    const next = remaining.find((project) => project.orgId === current.value.orgId) ?? remaining[0];
    if (current.value.id === id && next) current.value = next;
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
