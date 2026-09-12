/**
 * Each project's API keys, and what can be done to them: make one, start a rotation on one,
 * and revoke one.
 *
 * The store never holds a plaintext key, and now that the calls are real that is the
 * server's shape rather than a convention kept here: `create` and `rotate` return the one
 * copy that will ever exist and forget it in the same breath, because only a digest is
 * stored and nothing can produce it again. Keeping it so the screen could show it twice
 * would rebuild, in a Pinia store, the retrievable-key design the schema went out of its
 * way to avoid.
 *
 * `keysFor` stays synchronous over a cache, because the screen reads it in a computed and a
 * fetch inside one is a request per render. `load` is what fills the cache, and the page
 * calls it when it opens and when the project changes.
 *
 * Two fields the API does not have yet, and the screen says so rather than inventing them.
 * `createdBy` needs the audit trail's `key.created` entry, which nothing reads here yet;
 * `replaces` needs a column `api_keys` does not have, so a rotation is remembered for this
 * session and is not a fact the server would agree with.
 */

import { InternalError } from "@idenzy/core/errors";
import type { ApiKeyList, ApiKeySummary, CreatedApiKey } from "@idenzy/protocol/schemas/management";
import { type ApiKeyKind, isLive, type ProjectApiKey } from "~/utils/keys";
import { managementMessage } from "~/utils/sign-in-errors";

export const useKeysStore = defineStore("keys", () => {
  const projects = useProjectStore();

  /** Keys by project id, as the server last answered. */
  const byProject = ref<Record<string, ProjectApiKey[]>>({});
  /**
   * Which key each rotation was started from, this session only.
   *
   * `api_keys` has no column for it, so this is the panel remembering what the operator
   * just did rather than a fact it could read back. It is deliberately not persisted: a
   * rotation that survived a reload would be a claim the server cannot support.
   */
  const replacing = ref<Record<string, string>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);

  /** The route every call hangs off. Null when the project's organisation is unknown. */
  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/api-keys`;
  }

  function present(key: ApiKeySummary): ProjectApiKey {
    return {
      id: key.id,
      kind: key.kind as ApiKeyKind,
      prefix: key.prefix,
      scopes: key.scopes,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      // Both are absent from the API. Null rather than a plausible-looking value, so the
      // screen's "proposed field" wording stays true.
      createdBy: null,
      replaces: replacing.value[key.id] ?? null,
    };
  }

  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const api = useManagementApi();
      const { data, error } = await api(path).get().json<ApiKeyList>();
      if (error.value !== null) throw error.value;
      byProject.value = { ...byProject.value, [projectId]: (data.value?.keys ?? []).map(present) };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /** Every key on the project, newest first. Empty until `load` has answered. */
  function keysFor(projectId: string): ProjectApiKey[] {
    return [...(byProject.value[projectId] ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async function issue(
    projectId: string,
    kind: ApiKeyKind,
    replaces: string | null,
  ): Promise<{ key: ProjectApiKey; secret: string }> {
    const path = basePath(projectId);
    if (path === null)
      throw new InternalError({ detail: { reason: "the project's organisation is not loaded" } });
    const api = useManagementApi();
    const { data, error } = await api(path).post({ kind }).json<CreatedApiKey>();
    if (error.value !== null) throw error.value;
    const created = data.value;
    // A 2xx carrying nothing is not a created key, and the caller must not get one.
    if (created === null)
      throw new InternalError({ detail: { reason: "the server returned no key" } });

    if (replaces !== null) replacing.value = { ...replacing.value, [created.key.id]: replaces };
    const key = present(created.key);
    byProject.value = {
      ...byProject.value,
      [projectId]: [key, ...(byProject.value[projectId] ?? [])],
    };
    // The secret travels back to the caller and is never written into the store.
    return { key, secret: created.secret };
  }

  function create(projectId: string, kind: ApiKeyKind) {
    return issue(projectId, kind, null);
  }

  /**
   * Starts a rotation: a key of the same kind that names the one it replaces. The old key is
   * untouched and keeps working, which is the whole point; it goes when somebody revokes it.
   */
  function rotate(projectId: string, old: ProjectApiKey) {
    return issue(projectId, old.kind, old.id);
  }

  /**
   * Takes a key out of service. Immediate and total: the resolution function filters on
   * `revoked_at` with no cache in front of it, so the next request carrying this key is
   * refused rather than the one after some expiry.
   */
  async function revoke(projectId: string, keyId: string): Promise<void> {
    const path = basePath(projectId);
    // Thrown rather than returned quietly. A silent no-op here would close the dialog as
    // though the key had been revoked, which is the one wrong answer on this screen.
    if (path === null)
      throw new InternalError({ detail: { reason: "the project's organisation is not loaded" } });
    const api = useManagementApi();
    // An empty object rather than no body: a POST with a JSON content-type and nothing in
    // it is refused before the handler is reached.
    const { error } = await api(`${path}/${keyId}/revoke`).post({}).json<ApiKeySummary>();
    if (error.value !== null) throw error.value;
    // Re-read rather than patch. The row now carries a `revoked_at` the server chose, and
    // a timestamp invented here would be the one the screen showed and the trail disputed.
    await load(projectId);
  }

  /** Live keys of each kind, for the create dialog's "this does not replace" line. */
  function liveOf(projectId: string): Record<ApiKeyKind, ProjectApiKey[]> {
    const live = keysFor(projectId).filter(isLive);
    return {
      publishable: live.filter((key) => key.kind === "publishable"),
      secret: live.filter((key) => key.kind === "secret"),
    };
  }

  return { loading, refusal, load, keysFor, create, rotate, revoke, liveOf };
});
