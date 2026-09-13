import type { PatchProjectSettings, ProjectSettings } from "@idenzy/protocol/schemas/management";
import { managementMessage } from "~/utils/sign-in-errors";

/** The sections of the settings document a store can own. */
export type SettingsSection = keyof PatchProjectSettings;

export interface SectionState<T> {
  /** Every project's value for this section, as the server last answered. */
  readonly byProject: Ref<Record<string, T>>;
  readonly loading: Ref<boolean>;
  readonly refusal: Ref<string | null>;
  load: (projectId: string) => Promise<void>;
  /** Reads the cache and starts the first load. Safe inside a computed. */
  valueFor: (projectId: string) => T;
  /** Replaces the section with `next` and keeps whatever the server stored. */
  save: (projectId: string, next: T) => Promise<void>;
  lastSavedAt: (projectId: string) => string | null;
}

/**
 * One section of a project's settings document, as a store's whole data layer.
 *
 * Five screens own a section each and each one wants the same four things: read it, keep
 * it per project, write it, and say when it was last written. Writing that five times is
 * five chances to get the patch semantics subtly different — and the semantics are the
 * part that matters, because the API replaces a section whole rather than deep-merging, so
 * a caller that sends a partial section silently resets the fields it left out.
 *
 * `save` therefore takes the complete section. The screens edit one control at a time and
 * lay the change over the current value themselves, which is visible at the call site
 * rather than hidden in a merge nobody reads.
 *
 * What comes back is what is stored, and it is what is kept: a value the server clamped, a
 * default it filled in, or a change another operator made a moment ago must not be
 * overwritten on screen by the optimistic copy this call happened to send.
 */
export function useSettingsSection<K extends SettingsSection>(
  section: K,
  fallback: () => NonNullable<ProjectSettings[K]>,
): SectionState<NonNullable<ProjectSettings[K]>> {
  type Value = NonNullable<ProjectSettings[K]>;

  const projects = useProjectStore();
  const byProject = ref<Record<string, Value>>({}) as Ref<Record<string, Value>>;
  const loading = ref(false);
  const refusal = ref<string | null>(null);
  const lastSaved = ref<Record<string, string>>({});
  /** Non-reactive: mutating a ref inside a computed would re-invalidate the computed. */
  const requested = new Set<string>();

  function path(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/settings`;
  }

  function absorb(projectId: string, settings: ProjectSettings | null): void {
    const value = settings?.[section];
    if (value === undefined) return;
    byProject.value = { ...byProject.value, [projectId]: value as Value };
  }

  async function load(projectId: string): Promise<void> {
    const url = path(projectId);
    if (url === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const { data, error } = await useManagementApi()(url).get().json<ProjectSettings>();
      if (error.value !== null) throw error.value;
      absorb(projectId, data.value);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function valueFor(projectId: string): Value {
    if (!requested.has(projectId)) {
      requested.add(projectId);
      void load(projectId);
    }
    // The defaults are the same values the server resolves an unset document to, so a
    // screen that has not loaded yet shows what an unconfigured project actually does
    // rather than a blank form.
    return byProject.value[projectId] ?? fallback();
  }

  async function save(projectId: string, next: Value): Promise<void> {
    const url = path(projectId);
    if (url === null) return;
    try {
      const { data, error } = await useManagementApi()(url)
        .patch({ [section]: next } as PatchProjectSettings)
        .json<ProjectSettings>();
      if (error.value !== null) throw error.value;
      absorb(projectId, data.value ?? null);
      lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
      throw cause;
    }
  }

  return {
    byProject,
    loading,
    refusal,
    load,
    valueFor,
    save,
    lastSavedAt: (projectId: string) => lastSaved.value[projectId] ?? null,
  };
}
