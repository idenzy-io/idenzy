/**
 * Each project's custom auth domains, as the panel sees them.
 *
 * Rows of `project_domains` with `type = 'auth'`, read and written through the management
 * API. Its own store rather than a view over the sending-domains one, for the same reason
 * the models are separate: the records, the verification and the failure are all different,
 * and the only thing the two halves of the table share is that a hostname belongs to one
 * project.
 *
 * Nothing here decides whether a domain is verified, and that is the load-bearing part.
 * Adding claims the hostname and hands back two records minted by the server; a domain
 * becomes verified when a DNS check resolves both, which is the server's to say. A panel
 * that flipped the status itself would report a domain as live while
 * `resolve_project_by_host` still refused every request to it.
 *
 * `forProject` stays synchronous over a cache because three screens read it inside a
 * computed, and a fetch inside one is a request per render. `load` is what fills the cache,
 * and each of those screens calls it when it opens and when the project changes.
 *
 * Nothing checks DNS on a schedule. A check happens because somebody asked for one, so a
 * row's `checkedAt` is the last time this screen was used and never the last time anything
 * looked.
 */

import { InternalError } from "@idenzy/core/errors";
import type { ProjectDomain, ProjectDomainList } from "@idenzy/protocol/schemas/management";
import { type AuthDomain, authDomainFrom, type SetupProbe, setupProbe } from "~/utils/auth-domains";
import { managementMessage } from "~/utils/sign-in-errors";

export const useAuthDomainsStore = defineStore("auth-domains", () => {
  const projects = useProjectStore();

  /** Domains by project id, as the server last answered. */
  const byProject = ref<Record<string, AuthDomain[]>>({});
  /** The last setup check per project. Never a claim about a deployed client. */
  const probes = ref<Record<string, SetupProbe>>({});
  const loading = ref(false);
  /** Why the list could not be read, for a screen that must not claim it knows. */
  const refusal = ref<string | null>(null);

  /** The route every call hangs off. Null when the project's organisation is unknown. */
  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/domains`;
  }

  /**
   * The same route for a write, or a throw.
   *
   * Thrown rather than returned quietly, because every caller here is a dialog: a silent
   * no-op would close it as though the domain had been added or removed, which on this
   * screen is the one wrong answer.
   */
  function writePath(projectId: string): string {
    const path = basePath(projectId);
    if (path === null)
      throw new InternalError({ detail: { reason: "the project's organisation is not loaded" } });
    return path;
  }

  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const api = useManagementApi();
      const { data, error } = await api(path).get().json<ProjectDomainList>();
      if (error.value !== null) throw error.value;
      byProject.value = {
        ...byProject.value,
        [projectId]: (data.value?.domains ?? []).map(authDomainFrom),
      };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /** Every auth domain on the project. Empty until `load` has answered. */
  function forProject(projectId: string): AuthDomain[] {
    return byProject.value[projectId] ?? [];
  }

  /**
   * Claims a hostname, pending.
   *
   * The row it answers with is returned rather than looked up again: the records on it are
   * the whole of what is left to do, and the caller opens the setup on exactly this domain
   * rather than on whichever row happens to carry the name it asked for.
   */
  async function add(projectId: string, domain: string): Promise<AuthDomain> {
    const api = useManagementApi();
    const { data, error } = await api(writePath(projectId)).post({ domain }).json<ProjectDomain>();
    if (error.value !== null) throw error.value;
    const created = data.value;
    // A 2xx carrying nothing is not a claimed domain, and the caller must not get one.
    if (created === null)
      throw new InternalError({ detail: { reason: "the server returned no domain" } });
    const row = authDomainFrom(created);
    byProject.value = { ...byProject.value, [projectId]: [...forProject(projectId), row] };
    return row;
  }

  /**
   * Resolves the records now and writes down what was found.
   *
   * Offered because the alternative is a customer publishing a record and waiting on a
   * schedule they cannot see — and here there is no schedule to wait on, so this is the only
   * thing that ever looks. It changes nothing about what is true, only when we look, and the
   * answer replaces the row wholesale: the status, the per-record findings and the timestamp
   * are all the server's, and a verified row can come back failed if DNS has changed.
   */
  async function recheck(projectId: string, id: string): Promise<AuthDomain> {
    const api = useManagementApi();
    // An empty object rather than no body: a POST with a JSON content-type and nothing in
    // it is refused before the handler is reached.
    const { data, error } = await api(`${writePath(projectId)}/${id}/verify`)
      .post({})
      .json<ProjectDomain>();
    if (error.value !== null) throw error.value;
    const checked = data.value;
    if (checked === null)
      throw new InternalError({ detail: { reason: "the server returned no domain" } });
    const row = authDomainFrom(checked);
    replace(projectId, row);
    return row;
  }

  /**
   * Removes a domain, which takes the host off the air.
   *
   * A delete rather than a disable: the row is what `resolve_project_by_host` reads, and a
   * disabled row that still held the hostname would keep it claimed against every other
   * project while serving nobody.
   */
  async function remove(projectId: string, id: string): Promise<void> {
    const removed = forProject(projectId).find((row) => row.id === id) ?? null;
    const api = useManagementApi();
    // Deliberately not `.json()`. Success is 204 with no body, and asking for JSON reads an
    // empty body as a parse failure — reporting a removal that happened as one that did not.
    const { error } = await api(`${writePath(projectId)}/${id}`).delete();
    if (error.value !== null) throw error.value;
    byProject.value = {
      ...byProject.value,
      [projectId]: forProject(projectId).filter((row) => row.id !== id),
    };
    // A probe is about a host, so it goes when that host does rather than outliving it.
    if (removed !== null && probes.value[projectId]?.host === removed.domain) {
      const next = { ...probes.value };
      delete next[projectId];
      probes.value = next;
    }
  }

  /**
   * Runs a check and reads the result, which is what `Verify setup` offers.
   *
   * The DNS check is real and runs first, so the three lines that are ours to observe are an
   * observation from a moment ago rather than a replay of the last one. The fourth is the
   * application origin the operator named, which we can say is on the CORS allowlist and
   * never that their build is calling this host: verification and client migration are
   * different acts and only one of them is ours (notes/domains.md).
   */
  async function checkSetup(
    projectId: string,
    id: string,
    origin: string,
    originAllowed: boolean,
  ): Promise<SetupProbe> {
    const row = await recheck(projectId, id);
    const probe = setupProbe(row, origin, originAllowed);
    probes.value = { ...probes.value, [projectId]: probe };
    return probe;
  }

  function probeFor(projectId: string): SetupProbe | null {
    return probes.value[projectId] ?? null;
  }

  function replace(projectId: string, row: AuthDomain) {
    byProject.value = {
      ...byProject.value,
      [projectId]: forProject(projectId).map((held) => (held.id === row.id ? row : held)),
    };
  }

  return {
    loading,
    refusal,
    load,
    forProject,
    add,
    recheck,
    remove,
    checkSetup,
    probeFor,
  };
});
