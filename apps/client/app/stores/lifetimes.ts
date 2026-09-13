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

const _PLACEHOLDER_LATENCY = 700;
const _SAVE_LATENCY = 600;

export const useLifetimesStore = defineStore("lifetimes", () => {
  const section = useSettingsSection("lifetimes", () => ({ ...DEFAULT_LIFETIME_SETTINGS }));

  function settingsFor(projectId: string): LifetimeSettings {
    return section.valueFor(projectId);
  }

  /**
   * Writes the fields given and leaves the rest.
   *
   * The server refuses an idle window that outlives the absolute lifetime, and refuses
   * anything outside sixty seconds to an hour for the access token — so a value the screen
   * lets through and the API does not comes back as a refusal rather than as a save that
   * did nothing.
   */
  async function patch(projectId: string, change: Partial<LifetimeSettings>): Promise<void> {
    await section.save(projectId, { ...settingsFor(projectId), ...change });
  }

  /**
   * When a verifier last fetched this project's revocation snapshot.
   *
   * Always null, and that is the true answer rather than a missing one: nothing records a
   * poll. `GET /v1/revocations` is served with an ETag and a secret key, and the fetch is
   * not written down anywhere — so the screen can say "we have never seen one" and cannot
   * yet distinguish that from "one polled an hour ago". Recording it means a write on a
   * read path that exists to be cheap, which is a decision worth making deliberately
   * rather than for a timestamp on a screen.
   */
  function revocationPolledAt(_projectId: string): string | null {
    return null;
  }

  return {
    settings: section.byProject,
    loading: section.loading,
    refusal: section.refusal,
    load: section.load,
    settingsFor,
    patch,
    revocationPolledAt,
    lastSavedAt: section.lastSavedAt,
  };
});
