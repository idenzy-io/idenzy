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

import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
  type StoredCounts,
} from "~/utils/password-policy";

export interface PasswordStats {
  /** Over the last thirty days, oldest day first. */
  signIns: number;
  signInsDaily: number[];
  /** Accounts holding a password hash, whatever its format. */
  accounts: number;
  /**
   * Of those, the ones with no other way in: no passkey, no provider, no one-time code.
   * The figure the disable dialog is really about, because for them turning the method
   * off is the account.
   */
  passwordOnly: number;
  /** Those same accounts by the format the hash is in, which is what a migration moves. */
  stored: StoredCounts;
  breachedRefused: number;
  breachedDaily: number[];
  resets: number;
  resetsDaily: number[];
  /** The same two windows one period back, so a tile can say which way they moved. */
  signInsPrevious: number;
  resetsPrevious: number;
}

export const usePasswordPolicyStore = defineStore("password-policy", () => {
  const section = useSettingsSection("password", () => ({ ...DEFAULT_PASSWORD_POLICY }));

  /**
   * The project's policy, or the defaults until the server has answered.
   *
   * The defaults are the same object the server resolves an unset document to, so the
   * screen shows what an unconfigured project actually does rather than a blank form.
   */
  function policyFor(projectId: string): PasswordPolicy {
    return section.valueFor(projectId);
  }

  /**
   * Writes the fields given and leaves the rest.
   *
   * The whole section goes up, because the API replaces sections rather than deep-merging;
   * the screen edits one control at a time, so the current policy is the base and the
   * change is laid over it.
   */
  async function patch(projectId: string, change: Partial<PasswordPolicy>): Promise<void> {
    await section.save(projectId, { ...policyFor(projectId), ...change });
  }

  /**
   * The figures beside the policy, still generated.
   *
   * Counts over sign-ins, refusals and resets live in the analytics store (ADR-0013) and
   * wait on 3.2's panel wiring, not on an endpoint that could exist today.
   */
  function stats(projectId: string): PasswordStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  return {
    policies: section.byProject,
    loading: section.loading,
    refusal: section.refusal,
    load: section.load,
    policyFor,
    patch,
    lastSavedAt: section.lastSavedAt,
    stats,
  };
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
/* The window before, seeded apart from it, so the movement holds still between renders. */
const PERSONAL_SIGN_INS_BEFORE = daily(23, 88, 40);
const PERSONAL_RESETS_BEFORE = daily(29, 2.1, 3);

/* A project that never imported anything: every hash was written here. */
const PERSONAL_STATS: PasswordStats = {
  signIns: sum(PERSONAL_SIGN_INS),
  signInsDaily: PERSONAL_SIGN_INS,
  accounts: 84,
  passwordOnly: 31,
  stored: { current: 84, legacy: { bcrypt: 0, scrypt: 0, argon2: 0, pbkdf2: 0 } },
  breachedRefused: sum(PERSONAL_BREACHED),
  breachedDaily: PERSONAL_BREACHED,
  resets: sum(PERSONAL_RESETS),
  resetsDaily: PERSONAL_RESETS,
  signInsPrevious: sum(PERSONAL_SIGN_INS_BEFORE),
  resetsPrevious: sum(PERSONAL_RESETS_BEFORE),
};

const ACME_SIGN_INS = daily(11, 1840, 600);
const ACME_BREACHED = daily(13, 9, 8);
const ACME_RESETS = daily(17, 31, 20);
const ACME_SIGN_INS_BEFORE = daily(31, 1710, 600);
const ACME_RESETS_BEFORE = daily(37, 34, 20);

/* A project part-way through an import: most accounts have signed in since and been
   rehashed, and the tail is people who have not been back yet. */
const ACME_STATS: PasswordStats = {
  signIns: sum(ACME_SIGN_INS),
  signInsDaily: ACME_SIGN_INS,
  accounts: 2614,
  passwordOnly: 1204,
  stored: { current: 1998, legacy: { bcrypt: 487, scrypt: 92, argon2: 0, pbkdf2: 37 } },
  breachedRefused: sum(ACME_BREACHED),
  breachedDaily: ACME_BREACHED,
  resets: sum(ACME_RESETS),
  resetsDaily: ACME_RESETS,
  signInsPrevious: sum(ACME_SIGN_INS_BEFORE),
  resetsPrevious: sum(ACME_RESETS_BEFORE),
};
