/**
 * The parts of a project's own row this screen reads, and the one set of them it writes.
 *
 * The name is deliberately not here: it lives in the project store, because the drawer, the
 * breadcrumb and the switcher all read it and a second copy would be a second thing to keep
 * in step. What this holds is everything else on the row, which is mostly facts a customer
 * cannot change, plus the retention ages, which are the only settings on the page.
 *
 * Placeholder until the management API answers, seeded off the project id so a cell and a
 * creation date hold still between visits and two projects differ.
 */

import {
  auditRetentionFor,
  type ProjectFacts,
  type ProjectTier,
  REGION_CELLS,
  RETENTION_DEFAULTS,
  RETENTION_SUBJECTS,
  type RetentionSubject,
} from "~/utils/project-settings";
import { DURATIONS } from "~/utils/time";

const SAVE_LATENCY = 600;

export const useProjectSettingsStore = defineStore("project-settings", () => {
  const overrides = ref<Record<string, Partial<Record<RetentionSubject, string>>>>({});
  const lastSaved = ref<Record<string, string>>({});

  const loading = ref(true);
  const ready = new Promise<void>((resolve) => setTimeout(resolve, 350));
  void ready.then(() => {
    loading.value = false;
  });

  function factsFor(projectId: string, name: string): ProjectFacts {
    const random = seeded(seedOf(projectId));
    const cell = REGION_CELLS[random() < 0.6 ? 0 : 1] ?? REGION_CELLS[0];
    const tier: ProjectTier = random() < 0.25 ? "hipaa" : "standard";
    return {
      id: projectId,
      name,
      orgName: projectId === "prj_acme" ? "Acme Inc." : "Hasan's org",
      cellCode: cell?.code ?? "eu-west-1",
      tier,
      plan: tier === "hipaa" ? "enterprise" : random() < 0.5 ? "free" : "pro",
      createdAt: new Date(
        Date.now() - (120 + Math.floor(random() * 600)) * DURATIONS.DAY,
      ).toISOString(),
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

  async function setRetention(
    projectId: string,
    subject: RetentionSubject,
    maxAge: string,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const held = overrides.value[projectId] ?? {};
    overrides.value = { ...overrides.value, [projectId]: { ...held, [subject]: maxAge } };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return { loading, factsFor, retentionFor, setRetention, stamp, lastSavedAt };
});

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
