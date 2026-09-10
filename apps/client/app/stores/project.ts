/**
 * The project the panel is showing.
 *
 * A store rather than state inside the switcher, because the switcher is not the only
 * reader: the bar's breadcrumb names the project, and every management API call will
 * carry its id. The list is a placeholder until that API answers with the projects the
 * signed-in user administers, and selecting one reloads nothing yet.
 */
export interface Project {
  id: string;
  name: string;
}

const personal: Project = { id: "prj_personal", name: "Personal Team" };

/** What a write takes, so a control can show its own wait rather than land instantly. */
const SAVE_LATENCY = 600;

export const useProjectStore = defineStore("project", () => {
  const projects = ref<Project[]>([personal, { id: "prj_acme", name: "Acme Inc." }]);
  const current = ref<Project>(personal);

  /**
   * Once the client exists this writes the id there and the screens re-fetch. Until
   * then it changes the name in the drawer and the bar, which is the whole shape.
   */
  function select(project: Project) {
    current.value = project;
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

  /**
   * Whether a project may be deleted at all.
   *
   * The last one may not. An organisation with no project has nothing for its own members
   * to sign in to and no screen in this panel that means anything, so the refusal is
   * kinder than the empty state it would otherwise reach.
   */
  const canDelete = computed(() => projects.value.length > 1);

  /** Removes one and moves to whatever is left, because the panel needs a project. */
  async function remove(id: string): Promise<void> {
    if (!canDelete.value) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const remaining = projects.value.filter((project) => project.id !== id);
    projects.value = remaining;
    const next = remaining[0];
    if (current.value.id === id && next) current.value = next;
  }

  return { projects, current, canDelete, select, rename, remove };
});
