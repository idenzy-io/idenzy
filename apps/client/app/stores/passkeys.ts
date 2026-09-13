/**
 * Each project's passkey settings, its relying party, and the figures the passkeys
 * screen shows beside them.
 *
 * The relying party is a row of `webauthn_relying_parties`, one per project, read and
 * written through the management API; the switch lives in the project's settings. This
 * store is both as the panel sees them, with a placeholder until the client exists. A
 * change is written the moment it is made and the screen shows its own busy state, as
 * the passwords screen does.
 */

import { InternalError } from "@idenzy/core/errors";
import type { PasskeySettings, RelyingParty } from "~/utils/passkeys";

export interface PasskeyStats {
  /** Over the last thirty days, oldest day first. */
  signIns: number;
  signInsDaily: number[];
  /** The same window one period back, so a tile can say which way it moved. */
  signInsPrevious: number;
  /** Credentials on the project, and how many were added per day. */
  enrolled: number;
  enrolledDaily: number[];
  /** Accounts holding at least one. */
  accounts: number;
  /** Assertions refused: a counter that went backwards, an origin off the list, a stale challenge. */
  refused: number;
  refusedDaily: number[];
  refusedPrevious: number;
  /**
   * Credentials by the authenticator that made them, and how many of each are synced.
   * `backedUp` is read from the backup-state flag the authenticator signs, so the split
   * belongs to the row rather than to the project: a security key never syncs and a
   * platform authenticator usually does.
   */
  byAuthenticator: { aaguid: string | null; count: number; backedUp: number }[];
}

const _PLACEHOLDER_LATENCY = 700;
const _SAVE_LATENCY = 600;

export const usePasskeysStore = defineStore("passkeys", () => {
  const section = useSettingsSection("passkeys", () => ({ enabled: true }));

  /**
   * The switch from settings, and the relying party from nowhere yet.
   *
   * `relyingParty` is a row in `webauthn_relying_parties` with a unique index behind it —
   * one project may have exactly one, because a second would split a customer's passkeys
   * into two sets that cannot substitute for each other — so it is not a section of the
   * settings document and cannot be. Null until that table has an endpoint, which is the
   * honest answer: the screen already says nothing passkey works without one.
   */
  function settingsFor(projectId: string): PasskeySettings {
    return { ...section.valueFor(projectId), relyingParty: null };
  }

  async function patch(projectId: string, change: Partial<PasskeySettings>): Promise<void> {
    if (change.enabled === undefined) return;
    await section.save(projectId, { enabled: change.enabled });
  }

  /** No endpoint: `webauthn_relying_parties` has no management route (todo.md 1.6). */
  function setRelyingParty(_projectId: string, _party: RelyingParty): Promise<void> {
    return Promise.reject(
      new InternalError({
        detail: { reason: "the relying party has no management endpoint yet" },
      }),
    );
  }

  /** Counts of ceremonies live in the analytics store (ADR-0013), not in Postgres. */
  function stats(projectId: string): PasskeyStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  return {
    settings: section.byProject,
    loading: section.loading,
    refusal: section.refusal,
    load: section.load,
    settingsFor,
    patch,
    setRelyingParty,
    lastSavedAt: section.lastSavedAt,
    stats,
  };
});

/*
 * Placeholder figures, seeded so they hold still.
 */
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

function daily(seed: number, base: number, swing: number): number[] {
  const random = seeded(seed);
  return Array.from({ length: 30 }, (_, day) => {
    const weekend = day % 7 === 5 || day % 7 === 6 ? 0.6 : 1;
    return Math.max(0, Math.round((base + (random() - 0.5) * swing) * weekend));
  });
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const PERSONAL_SIGN_INS = daily(21, 38, 20);
const PERSONAL_ENROLLED = daily(23, 1.6, 2);
const PERSONAL_REFUSED = daily(25, 0.3, 1);
/* The window before, seeded apart from it, so the movement holds still between renders. */
const PERSONAL_SIGN_INS_BEFORE = daily(31, 33, 20);
const PERSONAL_REFUSED_BEFORE = daily(35, 0.5, 1);

const PERSONAL_STATS: PasskeyStats = {
  signIns: sum(PERSONAL_SIGN_INS),
  signInsDaily: PERSONAL_SIGN_INS,
  signInsPrevious: sum(PERSONAL_SIGN_INS_BEFORE),
  enrolled: 61,
  enrolledDaily: PERSONAL_ENROLLED,
  accounts: 47,
  refused: sum(PERSONAL_REFUSED),
  refusedDaily: PERSONAL_REFUSED,
  refusedPrevious: sum(PERSONAL_REFUSED_BEFORE),
  byAuthenticator: [
    { aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd", count: 27, backedUp: 27 },
    { aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4", count: 16, backedUp: 16 },
    { aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96", count: 8, backedUp: 4 },
    { aaguid: "bada5566-a7aa-401f-bd96-45619a55120d", count: 5, backedUp: 3 },
    { aaguid: "ee882879-721c-4913-9775-3dfcce97072a", count: 3, backedUp: 0 },
    { aaguid: null, count: 2, backedUp: 0 },
  ],
};

const ACME_STATS: PasskeyStats = {
  signIns: 0,
  signInsDaily: Array.from({ length: 30 }, () => 0),
  signInsPrevious: 0,
  enrolled: 0,
  enrolledDaily: Array.from({ length: 30 }, () => 0),
  accounts: 0,
  refused: 0,
  refusedDaily: Array.from({ length: 30 }, () => 0),
  refusedPrevious: 0,
  byAuthenticator: [],
};
