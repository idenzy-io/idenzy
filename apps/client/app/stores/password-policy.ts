/**
 * Each project's password policy, and the figures the passwords screen shows beside it.
 *
 * The policy lives in the project's `settings` on the server and is read and written
 * through the management API; this store is that record as the panel sees it, with a
 * placeholder until the client exists. A change is written the moment it is made, one
 * field at a time through `patch`: the screen has no draft and no save button, and a
 * control shows its own busy state while its value is on its way. The server validates
 * the policy the patch produces as one thing, so the screen checks the same before
 * sending and keeps a refused value on screen with the reason rather than sending it.
 */

import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from "~/utils/password-policy";

export interface PasswordStats {
  /** Over the last thirty days, oldest day first. */
  signIns: number;
  signInsDaily: number[];
  /** Accounts holding a password hash, whatever its format. */
  accounts: number;
  breachedRefused: number;
  breachedDaily: number[];
  resets: number;
  resetsDaily: number[];
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const usePasswordPolicyStore = defineStore("password-policy", () => {
  const policies = ref<Record<string, PasswordPolicy>>({});
  const loading = ref(true);

  setTimeout(() => {
    policies.value = {
      prj_personal: { ...DEFAULT_PASSWORD_POLICY },
      prj_acme: { ...DEFAULT_PASSWORD_POLICY, minLength: 12, lockout: true, resetLifetime: 30 },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function policyFor(projectId: string): PasswordPolicy {
    return policies.value[projectId] ?? { ...DEFAULT_PASSWORD_POLICY };
  }

  /** When each project's policy was last written this session, for the screen to say. */
  const lastSaved = ref<Record<string, string>>({});

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: Partial<PasswordPolicy>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    policies.value = { ...policies.value, [projectId]: { ...policyFor(projectId), ...change } };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function stats(projectId: string): PasswordStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  return { policies, loading, policyFor, patch, lastSavedAt, stats };
});

/*
 * Placeholder figures, seeded so they hold still. The personal project has a modest
 * password population; Acme a large one.
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

const PERSONAL_SIGN_INS = daily(3, 96, 40);
const PERSONAL_BREACHED = daily(5, 1.2, 2);
const PERSONAL_RESETS = daily(7, 2.4, 3);

const PERSONAL_STATS: PasswordStats = {
  signIns: sum(PERSONAL_SIGN_INS),
  signInsDaily: PERSONAL_SIGN_INS,
  accounts: 84,
  breachedRefused: sum(PERSONAL_BREACHED),
  breachedDaily: PERSONAL_BREACHED,
  resets: sum(PERSONAL_RESETS),
  resetsDaily: PERSONAL_RESETS,
};

const ACME_SIGN_INS = daily(11, 1840, 600);
const ACME_BREACHED = daily(13, 9, 8);
const ACME_RESETS = daily(17, 31, 20);

const ACME_STATS: PasswordStats = {
  signIns: sum(ACME_SIGN_INS),
  signInsDaily: ACME_SIGN_INS,
  accounts: 2614,
  breachedRefused: sum(ACME_BREACHED),
  breachedDaily: ACME_BREACHED,
  resets: sum(ACME_RESETS),
  resetsDaily: ACME_RESETS,
};
