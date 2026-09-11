/**
 * The revocation snapshot each project would serve if something polled it right now.
 *
 * One `GET /v1/revocations` with the project's secret key, which answers a signed set of
 * everything revoked inside the retention window; this store is that answer, with a
 * placeholder until the management client exists. There is nothing to write here: the set
 * is published and never queried, and every entry in it was put there by a revocation
 * made somewhere else.
 *
 * What it does hold beyond the set is the two halves of the connection test, and they are
 * deliberately separate: a read of the snapshot is something this end can observe, and a
 * verifier refusing a token is not. `runProbe` publishes an entry for a session that never
 * existed and watches for the read; `confirm` records that an operator watched their own
 * verifier refuse it. Neither is ever inferred from the other.
 *
 * The placeholder is built from sessions the sessions store has actually revoked, so an
 * id on this screen names a session and an account that exist on the others. What it does
 * change is the instant: a snapshot only ever holds the last few minutes, and the
 * generated history is older than that, so the seed re-dates a handful of them into the
 * window. It seeds on the first read of a project rather than at load, so opening the
 * screen shows a live set draining rather than an empty one that drained while nobody was
 * looking. Both go when the client lands.
 */

import {
  entryKindFor,
  POLL_SECONDS,
  PROBE_TIMEOUT_SECONDS,
  type ProbeRun,
  type RevocationEntry,
} from "~/utils/revocation";
import type { SessionRow } from "~/utils/sessions";

/** How far back the seeded entries are placed, in seconds. Inside any retention window. */
const SEED_AGES = [8, 41, 96, 154, 213, 289];

/** What a re-read of the polling observation takes, so the button has a wait to show. */
const REFRESH_LATENCY = 700;

export const useRevocationsStore = defineStore("revocations", () => {
  const sessions = useSessionsStore();
  const lifetimes = useLifetimesStore();

  const entries = ref<Record<string, RevocationEntry[]>>({});
  const seeded = ref<Record<string, boolean>>({});
  /** When the panel last read the polling observation, per project. */
  const checked = ref<Record<string, string>>({});
  /** The connection test in flight or last run, per project. */
  const probes = ref<Record<string, ProbeRun>>({});
  /**
   * When an operator said they watched their own verifier refuse the probe. It is the
   * only record of the half of the path this end cannot see, so it is a statement they
   * made rather than a check we ran, and the screen never writes it for them.
   */
  const confirmed = ref<Record<string, string>>({});

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

  /*
   * The connection test.
   *
   * It publishes an entry for a session that never existed and then watches for a read
   * carrying it. The synthetic id is the whole safety of the thing: revoking a real
   * session to find out whether a backend is polling would sign somebody out to answer a
   * question about configuration.
   *
   * Only the first half is ours. A read is observed here; whether the customer's verifier
   * refused a token is `confirm`, which an operator states after watching it happen.
   */
  function runProbe(projectId: string): void {
    const startedAt = new Date().toISOString();
    const sessionId = `ses_probe_${Math.random().toString(16).slice(2, 10)}`;
    probes.value = {
      ...probes.value,
      [projectId]: { sessionId, startedAt, readAt: null, state: "running" },
    };

    const entry: RevocationEntry = {
      id: sessionId,
      kind: "session",
      revokedAt: startedAt,
      reason: "admin_revoked",
      userId: "usr_probe",
      probe: true,
    };
    entries.value = { ...entries.value, [projectId]: [entry, ...entriesFor(projectId)] };

    /* A poller reads within its own interval; one that never reads is what the timeout
       is for, and the two answers are kept apart because they mean different things. */
    const polling = lifetimes.revocationPolledAt(projectId) !== null;
    const waitMs = polling ? (POLL_SECONDS + 1) * 1000 : PROBE_TIMEOUT_SECONDS * 1000;
    setTimeout(() => {
      const run = probes.value[projectId];
      if (run === undefined || run.sessionId !== sessionId) return;
      probes.value = {
        ...probes.value,
        [projectId]: polling
          ? { ...run, readAt: new Date().toISOString(), state: "read" }
          : { ...run, state: "unread" },
      };
      if (polling) touch(projectId);
    }, waitMs);
  }

  function probeFor(projectId: string): ProbeRun | null {
    return probes.value[projectId] ?? null;
  }

  /** Records that an operator watched their own verifier refuse the probe's token. */
  function confirm(projectId: string): void {
    confirmed.value = { ...confirmed.value, [projectId]: new Date().toISOString() };
  }

  function confirmedAt(projectId: string): string | null {
    return confirmed.value[projectId] ?? null;
  }

  /**
   * Re-reads the polling observation.
   *
   * It changes nothing about what is true, only when we looked, which is why the button
   * that calls it says so. Offered because the alternative is an operator reloading the
   * page to find out whether the deployment they just shipped is reading the set.
   */
  async function refresh(projectId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, REFRESH_LATENCY));
    touch(projectId);
  }

  function touch(projectId: string) {
    checked.value = { ...checked.value, [projectId]: new Date().toISOString() };
  }

  function checkedAt(projectId: string): string | null {
    return checked.value[projectId] ?? null;
  }

  return {
    entries,
    loading,
    entriesFor,
    runProbe,
    probeFor,
    confirm,
    confirmedAt,
    refresh,
    checkedAt,
  };
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
