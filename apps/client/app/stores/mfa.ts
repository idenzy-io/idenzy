/**
 * Each project's second-factor settings and the figures the authenticator screen shows
 * beside them.
 *
 * The settings live in the project's `settings` on the server, read and written through
 * the management API; this store is those as the panel sees them, with a placeholder
 * until the client exists. A change is written the moment it is made and the screen
 * shows its own busy state, as the passwords screen does. The recovery-code and step-up
 * screens extend this store rather than starting their own, so the three cannot disagree
 * about one record.
 */

import { type AuthenticatorSettings, DEFAULT_AUTHENTICATOR_SETTINGS } from "~/utils/mfa";
import { DEFAULT_STEP_UP_SETTINGS, type StepUpSettings } from "~/utils/step-up";

export interface AuthenticatorStats {
  /** Over the last thirty days, oldest day first. Sign-ins that stopped at a second factor. */
  challenges: number;
  challengesDaily: number[];
  /** Accounts holding a confirmed authenticator, and how many confirmed one per day. */
  enrolled: number;
  enrolledDaily: number[];
  /** Proofs refused: a wrong code, a step already spent, the fifth attempt. */
  refused: number;
  refusedDaily: number[];
  /** Challenges asked for in front of something sensitive, inside a session. */
  stepUps: number;
  stepUpsDaily: number[];
  /** Completed challenges by what answered them. */
  answeredBy: { totp: number; passkey: number; recovery: number };
  /** Every account on the project, for the share that holds an authenticator. */
  accounts: number;
}

