/**
 * The project's settings document, held once and shared by every section that reads it.
 *
 * This exists because the obvious shape was wrong. `useSettingsSection` was a composable
 * with its own cache and its own in-flight guard, so each of the seven sections — password,
 * otp, passkeys, mfa, recovery, lifetimes, linking — kept a separate copy and fetched the
 * whole document to fill it. Opening a page that touched three of them made three identical
 * requests for the same bytes, which is the sort of thing nobody notices until they read a
 * network panel.
 *
 * One document per project fixes more than the request count. A patch answers with the
 * whole of it, so saving the password policy now updates the lifetimes a screen elsewhere
 * is showing, rather than leaving that section holding what it last read.
 *
 * The in-flight promise is shared rather than merely guarded by a flag. Three sections
 * asking in the same tick is the normal case, not a race worth ignoring, and a flag lets
 * the second and third return before the first has answered — which is how a screen comes
 * to render defaults for a project that has settings.
 */

import type { PatchProjectSettings, ProjectSettings } from "@idenzy/protocol/schemas/management";
import { managementMessage } from "~/utils/sign-in-errors";

export const useSettingsDocumentStore = defineStore("settings-document", () => {
  const projects = useProjectStore();

  const byProject = ref<Record<string, ProjectSettings>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);

  /**
   * One promise per project while a read is in flight.
   *
   * Not a ref: nothing renders from it, and a reactive map here would make every caller
   * that reads it re-evaluate when a request starts and again when it settles.
   */
  const inFlight = new Map<string, Promise<void>>();
  /** Projects a first load has been started for, so a reader can be a pure read after it. */
  const requested = new Set<string>();

  function path(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/settings`;
  }

  function absorb(projectId: string, settings: ProjectSettings | null): void {
    if (settings === null) return;
    byProject.value = { ...byProject.value, [projectId]: settings };
  }

  /** Reads the document. Callers in the same tick share one request. */
  function load(projectId: string): Promise<void> {
    const existing = inFlight.get(projectId);
    if (existing !== undefined) return existing;

    const url = path(projectId);
    if (url === null) return Promise.resolve();

    loading.value = true;
    refusal.value = null;
    const request = (async () => {
      try {
        const { data, error } = await useManagementApi()(url).get().json<ProjectSettings>();
        if (error.value !== null) throw error.value;
        absorb(projectId, data.value);
      } catch (cause: unknown) {
        refusal.value = managementMessage(cause);
      } finally {
        loading.value = false;
        inFlight.delete(projectId);
      }
    })();

    inFlight.set(projectId, request);
    return request;
  }

  /** Starts the first load once. Safe to call from inside a computed. */
  function ensure(projectId: string): void {
    if (requested.has(projectId)) return;
    requested.add(projectId);
    void load(projectId);
  }

  /** The whole document, or null while it is still being read for the first time. */
  function documentFor(projectId: string): ProjectSettings | null {
    ensure(projectId);
    return byProject.value[projectId] ?? null;
  }

  /**
   * Applies a patch and keeps the whole document the server answered with.
   *
   * Kept rather than merged locally: a value the server clamped, a default it filled in, or
   * a change another operator made a moment ago must not be overwritten on screen by the
   * optimistic copy this call happened to send.
   */
  async function patch(projectId: string, change: PatchProjectSettings): Promise<void> {
    const url = path(projectId);
    if (url === null) return;
    try {
      const { data, error } = await useManagementApi()(url).patch(change).json<ProjectSettings>();
      if (error.value !== null) throw error.value;
      absorb(projectId, data.value);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
      throw cause;
    }
  }

  return { byProject, loading, refusal, load, ensure, documentFor, patch };
});
