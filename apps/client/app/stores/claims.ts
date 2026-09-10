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

import {
  type ClaimTemplate,
  EMPTY_TEMPLATE,
  normaliseTemplate,
  readsPrivateMetadata,
  type SavedClaimTemplate,
} from "~/utils/claims";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 900;

export const useClaimsStore = defineStore("claims", () => {
  const templates = ref<Record<string, SavedClaimTemplate>>({});
  const loading = ref(true);

  setTimeout(() => {
    templates.value = {
      prj_personal: { ...EMPTY_TEMPLATE },
      prj_acme: {
        claims: [
          { name: "email", source: "user", path: "email", required: true },
          { name: "email_verified", source: "user", path: "emailVerified", required: false },
          { name: "plan", source: "metadata_public", path: "plan", required: false },
          { name: "org", source: "metadata_private", path: "orgId", required: true },
        ],
        acknowledgePrivateMetadata: true,
        updatedAt: "2026-09-02T10:14:00.000Z",
      },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function templateFor(projectId: string): SavedClaimTemplate {
    return templates.value[projectId] ?? { ...EMPTY_TEMPLATE };
  }

  /**
   * Replaces the whole template; resolves once the server has it. The acknowledgement is
   * kept only while the template still reads private metadata, as the server keeps it.
   */
  async function save(projectId: string, template: ClaimTemplate): Promise<SavedClaimTemplate> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const clean = normaliseTemplate(template);
    const saved: SavedClaimTemplate = {
      claims: clean.claims,
      acknowledgePrivateMetadata: readsPrivateMetadata(clean.claims)
        ? clean.acknowledgePrivateMetadata
        : false,
      updatedAt: new Date().toISOString(),
    };
    templates.value = { ...templates.value, [projectId]: saved };
    return saved;
  }

  return { templates, loading, templateFor, save };
});
