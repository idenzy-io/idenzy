/**
 * What the panel knows about the signed-in person, loaded once.
 *
 * One call on sign-in rather than one per screen. The drawer, the switcher and the
 * breadcrumb all want the same facts before anything can render, and three round trips to
 * draw a sidebar is three chances to show a half-built page — so `GET /v1/me` answers with
 * the organisations somebody belongs to and the projects under them, and every other store
 * reads from here.
 *
 * Identity is deliberately not here. `@idenzy/js` already holds it, and `useUser()` is
 * where a screen asks who is signed in; a second copy would be a second thing to keep true.
 * Balance is not here either, and that is a decision rather than an omission: nothing can
 * fund an account yet, so every figure would be a real zero where the billing screens still
 * show a fixture. It arrives when a top-up can actually happen.
 *
 * `status` has three values and not two. `loading` is the answer until the call comes back,
 * and treating it as "no organisations" is what would send a signed-in person with a
 * perfectly good project to getting started — the same mistake `useSession` avoids one
 * layer down, for the same reason.
 */
import type { Me, OrgSummary, ProjectSummary } from "@idenzy/protocol/schemas/management";

export type BootstrapStatus = "idle" | "loading" | "ready" | "failed";

export const useBootstrapStore = defineStore("bootstrap", () => {
  const status = ref<BootstrapStatus>("idle");
  const organisations = ref<OrgSummary[]>([]);
  const projects = ref<ProjectSummary[]>([]);
  /** What went wrong, for a screen that has to say something rather than sit blank. */
  const refusal = ref<string | null>(null);

  let inFlight: Promise<void> | null = null;

  /**
   * Loads once, and answers the same promise to everybody who asks while it is in flight.
   *
   * A route change can run the guard before the first load has finished, and two calls
   * would be two `GET /v1/me` requests racing to write the same refs. Sharing the promise
   * is what makes "wait for the bootstrap" mean one request however many callers there are.
   */
  function load(): Promise<void> {
    if (status.value === "ready") return Promise.resolve();
    if (inFlight !== null) return inFlight;

    status.value = "loading";
    refusal.value = null;
    const api = useManagementApi();

    inFlight = (async () => {
      try {
        const { data, error } = await api("/v1/me").get().json<Me>();
        if (error.value !== null) throw error.value;
        const me = data.value;
        organisations.value = me?.organisations ?? [];
        projects.value = me?.projects ?? [];
        status.value = "ready";
      } catch (cause: unknown) {
        // Left as `failed` rather than as an empty `ready`. An account whose bootstrap
        // failed is not an account with no organisations, and sending it to getting
        // started would offer to create a second one.
        status.value = "failed";
        refusal.value = managementMessage(cause);
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  /** After onboarding, so the drawer shows the project that was just created. */
  async function reload(): Promise<void> {
    status.value = "idle";
    inFlight = null;
    await load();
  }

  /** Everything a sign-out has to forget, so the next person starts clean. */
  function clear(): void {
    status.value = "idle";
    organisations.value = [];
    projects.value = [];
    refusal.value = null;
    inFlight = null;
  }

  return { status, organisations, projects, refusal, load, reload, clear };
});
