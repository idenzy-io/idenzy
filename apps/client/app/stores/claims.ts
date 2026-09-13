/**
 * Each project's claim template, as the panel sees it.
 *
 * One row of `claim_templates` per project, read and written whole through the
 * management API's `PUT /v1/claim-template` with a secret key; this store is that row
 * with a placeholder until the client exists. Unlike the settings screens there is no
 * patch here, because there is nothing to patch: the byte budget is on the total, and a
 * save whose effect depends on what somebody else stored first is not a save anybody can
 * reason about. The screen holds a draft and hands the whole thing over.
 */

import { InternalError } from "@idenzy/core/errors";
import {
  type ClaimTemplate,
  EMPTY_TEMPLATE,
  normaliseTemplate,
  readsPrivateMetadata,
  type SavedClaimTemplate,
} from "~/utils/claims";
import { managementMessage } from "~/utils/sign-in-errors";

const _PLACEHOLDER_LATENCY = 700;
const _SAVE_LATENCY = 900;

export const useClaimsStore = defineStore("claims", () => {
  const projects = useProjectStore();

  const templates = ref<Record<string, SavedClaimTemplate>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);
  /** Non-reactive: mutating a ref inside a computed re-invalidates the computed. */
  const requested = new Set<string>();

  function path(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/claim-template`;
  }

  async function load(projectId: string): Promise<void> {
    const url = path(projectId);
    if (url === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const { data, error } = await useManagementApi()(url).get().json<SavedClaimTemplate>();
      if (error.value !== null) throw error.value;
      if (data.value !== null) templates.value = { ...templates.value, [projectId]: data.value };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function templateFor(projectId: string): SavedClaimTemplate {
    if (!requested.has(projectId)) {
      requested.add(projectId);
      void load(projectId);
    }
    // A project that has never saved one has an empty template, which is what the server
    // answers with too — so the screen opens on the same thing either way.
    return templates.value[projectId] ?? { ...EMPTY_TEMPLATE };
  }

  /**
   * Replaces the whole template and keeps what the server stored.
   *
   * A PUT, because a template is an ordered list and the screen edits the whole of it. The
   * server drops the acknowledgement when no claim reads private metadata any more, so the
   * answer is kept rather than the copy sent: a screen still showing a tick for a source it
   * no longer reads would be describing a consent that is not recorded.
   */
  async function save(projectId: string, template: ClaimTemplate): Promise<SavedClaimTemplate> {
    const url = path(projectId);
    if (url === null) {
      throw new InternalError({ detail: { reason: "the project's organisation is not loaded" } });
    }
    const clean = normaliseTemplate(template);
    const { data, error } = await useManagementApi()(url)
      .put({
        claims: clean.claims,
        acknowledgePrivateMetadata: readsPrivateMetadata(clean.claims)
          ? clean.acknowledgePrivateMetadata
          : false,
      })
      .json<SavedClaimTemplate>();
    if (error.value !== null) {
      refusal.value = managementMessage(error.value);
      throw error.value;
    }
    const saved = data.value;
    if (saved === null) {
      throw new InternalError({ detail: { reason: "the server returned no template" } });
    }
    templates.value = { ...templates.value, [projectId]: saved };
    return saved;
  }

  return { templates, loading, refusal, load, templateFor, save };
});
