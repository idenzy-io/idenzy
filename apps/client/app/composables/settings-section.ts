import type { PatchProjectSettings, ProjectSettings } from "@idenzy/protocol/schemas/management";

/** The sections of the settings document a store can own. */
export type SettingsSection = keyof PatchProjectSettings;

export interface SectionState<T> {
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
 * A view over `useSettingsDocumentStore` rather than a cache of its own, and that is the
 * fix for a bug this composable used to cause: it held its own copy and its own in-flight
 * guard, so seven sections meant seven caches and seven requests for one document. A page
 * touching three of them made three identical GETs. The document is read once per project
 * now, however many sections ask.
 *
 * `save` takes the complete section, because the API replaces a section whole rather than
 * deep-merging — a caller sending a partial one silently resets the fields it left out. The
 * screens edit a control at a time and lay the change over the current value at the call
 * site, which is where it can be read, rather than inside a merge nobody looks at.
 */
export function useSettingsSection<K extends SettingsSection>(
  section: K,
  fallback: () => NonNullable<ProjectSettings[K]>,
): SectionState<NonNullable<ProjectSettings[K]>> {
  type Value = NonNullable<ProjectSettings[K]>;

  const document = useSettingsDocumentStore();
  const lastSaved = ref<Record<string, string>>({});

  /**
   * Every project's value for this section.
   *
   * Derived from the shared document rather than stored beside it, so there is one copy of
   * the truth. The screens that watch a whole map still get one.
   */
  const byProject = computed(() => {
    const out: Record<string, Value> = {};
    for (const [projectId, settings] of Object.entries(document.byProject)) {
      const value = settings[section];
      if (value !== undefined) out[projectId] = value as Value;
    }
    return out;
  }) as unknown as Ref<Record<string, Value>>;

  function valueFor(projectId: string): Value {
    const settings = document.documentFor(projectId);
    // The defaults are the same values the server resolves an unset document to, so a
    // screen that has not loaded yet shows what an unconfigured project actually does
    // rather than a blank form.
    return (settings?.[section] as Value | undefined) ?? fallback();
  }

  async function save(projectId: string, next: Value): Promise<void> {
    await document.patch(projectId, { [section]: next } as PatchProjectSettings);
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  return {
    byProject,
    loading: toRef(document, "loading") as Ref<boolean>,
    refusal: toRef(document, "refusal") as Ref<string | null>,
    load: document.load,
    valueFor,
    save,
    lastSavedAt: (projectId: string) => lastSaved.value[projectId] ?? null,
  };
}
