/**
 * Each project's three lifetimes, and the one thing about them the panel only observes.
 *
 * The settings live in the project's `settings` on the server, read and written through
 * the management API; this store is those as the panel sees them, with a placeholder
 * until the client exists. Each is written the moment it is made, as on the passwords and
 * step-up screens, because they are three independent numbers and nothing here is
 * checkable only against the whole.
 *
 * `revocationPolledAt` is not a setting and cannot be one. It is when a verifier last
 * fetched the project's revocation snapshot, which is the difference between a revoked
 * session dying in five seconds and dying in one access-token lifetime (ADR-0009). The
 * screen states which of the two this project is actually in rather than describing both,
 * and a customer turns it on by building a `RevocationCache`, never by ticking a box here.
 *
 * The seeded idle and absolute windows are the ones `stores/sessions.ts` generated its
 * rows against. Two screens quoting different lifetimes for the same project reads as a
 * bug the moment somebody compares this one with a session's expiry column.
 */

import { DEFAULT_LIFETIME_SETTINGS, type LifetimeSettings } from "~/utils/lifetimes";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useLifetimesStore = defineStore("lifetimes", () => {
  const settings = ref<Record<string, LifetimeSettings>>({});
  /** When a verifier holding this project's secret key last read the snapshot. */
  const polled = ref<Record<string, string>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    settings.value = {
      prj_personal: { ...DEFAULT_LIFETIME_SETTINGS },
      /* A backend that polls the set, which is what buys the longer token. */
      prj_acme: { accessTokenSeconds: 900, idleSeconds: 14 * 86_400, absoluteSeconds: 90 * 86_400 },
    };
    polled.value = { prj_acme: new Date(Date.now() - 4_000).toISOString() };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function settingsFor(projectId: string): LifetimeSettings {
    return settings.value[projectId] ?? { ...DEFAULT_LIFETIME_SETTINGS };
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: Partial<LifetimeSettings>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    settings.value = {
      ...settings.value,
      [projectId]: { ...settingsFor(projectId), ...change },
    };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** Null where nothing has ever polled, which is a different state from polling slowly. */
  function revocationPolledAt(projectId: string): string | null {
    return polled.value[projectId] ?? null;
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return { settings, loading, settingsFor, patch, revocationPolledAt, lastSavedAt };
});
