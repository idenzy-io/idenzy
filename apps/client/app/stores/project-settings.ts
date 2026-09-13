/**
 * The parts of a project's own row this screen reads, and the one set of them it writes.
 *
 * The name is deliberately not here: it lives in the project store, because the drawer, the
 * breadcrumb and the switcher all read it and a second copy would be a second thing to keep
 * in step. What this holds is everything else on the row, which is mostly facts a customer
 * cannot change, plus the retention ages.
 *
 * The facts come from the bootstrap rather than from a read of their own, and that is the
 * decision rather than a shortcut. `GET /v1/me` already answers with each project's region,
 * plan, compliance tier and creation date — the same four columns
 * `GET /v1/orgs/:orgId/projects/:projectId` reads — so a request here would fetch bytes the
 * panel is already holding, which is the bug `useSettingsDocumentStore` was written to fix
 * one screen over. The endpoint exists and is what a rename answers with; this screen simply
 * has no reason to ask it a second time.
 *
 * What has gone is the generator. `cellCode`, `tier`, `plan` and `createdAt` used to be
 * seeded off a hash of the project id, so a project running in `us-east-1` could describe
 * itself as Europe and a free one as enterprise — a residency claim invented by a PRNG,
 * which is the first row of notes/priorities.md rather than a rough edge.
 *
 * **Retention is still local and says so.** `retention_policies` has no repository, no
 * endpoint and no worker reading it, so an age saved here is a number this page remembers
 * until it is reloaded. PROJECT.md 4.13.6 is why that has to be stated rather than glossed:
 * retention that is not enforced by a job is not retention, and this is the one screen where
 * pretending otherwise would be a compliance claim.
 */

import {
  auditRetentionFor,
  type ProjectFacts,
  type ProjectTier,
  projectTierOf,
  RETENTION_DEFAULTS,
  RETENTION_SUBJECTS,
  type RetentionSubject,
} from "~/utils/project-settings";

const SAVE_LATENCY = 600;

export const useProjectSettingsStore = defineStore("project-settings", () => {
  const bootstrap = useBootstrapStore();

  const overrides = ref<Record<string, Partial<Record<RetentionSubject, string>>>>({});
  const lastSaved = ref<Record<string, string>>({});

  const loading = computed(() => bootstrap.status === "loading" || bootstrap.status === "idle");

  /**
   * What the project is, as its row says.
   *
   * The name is passed in rather than read here, because the project store owns it and a
   * rename has to reach the breadcrumb and this page as one change.
   *
   * The fallbacks are for the tick before the bootstrap answers and for nothing else — the
   * route guard holds every screen in the panel behind a loaded one — so they are empty
   * rather than plausible. A blank region reads as "Not recorded" on the screen, which is
   * true for that tick; an invented one would not be.
   */
  function factsFor(projectId: string, name: string): ProjectFacts {
    const summary = bootstrap.projects.find((project) => project.id === projectId);
    return {
      id: projectId,
      name,
      cellCode: summary?.region ?? "",
      tier: projectTierOf(summary?.complianceTier),
      plan: summary?.plan ?? "",
      createdAt: summary?.createdAt ?? new Date(0).toISOString(),
    };
  }

  /**
   * Every subject, always, with the audit one taken from the tier rather than from what a
   * project chose. It is the tier's promise, so a stored override of it would be a number
   * the purge worker ignores.
   */
  function retentionFor(projectId: string, tier: ProjectTier): Record<RetentionSubject, string> {
    const held = overrides.value[projectId] ?? {};
    const out = {} as Record<RetentionSubject, string>;
    for (const subject of RETENTION_SUBJECTS) {
      out[subject] =
        subject === "audit_events"
          ? auditRetentionFor(tier)
          : (held[subject] ?? RETENTION_DEFAULTS[subject]);
    }
    return out;
  }

  /** Local, and only local. There is no endpoint and no worker behind this yet. */
  async function setRetention(
    projectId: string,
    subject: RetentionSubject,
    maxAge: string,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const held = overrides.value[projectId] ?? {};
    overrides.value = { ...overrides.value, [projectId]: { ...held, [subject]: maxAge } };
    stamp(projectId);
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return { loading, factsFor, retentionFor, setRetention, stamp, lastSavedAt };
});
