/**
 * The parts of a project's own row this screen reads, and the one set of them it writes.
 *
 * The name is deliberately not here: it lives in the project store, because the drawer, the
 * breadcrumb and the switcher all read it and a second copy would be a second thing to keep
 * in step. What this holds is everything else on the row, which is mostly facts a customer
 * cannot change, plus the retention ages, which are the only settings on the page.
 *
 * The facts come from the bootstrap rather than from a read of their own, and that is the
 * decision rather than a shortcut. `GET /v1/me` already answers with each project's tier,
 * plan, compliance tier and creation date — the same four columns
 * `GET /v1/orgs/:orgId/projects/:projectId` reads — so a request here would fetch bytes the
 * panel is already holding, which is the bug `useSettingsDocumentStore` was written to fix one
 * screen over. The endpoint exists and is what a rename answers with; this screen simply has
 * no reason to ask it a second time.
 *
 * What has gone is the generator. `tier`, `plan` and `createdAt` used to be seeded
 * off a hash of the project id, so a project running in `us-east-1` could describe itself as
 * Europe and a free one as enterprise — a residency claim invented by a PRNG.
 *
 * **Retention is a server answer now, and a job runs on it.** It reads
 * `GET .../retention` and writes one subject at a time with `PUT`. Every subject comes back
 * whether or not the project has stored an age, because "kept 90 days because nobody has
 * chosen" and "not swept at all" are different facts and a list of stored rows could not tell
 * them apart — `source` is how the answer says which, and `isDefault` is how this store passes
 * that on. The audit subject comes back as the tier's and is refused as a write.
 */

import type { RetentionPolicy, RetentionPolicyList } from "@idenzy/protocol/schemas/management";
import {
  auditRetentionFor,
  type ProjectFacts,
  type ProjectTier,
  projectTierOf,
  RETENTION_DEFAULTS,
  RETENTION_SUBJECTS,
  type RetentionSubject,
} from "~/utils/project-settings";
import { managementMessage } from "~/utils/sign-in-errors";

export const useProjectSettingsStore = defineStore("project-settings", () => {
  const bootstrap = useBootstrapStore();
  const projects = useProjectStore();

  const policies = ref<Record<string, Record<string, RetentionPolicy>>>({});
  const lastSaved = ref<Record<string, string>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);

  /** Non-reactive on purpose: writing a ref inside a computed re-invalidates the computed. */
  const requested = new Set<string>();

  function path(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/retention`;
  }

  /**
   * What the project is, as its row says.
   *
   * The name is passed in rather than read here, because the project store owns it and a
   * rename has to reach the breadcrumb and this page as one change.
   *
   * The fallbacks are for the tick before the bootstrap answers and for nothing else — the
   * route guard holds every screen in the panel behind a loaded one — so they are empty rather
   * than plausible. A blank value reads as "Not recorded" on the screen, which is true for
   * that tick; an invented one would not be.
   */
  function factsFor(projectId: string, name: string): ProjectFacts {
    const summary = bootstrap.projects.find((project) => project.id === projectId);
    return {
      id: projectId,
      name,
      tier: projectTierOf(summary?.complianceTier),
      plan: summary?.plan ?? "",
      createdAt: summary?.createdAt ?? new Date(0).toISOString(),
    };
  }

  async function load(projectId: string): Promise<void> {
    const url = path(projectId);
    if (url === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const { data, error } = await useManagementApi()(url).get().json<RetentionPolicyList>();
      if (error.value !== null) throw error.value;
      absorb(projectId, data.value?.policies ?? []);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function absorb(projectId: string, answered: readonly RetentionPolicy[]): void {
    const held = { ...(policies.value[projectId] ?? {}) };
    for (const policy of answered) held[policy.subject] = policy;
    policies.value = { ...policies.value, [projectId]: held };
  }

  /** Loads once per project, for the screens that read an age without owning the page. */
  function ensure(projectId: string): void {
    if (requested.has(projectId)) return;
    requested.add(projectId);
    void load(projectId);
  }

  /**
   * Every subject, always, with the audit one taken from the tier.
   *
   * The defaults fill the gap before the first read answers, and they are the same numbers the
   * server resolves an unset project to — so the table shows what the sweeper is actually doing
   * rather than a blank row, and does not change under the reader when the answer lands.
   */
  function retentionFor(projectId: string, tier: ProjectTier): Record<RetentionSubject, string> {
    ensure(projectId);
    const held = policies.value[projectId] ?? {};
    const out = {} as Record<RetentionSubject, string>;
    for (const subject of RETENTION_SUBJECTS) {
      out[subject] =
        subject === "audit_events"
          ? (held[subject]?.maxAge ?? auditRetentionFor(tier))
          : (held[subject]?.maxAge ?? RETENTION_DEFAULTS[subject]);
    }
    return out;
  }

  /**
   * Whether an age is this project's or the one it is swept at until somebody picks.
   *
   * Worth showing, because the two are indistinguishable on the row otherwise and they are
   * not the same fact: one is a decision somebody made and the other is what happens by
   * default. Both are enforced — that is the point of the server resolving the default rather
   * than waiting for a row.
   */
  function isDefault(projectId: string, subject: RetentionSubject): boolean {
    ensure(projectId);
    return policies.value[projectId]?.[subject]?.source !== "project";
  }

  /**
   * Stores one age, and answers whether it went.
   *
   * The screen saves a draft of up to four, one `PUT` each, and the answer is what lets it
   * stop at the first refusal rather than carry on and report a save that half happened.
   */
  async function setRetention(
    projectId: string,
    subject: RetentionSubject,
    maxAge: string,
  ): Promise<boolean> {
    const url = path(projectId);
    if (url === null) return false;
    refusal.value = null;
    try {
      const { data, error } = await useManagementApi()(url)
        .put({ subject, maxAge })
        .json<RetentionPolicy>();
      if (error.value !== null) throw error.value;
      const saved = data.value;
      if (saved !== null) absorb(projectId, [saved]);
      stamp(projectId);
      return true;
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
      return false;
    }
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return {
    loading,
    refusal,
    load,
    ensure,
    factsFor,
    retentionFor,
    isDefault,
    setRetention,
    stamp,
    lastSavedAt,
  };
});
