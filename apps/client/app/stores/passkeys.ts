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

import {
  DEFAULT_PASSKEY_SETTINGS,
  type PasskeySettings,
  type RelyingParty,
} from "~/utils/passkeys";

export interface PasskeyStats {
  /** Over the last thirty days, oldest day first. */
  signIns: number;
  signInsDaily: number[];
  /** Credentials on the project, and how many were added per day. */
  enrolled: number;
  enrolledDaily: number[];
  /** Accounts holding at least one. */
  accounts: number;
  /** Assertions refused: a counter that went backwards, an origin off the list, a stale challenge. */
  refused: number;
  refusedDaily: number[];
  /** Credentials by the authenticator that made them. */
  byAuthenticator: { aaguid: string | null; count: number }[];
  /** From the signed backup-state flag: synced to a provider's cloud, or bound to one device. */
  backedUp: number;
  deviceBound: number;
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const usePasskeysStore = defineStore("passkeys", () => {
  const settings = ref<Record<string, PasskeySettings>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    settings.value = {
      prj_personal: {
        enabled: true,
        relyingParty: {
          rpId: "example.com",
          rpName: "Example",
          origins: ["https://example.com", "https://app.example.com"],
        },
      },
      prj_acme: { enabled: true, relyingParty: null },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function settingsFor(projectId: string): PasskeySettings {
    return settings.value[projectId] ?? { ...DEFAULT_PASSKEY_SETTINGS };
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: Partial<PasskeySettings>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    settings.value = {
      ...settings.value,
      [projectId]: { ...settingsFor(projectId), ...change },
    };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** The relying party as one write, because its three fields are validated together. */
  function setRelyingParty(projectId: string, party: RelyingParty): Promise<void> {
    return patch(projectId, {
      relyingParty: { rpId: party.rpId, rpName: party.rpName, origins: [...party.origins] },
    });
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function stats(projectId: string): PasskeyStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  return { settings, loading, settingsFor, patch, setRelyingParty, lastSavedAt, stats };
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

const PERSONAL_STATS: PasskeyStats = {
  signIns: sum(PERSONAL_SIGN_INS),
  signInsDaily: PERSONAL_SIGN_INS,
  enrolled: 61,
  enrolledDaily: PERSONAL_ENROLLED,
  accounts: 47,
  refused: sum(PERSONAL_REFUSED),
  refusedDaily: PERSONAL_REFUSED,
  byAuthenticator: [
    { aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd", count: 27 },
    { aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4", count: 16 },
    { aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96", count: 8 },
    { aaguid: "bada5566-a7aa-401f-bd96-45619a55120d", count: 5 },
    { aaguid: "ee882879-721c-4913-9775-3dfcce97072a", count: 3 },
    { aaguid: null, count: 2 },
  ],
  backedUp: 50,
  deviceBound: 11,
};

const ACME_STATS: PasskeyStats = {
  signIns: 0,
  signInsDaily: Array.from({ length: 30 }, () => 0),
  enrolled: 0,
  enrolledDaily: Array.from({ length: 30 }, () => 0),
  accounts: 0,
  refused: 0,
  refusedDaily: Array.from({ length: 30 }, () => 0),
  byAuthenticator: [],
  backedUp: 0,
  deviceBound: 0,
};
