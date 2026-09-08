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

  return { projects, current, select };
});
