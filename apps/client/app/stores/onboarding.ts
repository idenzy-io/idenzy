/**
 * Whether the signed-in person still has to create their first project, and the call that
 * does it.
 *
 * `required` is the whole reason this store exists separately from `useProjectStore`: the
 * guard has to answer it before any project is loaded, on a page where there is no project
 * to load. It mirrors `GET /v1/onboarding`, which answers the same question from the
 * membership list rather than from the project list — somebody invited into an
 * organisation has projects without ever having made one.
 *
 * `create` is `POST /v1/onboarding`, which makes the organisation, its owner and its first
 * project in one transaction. Nothing is written until it is called, so a person who
 * leaves halfway through the form leaves no rows behind and can start again.
 *
 * A placeholder until the management client exists, like every store here, and it takes
 * its answer from the project store's fixture rather than inventing a second one: those
 * organisations are the ones the rest of the panel is rendered against, so a person who
 * has one there must not be sent to getting started. When the client lands, both stores
 * fetch and this derivation goes with the fixture.
 */

import type { OnboardingSubmission } from "~/utils/onboarding";
import { REGION_CELLS } from "~/utils/project-settings";

const PLACEHOLDER_LATENCY = 700;

export interface OnboardingRegion {
  /** `region_cells.code`, which is what the submission carries. */
  code: string;
  label: string;
  jurisdiction: string;
}

export const useOnboardingStore = defineStore("onboarding", () => {
  const projects = useProjectStore();

  const loading = ref(false);
  const submitting = ref(false);
  /** The refusal the server gave, in its own words. Null while nothing has been refused. */
  const refusal = ref<string | null>(null);

  /**
   * Only the cells we actually run, which is `GET /v1/regions` once it answers.
   *
   * Offered from the server rather than from a constant in this bundle, because a cell
   * being drained before a migration stops taking new projects and a form that kept
   * offering it would pin somebody's data to a stack we are emptying. The constant below
   * is the fixture standing in for that call.
   */
  const regions = computed<OnboardingRegion[]>(() =>
    REGION_CELLS.map((cell) => ({
      code: cell.code,
      label: cell.label,
      jurisdiction: cell.jurisdiction,
    })),
  );

  /**
   * Whether the dashboard is reachable yet.
   *
   * Membership and not project count, matching the server: an organisation somebody was
   * invited into already has projects, and asking them to make one would be asking them
   * to solve a problem they do not have.
   */
  const required = computed(() => projects.orgs.length === 0);

  /**
   * Creates the organisation and its first project, and returns whether it worked.
   *
   * Nothing is added to the project store on success in the placeholder. A local list that
   * grew would be this panel claiming a row exists in a database nothing has written to,
   * which is the same mistake `PAYMENTS.running` exists to prevent one screen over: a
   * changed local state must never read as proof of a write.
   */
  async function create(submission: OnboardingSubmission): Promise<boolean> {
    submitting.value = true;
    refusal.value = null;
    try {
      await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_LATENCY));
      void submission;
      refusal.value =
        "The management API is not connected yet, so nothing was created. This form is complete and unwired, like the rest of the panel.";
      return false;
    } finally {
      submitting.value = false;
    }
  }

  return { loading, submitting, refusal, regions, required, create };
});
