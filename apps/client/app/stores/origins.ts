/**
 * Each project's CORS allowlist (`project_origins`, ADR-0006), read and written through the
 * management API.
 *
 * The list is the whole of what this store knows, and the screen's harder half is the one it
 * cannot answer. The server sees the `Origin` on a request whether or not it is registered, so
 * a page calling from an origin nobody allowed is visible to us and invisible to the customer:
 * their browser reports a CORS error and the request looks fine in our logs. Nothing records
 * that yet, so `unknownFor` answers with nothing and says why rather than being left out — on
 * this screen a false "nothing was refused" is the most expensive answer there is.
 *
 * `forProject` stays synchronous over a cache because six screens read it inside a computed,
 * and a fetch inside one is a request per render. `load` fills it, and each of those screens
 * calls it when it opens and when the project changes.
 *
 * A change is live on the next request. Both project lookups return `allowed_origins` with the
 * project, so there is no cache between this write and the edge deciding on it.
 */

import { InternalError } from "@idenzy/core/errors";
import type { ProjectOrigin, ProjectOriginList } from "@idenzy/protocol/schemas/management";
import { canonicalBrowserOrigin } from "@idenzy/protocol/schemas/management";
import {
  type AllowedOrigin,
  allowedOriginFrom,
  ORIGIN_TELEMETRY,
  type OriginSource,
  sortOrigins,
} from "~/utils/origins";
import { managementMessage } from "~/utils/sign-in-errors";

/** An origin the API answered for and did not allow. Not an attack, usually a typo. */
export interface UnknownOrigin {
  origin: string;
  /** Requests carrying it over the last thirty days. */
  calls: number;
  lastSeen: string;
}

export const useOriginsStore = defineStore("origins", () => {
  const projects = useProjectStore();

  /** Origins by project id, as the server last answered. */
  const byProject = ref<Record<string, AllowedOrigin[]>>({});
  /**
   * The origins that called and were not allowed, which nothing fills.
   *
   * Kept as the shape the pipeline will write rather than deleted, because the reading below
   * it — drop one that has since been allowed, order by how often it called — is the part
   * worth having decided before there is data to get it wrong with.
   */
  const unknown = ref<Record<string, UnknownOrigin[]>>({});
  /**
   * Which suggestion each origin was accepted from, this session only.
   *
   * `project_origins` has no column for it, so this is the panel remembering what the operator
   * just did rather than a fact it could read back. Deliberately not persisted and deliberately
   * not re-derived from the other lists on load: a row that claimed a source after a reload
   * would be the derivation ADR-0006 exists to refuse, dressed as history.
   */
  const acceptedFrom = ref<Record<string, OriginSource>>({});
  const loading = ref(false);
  /** Why the list could not be read, for a screen that must not claim it knows. */
  const refusal = ref<string | null>(null);

  /** The route every call hangs off. Null when the project's organisation is unknown. */
  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/origins`;
  }

  /**
   * The same route for a write, or a throw.
   *
   * Thrown rather than returned quietly: every caller is a dialog or a row with a spinner on
   * it, and a silent no-op would report a permission change that did not happen.
   */
  function writePath(projectId: string): string {
    const path = basePath(projectId);
    if (path === null)
      throw new InternalError({ detail: { reason: "the project's organisation is not loaded" } });
    return path;
  }

  function present(row: ProjectOrigin): AllowedOrigin {
    const mapped = allowedOriginFrom(row);
    return { ...mapped, source: acceptedFrom.value[mapped.origin] ?? null };
  }

  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const api = useManagementApi();
      const { data, error } = await api(path).get().json<ProjectOriginList>();
      if (error.value !== null) throw error.value;
      byProject.value = {
        ...byProject.value,
        [projectId]: (data.value?.origins ?? []).map(present),
      };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function forProject(projectId: string): AllowedOrigin[] {
    return sortOrigins(byProject.value[projectId] ?? []);
  }

  /**
   * The origins the API answered for and did not allow.
   *
   * Empty while nothing records them, which is every deployment today, and empty in words on
   * the screen rather than as a list with no rows. Drawing anything here would be the panel
   * telling an operator it had watched for blocked calls when nothing is watching, and on this
   * list a false "nothing was refused" is the most expensive answer there is
   * (notes/domains-origins.md, acceptance checks).
   */
  function unknownFor(projectId: string): UnknownOrigin[] {
    if (!ORIGIN_TELEMETRY) return [];
    const allowed = forProject(projectId).map((entry) => entry.origin);
    /* One that has since been allowed drops off rather than lingering as a warning about
       something already done. The counts stay as they were: they are history. */
    return (unknown.value[projectId] ?? [])
      .filter((entry) => !allowed.includes(canonicalBrowserOrigin(entry.origin)))
      .sort((first, next) => next.calls - first.calls);
  }

  /**
   * Allows one.
   *
   * Already-held is a no-op rather than a second row or a refusal: the dialog and the
   * suggestion list both filter against this cache, so reaching here twice means the screen
   * already shows it.
   *
   * The origin is canonicalised before the call and the server canonicalises again. Both,
   * deliberately: the dialog shows the value it is about to store and that preview has to be
   * the value, and the API is not entitled to trust a client for it either.
   */
  async function add(
    projectId: string,
    origin: string,
    source: OriginSource | null = null,
  ): Promise<void> {
    const value = canonicalBrowserOrigin(origin);
    if (forProject(projectId).some((entry) => entry.origin === value)) return;

    const api = useManagementApi();
    const { data, error } = await api(writePath(projectId))
      .post({ origin: value })
      .json<ProjectOrigin>();
    if (error.value !== null) throw error.value;
    const created = data.value;
    if (created === null)
      throw new InternalError({ detail: { reason: "the server returned no origin" } });

    // Remembered before the row is presented, so the row it adds carries its source.
    if (source !== null) acceptedFrom.value = { ...acceptedFrom.value, [created.origin]: source };
    byProject.value = {
      ...byProject.value,
      [projectId]: [...(byProject.value[projectId] ?? []), present(created)],
    };
  }

  /**
   * Stops allowing one.
   *
   * Named by origin, because that is what the screen has: the row, the checker and the remove
   * dialog all talk about the string a browser sends. The id it is addressed by comes from the
   * cache, and an origin this store has never seen is a throw rather than a quiet success — the
   * dialog would otherwise close as though the page had lost its access.
   */
  async function remove(projectId: string, origin: string): Promise<void> {
    const value = canonicalBrowserOrigin(origin);
    const held = forProject(projectId).find((entry) => entry.origin === value);
    if (held === undefined)
      throw new InternalError({ detail: { reason: "that origin is not on the list" } });

    const api = useManagementApi();
    // Deliberately not `.json()`: success is 204 with no body, and asking for JSON reads an
    // empty body as a parse failure — reporting a removal that happened as one that did not.
    const { error } = await api(`${writePath(projectId)}/${held.id}`).delete();
    if (error.value !== null) throw error.value;
    byProject.value = {
      ...byProject.value,
      [projectId]: forProject(projectId).filter((entry) => entry.origin !== value),
    };
  }

  return { loading, refusal, load, forProject, unknownFor, add, remove };
});
