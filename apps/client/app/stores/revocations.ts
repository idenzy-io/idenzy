/**
 * The revocation snapshot each project would serve if something polled it right now.
 *
 * One `GET /v1/revocations` with the project's secret key, which answers a signed set of
 * everything revoked inside the retention window; this store is that answer, with a
 * placeholder until the management client exists. There is nothing to write here: the set
 * is published and never queried, and every entry in it was put there by a revocation
 * made somewhere else.
 *
 * The placeholder is built from sessions the sessions store has actually revoked, so an
 * id on this screen names a session and an account that exist on the others. What it does
 * change is the instant: a snapshot only ever holds the last few minutes, and the
 * generated history is older than that, so the seed re-dates a handful of them into the
 * window. It seeds on the first read of a project rather than at load, so opening the
 * screen shows a live set draining rather than an empty one that drained while nobody was
 * looking. Both go when the client lands.
 */

import { entryKindFor, type RevocationEntry } from "~/utils/revocation";
import type { SessionRow } from "~/utils/sessions";

/** How far back the seeded entries are placed, in seconds. Inside any retention window. */
const SEED_AGES = [8, 41, 96, 154, 213, 289];

export const useRevocationsStore = defineStore("revocations", () => {
  const sessions = useSessionsStore();

  const entries = ref<Record<string, RevocationEntry[]>>({});
  const seeded = ref<Record<string, boolean>>({});

  /** True until the sessions the seed is built from have arrived. */
  const loading = computed(() => sessions.loading);

  /**
   * The set for one project. Seeded on first read, which is what keeps a screen opened an
   * hour into the session from showing a window that emptied while nobody was watching.
   */
  function entriesFor(projectId: string): RevocationEntry[] {
    const held = entries.value[projectId];
    if (held !== undefined) return held;
    if (sessions.loading || seeded.value[projectId] === true) return [];
    const seed = placeholderEntries(projectId);
    seeded.value = { ...seeded.value, [projectId]: true };
    entries.value = { ...entries.value, [projectId]: seed };
    return seed;
  }

  /**
   * Revoked sessions re-dated into the window, one entry each, collapsed where the reason
   * is a watermark: signing out everywhere and a password reset write one entry for the
   * account however many sessions they ended, which is the whole reason watermarks exist.
   */
  function placeholderEntries(projectId: string): RevocationEntry[] {
    const revoked = sessions
      .forProject(projectId)
      .filter((row) => row.revokedAt !== null)
      .sort((a, b) => (b.revokedAt ?? "").localeCompare(a.revokedAt ?? ""));

    const now = Date.now();
    const seen = new Set<string>();
    const built: RevocationEntry[] = [];

    for (const row of revoked) {
      const age = SEED_AGES[built.length];
      if (age === undefined) break;
      const entry = entryFor(row, now - age * 1000);
      if (entry === null || seen.has(entry.id)) continue;
      seen.add(entry.id);
      built.push(entry);
    }
    return built;
  }

  return { entries, loading, entriesFor };
});

/**
 * The entry one revoked session would have written, at the instant given. Null where the
 * reason writes nothing, which is every lapse: by the time a session lapses there is no
 * live token left for an entry to kill.
 */
function entryFor(row: SessionRow, at: number): RevocationEntry | null {
  const reason = row.revokeReason;
  if (reason === null) return null;
  const kind = entryKindFor(reason);
  if (kind === null) return null;
  return {
    id: kind === "user" ? row.userId : row.id,
    kind,
    revokedAt: new Date(at).toISOString(),
    reason,
    userId: row.userId,
  };
}
