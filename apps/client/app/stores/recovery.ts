/**
 * Each project's recovery codes, the one threshold the dashboard keeps about them, and the
 * figures the recovery screen shows beside both.
 *
 * A set is rows of `mfa_recovery_codes` and the only number the server publishes about one
 * is how many are unspent, so that is all this holds. It will come from the
 * management API; until then it is derived from the users the users store already has,
 * because the accounts with a second factor are the accounts with a set and two
 * independent sets of made-up people would disagree the moment somebody compared the two
 * screens. The derivation is seeded by the user id, so a set holds still between
 * visits.
 *
 * There is no regenerate here, and its absence is deliberate rather than unfinished. The
 * codes come back exactly once and only digests are kept, so an operator who could
 * regenerate would either be handed ten working credentials for somebody else's account
 * or would silently invalidate a set the owner is holding. Clearing one is the action
 * that can be taken safely: it hands nobody anything.
 */

import {
  CODE_SET,
  DEFAULT_RECOVERY_SETTINGS,
  type FallbackFactor,
  type RecoverySet,
  type RecoverySettings,
} from "~/utils/recovery";
import { DURATIONS } from "~/utils/time";

export interface RecoveryStats {
  /** Accounts holding at least one unspent code. */
  withCodes: number;
  /** Accounts with a second factor and no code left to fall back on. */
  exhausted: number;
  /** Over the last thirty days, oldest day first. */
  spent: number;
  spentDaily: number[];
  regenerated: number;
  regeneratedDaily: number[];
}

const SAVE_LATENCY = 600;

export const useRecoveryStore = defineStore("recovery", () => {
  /**
   * The threshold is a real setting; the sets below it are not yet.
   *
   * A recovery set belongs to a user and lives in `mfa_recovery_codes`, which has no
   * management endpoint — so the list of who is running low stays generated while the
   * number that decides "low" is the project's own.
   */
  const section = useSettingsSection("recovery", () => ({ ...DEFAULT_RECOVERY_SETTINGS }));
  const users = useUsersStore();

  const _settings = ref<Record<string, RecoverySettings>>({});
  const lastSaved = ref<Record<string, string>>({});
  /** Sets an operator has cleared this session, so the list shows what it did. */
  const cleared = ref<Record<string, string[]>>({});

  const loading = computed(() => users.loading);

  function settingsFor(projectId: string): RecoverySettings {
    return section.valueFor(projectId);
  }

  /**
   * Every set on the project, in the order the users arrive.
   *
   * An account holds recovery codes exactly while it holds a second factor: the server
   * issues them when the first factor is confirmed and deletes them with the last, so the
   * two cannot come apart. A tombstone is left out, because its factors went with the rest
   * of it.
   */
  function setsFor(projectId: string): RecoverySet[] {
    const clearedHere = cleared.value[projectId] ?? [];
    return users
      .forProject(projectId)
      .filter((user) => user.mfaEnabled && user.deletedAt === null)
      .map((user) => setFor(user.id, user.createdAt, clearedHere.includes(user.id)));
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: Partial<RecoverySettings>): Promise<void> {
    await section.save(projectId, { ...settingsFor(projectId), ...change });
    stamp(projectId);
  }

  /**
   * Deletes every code the account holds, spent or not.
   *
   * `MfaRecoveryCodeRepository.replaceAll` with nothing, which is the same statement the
   * server runs when the last factor is removed. The account keeps its authenticator and
   * can still sign in; what it loses is the way back if that authenticator goes.
   */
  async function clearCodes(projectId: string, userId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const already = cleared.value[projectId] ?? [];
    if (!already.includes(userId)) {
      cleared.value = { ...cleared.value, [projectId]: [...already, userId] };
    }
    stamp(projectId);
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function stats(projectId: string): RecoveryStats {
    const sets = setsFor(projectId);
    // Both are rare enough that a daily average would round to nothing, so a month's
    // worth is scattered over the thirty days instead of drawn per day.
    const spentDaily = sprinkle(seedOf(projectId), Math.round(sets.length * 0.3));
    const regeneratedDaily = sprinkle(seedOf(projectId) + 7, Math.round(sets.length * 0.12));
    return {
      withCodes: sets.filter((set) => set.remaining > 0).length,
      exhausted: sets.filter((set) => set.remaining === 0).length,
      spent: sum(spentDaily),
      spentDaily,
      regenerated: sum(regeneratedDaily),
      regeneratedDaily,
    };
  }

  return {
    settings: section.byProject,
    loading,
    settingsFor,
    setsFor,
    patch,
    clearCodes,
    lastSavedAt,
    stats,
  };
});

/*
 * The placeholder. Seeded off the user id so a set holds still, and shaped like the real
 * thing: most accounts have never spent a code, a few are part way down, and a couple are
 * out.
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

/** A stable number from a public id, so the same user gets the same set every visit. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A month's worth of a rare event, scattered over its days. A count rather than a rate,
 * because a code is spent a handful of times a month on a project this size and an
 * average of a fifth of an event a day rounds to a flat line of nothing.
 */
function sprinkle(seed: number, total: number): number[] {
  const random = seeded(seed);
  const days = Array.from({ length: 30 }, () => 0);
  for (let event = 0; event < total; event += 1) {
    const day = Math.floor(random() * days.length);
    days[day] = (days[day] ?? 0) + 1;
  }
  return days;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/**
 * How much of a set is left.
 *
 * Weighted the way a real project is: most sets are printed and never touched, a few have
 * had one or two codes spent by somebody who keeps losing a phone, and a small tail is at
 * or near the end. The tail is the whole reason this screen has a list.
 */
function remainingFor(random: () => number): number {
  const roll = random();
  if (roll < 0.55) return CODE_SET.codes;
  if (roll < 0.75) return CODE_SET.codes - (1 + Math.floor(random() * 3));
  if (roll < 0.84) return CODE_SET.codes - (4 + Math.floor(random() * 3));
  if (roll < 0.9) return CODE_SET.codes - (7 + Math.floor(random() * 3));
  return 0;
}

/**
 * How many codes are left, and what the account can be challenged with.
 *
 * The distribution is the shape a real project has: a set is printed and then not touched
 * for months, so most are untouched, and the ones that are spent are spent one at a time
 * by somebody who keeps losing their phone.
 */
function setFor(userId: string, createdAt: string, wasCleared: boolean): RecoverySet {
  const random = seeded(seedOf(userId));
  const factors: FallbackFactor[] = ["totp"];
  if (random() < 0.35) factors.push("passkey");

  if (wasCleared) {
    return { userId, issuedAt: null, remaining: 0, lastUsedAt: null, factors };
  }

  const remaining = remainingFor(random);

  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const issuedAt = new Date(created + random() * Math.max(0, now - created) * 0.4);
  const lastUsedAt =
    remaining === CODE_SET.codes
      ? null
      : new Date(issuedAt.getTime() + random() * Math.max(DURATIONS.DAY, now - issuedAt.getTime()));

  return {
    userId,
    issuedAt: issuedAt.toISOString(),
    remaining,
    lastUsedAt: lastUsedAt === null ? null : lastUsedAt.toISOString(),
    factors,
  };
}
