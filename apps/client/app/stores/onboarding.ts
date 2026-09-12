/**
 * Whether the signed-in person still has to create their first project, and the call that
 * does it.
 *
 * `required` is read from the bootstrap rather than fetched again: `GET /v1/me` already
 * answers which organisations somebody belongs to, and belonging to none is exactly what
 * "has not started yet" means. Somebody invited into an organisation has projects without
 * ever having made one, which is why the test is membership and not project count.
 *
 * `create` is `POST /v1/onboarding`, which makes the organisation, its owner and its first
 * project in one transaction. Nothing is written until it is called, so leaving the form
 * halfway leaves an account exactly as it was.
 */
import type { OnboardingResult, RegionList } from "@idenzy/protocol/schemas/management";
import type { OnboardingSubmission } from "~/utils/onboarding";
import { managementMessage } from "~/utils/sign-in-errors";

export interface OnboardingRegion {
  /** `region_cells.code`, which is what the submission carries. */
  code: string;
  label: string;
  jurisdiction: string;
}

/**
 * What a region is called on screen.
 *
 * The server sends a code and the law that applies; the place name is ours to write,
 * because "eu-west-1" is an identifier and not something to put in front of somebody
 * choosing where their users' data lives. A cell we have not named falls back to its code
 * rather than to nothing, so a new region is usable the day it exists.
 */
const REGION_LABELS: Record<string, string> = {
  "eu-west-1": "Europe (Belgium)",
  "us-east-1": "United States (South Carolina)",
};

export const useOnboardingStore = defineStore("onboarding", () => {
  const bootstrap = useBootstrapStore();

  const regions = ref<OnboardingRegion[]>([]);
  const loading = ref(false);
  const submitting = ref(false);
  /** The refusal the server gave, in the reader's words. Null while nothing was refused. */
  const refusal = ref<string | null>(null);

  /**
   * Whether the dashboard is reachable yet.
   *
   * False while the bootstrap is still loading, and the guard is what makes that safe: it
   * waits for `ready` before reading this, so "no organisations yet" is never confused
   * with "we have not asked".
   */
  const required = computed(
    () => bootstrap.status === "ready" && bootstrap.organisations.length === 0,
  );

  /** The cells we actually run, which is what the form may offer. */
  async function loadRegions(): Promise<void> {
    if (regions.value.length > 0 || loading.value) return;
    loading.value = true;
    try {
      const api = useManagementApi();
      const { data, error } = await api("/v1/regions").get().json<RegionList>();
      if (error.value !== null) throw error.value;
      regions.value = (data.value?.regions ?? []).map((region) => ({
        code: region.code,
        label: REGION_LABELS[region.code] ?? region.code,
        jurisdiction: region.jurisdiction,
      }));
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Creates the organisation and its first project, and answers whether it worked.
   *
   * The bootstrap is reloaded on success rather than patched. What comes back from the
   * server is the organisation and the project it actually created, and re-reading is the
   * only way the drawer names the project rather than what the form happened to contain.
   */
  async function create(submission: OnboardingSubmission): Promise<boolean> {
    submitting.value = true;
    refusal.value = null;
    try {
      const api = useManagementApi();
      const { data, error } = await api("/v1/onboarding").post(submission).json<OnboardingResult>();
      if (error.value !== null) throw error.value;
      // A 2xx with no body is not success. Reloading on it would leave the panel
      // insisting an organisation exists on the word of a response that said nothing.
      if (data.value === null) {
        refusal.value = "The server accepted that but sent nothing back. Try again.";
        return false;
      }
      await bootstrap.reload();
      return true;
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
      return false;
    } finally {
      submitting.value = false;
    }
  }

  return { loading, submitting, refusal, regions, required, loadRegions, create };
});