export interface StepUpStats {
  /** Over the last thirty days, oldest day first. Challenges minted in front of an action. */
  asked: number;
  askedDaily: number[];
  /** Challenges answered, which moved a session's factor age. */
  completed: number;
  completedDaily: number[];
  /** Actions refused for a missing or stale proof, before any challenge was asked for. */
  refused: number;
  refusedDaily: number[];
  /** Starts answered 204: the caller held nothing to be asked for, and went ahead. */
  passedThrough: number;
  passedThroughDaily: number[];
  /** Completed step-ups by what answered them. A recovery code never can. */
  answeredBy: { totp: number; passkey: number };
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useMfaStore = defineStore("mfa", () => {
  const authenticator = ref<Record<string, AuthenticatorSettings>>({});
  const stepUp = ref<Record<string, StepUpSettings>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    authenticator.value = {
      prj_personal: { enabled: true, issuer: null },
      prj_acme: { enabled: true, issuer: "Acme" },
    };
    stepUp.value = {
      prj_personal: { maxAgeMinutes: 15 },
      prj_acme: { maxAgeMinutes: 5 },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function authenticatorFor(projectId: string): AuthenticatorSettings {
    return authenticator.value[projectId] ?? { ...DEFAULT_AUTHENTICATOR_SETTINGS };
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patchAuthenticator(
    projectId: string,
    change: Partial<AuthenticatorSettings>,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    authenticator.value = {
      ...authenticator.value,
      [projectId]: { ...authenticatorFor(projectId), ...change },
    };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function authenticatorStats(projectId: string): AuthenticatorStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  function stepUpFor(projectId: string): StepUpSettings {
    return stepUp.value[projectId] ?? { ...DEFAULT_STEP_UP_SETTINGS };
  }

  async function patchStepUp(projectId: string, change: Partial<StepUpSettings>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    stepUp.value = { ...stepUp.value, [projectId]: { ...stepUpFor(projectId), ...change } };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function stepUpStats(projectId: string): StepUpStats {
    return projectId === "prj_acme" ? ACME_STEP_UP : PERSONAL_STEP_UP;
  }

  return {
    authenticator,
    stepUp,
    loading,
    authenticatorFor,
    patchAuthenticator,
    stepUpFor,
    patchStepUp,
    lastSavedAt,
    authenticatorStats,
    stepUpStats,
  };
});

/*
 * Placeholder figures, seeded so they hold still. The personal project has a handful of
 * accounts with an authenticator; Acme has the share the users screen reports.
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

const PERSONAL_CHALLENGES = daily(67, 9, 6);
const PERSONAL_ENROLLED = daily(71, 0.3, 1);
const PERSONAL_REFUSED = daily(73, 0.4, 1);
const PERSONAL_STEP_UPS = daily(79, 1.2, 2);

const PERSONAL_STATS: AuthenticatorStats = {
  challenges: sum(PERSONAL_CHALLENGES),
  challengesDaily: PERSONAL_CHALLENGES,
  enrolled: 31,
  enrolledDaily: PERSONAL_ENROLLED,
  refused: sum(PERSONAL_REFUSED),
  refusedDaily: PERSONAL_REFUSED,
  stepUps: sum(PERSONAL_STEP_UPS),
  stepUpsDaily: PERSONAL_STEP_UPS,
  answeredBy: { totp: 214, passkey: 38, recovery: 3 },
  accounts: 184,
};

const ACME_CHALLENGES = daily(83, 142, 60);
const ACME_ENROLLED = daily(89, 6, 5);
const ACME_REFUSED = daily(97, 7, 6);
const ACME_STEP_UPS = daily(101, 23, 14);

const ACME_STATS: AuthenticatorStats = {
  challenges: sum(ACME_CHALLENGES),
  challengesDaily: ACME_CHALLENGES,
  enrolled: 627,
  enrolledDaily: ACME_ENROLLED,
  refused: sum(ACME_REFUSED),
  refusedDaily: ACME_REFUSED,
  stepUps: sum(ACME_STEP_UPS),
  stepUpsDaily: ACME_STEP_UPS,
  answeredBy: { totp: 3_412, passkey: 592, recovery: 27 },
  accounts: 2_614,
};

/*
 * Step-up figures. What was asked is the same series the authenticator screen's tile
 * draws, so the two screens agree about it; the rest hangs off it.
 */
/* Its own series rather than a share of the asks: at one or two a day a share rounds
   back up to the ask, and a project that answers every step-up it ever raised is not a
   figure anyone should see. */
const PERSONAL_STEP_UP_COMPLETED = daily(157, 1, 1.6);
const PERSONAL_STEP_UP_REFUSED = daily(103, 0.7, 1.4);
const PERSONAL_STEP_UP_PASSED = daily(107, 4, 3);

const PERSONAL_STEP_UP: StepUpStats = {
  asked: sum(PERSONAL_STEP_UPS),
  askedDaily: PERSONAL_STEP_UPS,
  completed: sum(PERSONAL_STEP_UP_COMPLETED),
  completedDaily: PERSONAL_STEP_UP_COMPLETED,
  refused: sum(PERSONAL_STEP_UP_REFUSED),
  refusedDaily: PERSONAL_STEP_UP_REFUSED,
  passedThrough: sum(PERSONAL_STEP_UP_PASSED),
  passedThroughDaily: PERSONAL_STEP_UP_PASSED,
  answeredBy: { totp: 27, passkey: 5 },
};

const ACME_STEP_UP_COMPLETED = ACME_STEP_UPS.map((asked) => Math.round(asked * 0.88));
const ACME_STEP_UP_REFUSED = daily(109, 11, 8);
const ACME_STEP_UP_PASSED = daily(113, 41, 20);

const ACME_STEP_UP: StepUpStats = {
  asked: sum(ACME_STEP_UPS),
  askedDaily: ACME_STEP_UPS,
  completed: sum(ACME_STEP_UP_COMPLETED),
  completedDaily: ACME_STEP_UP_COMPLETED,
  refused: sum(ACME_STEP_UP_REFUSED),
  refusedDaily: ACME_STEP_UP_REFUSED,
  passedThrough: sum(ACME_STEP_UP_PASSED),
  passedThroughDaily: ACME_STEP_UP_PASSED,
  answeredBy: { totp: 506, passkey: 101 },
};
