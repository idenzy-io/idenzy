/**
 * Each project's security signals, the rules it keeps about them, and the refusal counts
 * the attack dashboard draws.
 *
 * Signals will come from the detectors behind the management API. Until then they are
 * derived from the users the users store already holds, seeded by the project id, for the
 * reason the recovery store derives sheets the same way: two independently invented sets
 * of people disagree the moment somebody compares this screen with the users list.
 *
 * A decision is kept here rather than folded back into the derivation, so acknowledging a
 * row and then switching projects and back shows the acknowledgement rather than a fresh
 * roll of the dice.
 *
 * The refusal series is a separate derivation and deliberately not counted off the
 * signals. A refused sign-in is not a signal: almost every one of them is somebody who
 * typed their password wrong, and a chart built by counting signal rows would report a
 * project with good detectors as a project under attack.
 */

import {
  DEFAULT_SECURITY_SETTINGS,
  type DetectorId,
  type DetectorRule,
  type DismissReason,
  type RefusalReason,
  type SecuritySettings,
  type SecuritySignal,
  type SignalEvidence,
  type SignalState,
  severityOf,
} from "~/utils/security";
import { DURATIONS } from "~/utils/time";

export interface SecurityStats {
  /** Signals nobody has decided about yet. */
  open: number;
  /** Open signals that say something has already happened. */
  urgent: number;
  /** Accounts named by at least one open signal. Never a count of compromises. */
  accountsFlagged: number;
  /** Passwords refused for appearing in the corpus, over the window. */
  breachedRefused: number;
  breachedDaily: number[];
  /** Every refused sign-in, over the window. */
  refused: number;
  refusedDaily: number[];
}

const SAVE_LATENCY = 600;

/** Days of refusal counts the placeholder hands out, and the width of every series. */
const WINDOW_DAYS = 30;

/**
 * Days the placeholder scatters signals over. Wider than the refusal series on purpose:
 * signals are kept for the project's retention and refusals are a daily count, so a screen
 * set to "All" has to be able to show something the 30-day window does not.
 */
const SPREAD_DAYS = 90;

/**
 * Who a decision is recorded against. The management API takes this from the session, so
 * this is the drawer's placeholder address and nothing more.
 */
const OPERATOR = "hasan@example.com";

export const useSecurityStore = defineStore("security", () => {
  const users = useUsersStore();

  const settings = ref<Record<string, SecuritySettings>>({});
  const lastSaved = ref<Record<string, string>>({});
  /** Decisions taken this session, keyed by project and then by signal. */
  const decisions = ref<Record<string, Record<string, Decision>>>({});

  const loading = computed(() => users.loading);

  function settingsFor(projectId: string): SecuritySettings {
    const held = settings.value[projectId];
    if (held) return held;
    return { ...DEFAULT_SECURITY_SETTINGS, rules: { ...DEFAULT_SECURITY_SETTINGS.rules } };
  }

  function ruleFor(projectId: string, id: DetectorId): DetectorRule {
    return settingsFor(projectId).rules[id];
  }

  /**
   * Every signal the project has, newest first.
   *
   * A rule that is off produces nothing new, so its signals stop arriving; the ones
   * already recorded stay, because turning a detector off is not a reason to lose the
   * evidence it gathered. The placeholder models that by dropping only the last day of a
   * disabled detector's signals, which is the shape somebody switching one off will see.
   */
  function signalsFor(projectId: string): SecuritySignal[] {
    const people = users
      .forProject(projectId)
      .filter((user) => user.deletedAt === null)
      .map((user) => user.id);
    const taken = decisions.value[projectId] ?? {};
    const rules = settingsFor(projectId).rules;

    return placeholderSignals(projectId, people)
      .filter((signal) => keepUnderRules(signal, rules))
      .map((signal) => {
        const decision = taken[signal.id];
        if (decision === undefined) return signal;
        return {
          ...signal,
          state: decision.state,
          decidedAt: decision.at,
          /* A reopened signal has no decision standing against it any more, so it names
             nobody: leaving the last operator on it reads as "they left it open". */
          decidedBy: decision.at === null ? null : OPERATOR,
          reason: decision.reason,
        };
      });
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: Partial<SecuritySettings>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    settings.value = {
      ...settings.value,
      [projectId]: { ...settingsFor(projectId), ...change },
    };
    stamp(projectId);
  }

  /** One detector's rule, merged into the record the rest of them share. */
  async function patchRule(
    projectId: string,
    id: DetectorId,
    change: Partial<DetectorRule>,
  ): Promise<void> {
    const rules = settingsFor(projectId).rules;
    await patch(projectId, { rules: { ...rules, [id]: { ...rules[id], ...change } } });
  }

  /**
   * Records what somebody decided about a signal. Dismissing takes a reason, because a
   * dismissal with none writes an audit entry saying a row was made to go away.
   */
  async function decide(
    projectId: string,
    signalId: string,
    state: SignalState,
    reason: DismissReason | null = null,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const held = decisions.value[projectId] ?? {};
    decisions.value = {
      ...decisions.value,
      [projectId]: {
        ...held,
        [signalId]: {
          state,
          reason: state === "dismissed" ? reason : null,
          at: state === "open" ? null : new Date().toISOString(),
        },
      },
    };
    stamp(projectId);
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  /** Refused sign-ins per day per reason, oldest day first. */
  function refusals(projectId: string): Record<RefusalReason, number[]> {
    const seed = seedOf(projectId);
    return {
      wrong_password: walk(seed + 1, WINDOW_DAYS, 220, 90),
      unknown_account: walk(seed + 2, WINDOW_DAYS, 74, 40),
      rate_limited: walk(seed + 3, WINDOW_DAYS, 38, 34),
      breached_password: walk(seed + 4, WINDOW_DAYS, 11, 9),
      factor_failed: walk(seed + 5, WINDOW_DAYS, 17, 12),
    };
  }

  function stats(projectId: string): SecurityStats {
    const signals = signalsFor(projectId);
    const open = signals.filter((signal) => signal.state === "open");
    const daily = refusals(projectId);
    const refusedDaily = sumSeries(Object.values(daily));
    const breachedDaily = daily.breached_password;

    return {
      open: open.length,
      urgent: open.filter((signal) => severityOf(signal.evidence) === "act").length,
      accountsFlagged: new Set(
        open.map((signal) => signal.userId).filter((id): id is string => id !== null),
      ).size,
      breachedRefused: sum(breachedDaily),
      breachedDaily,
      refused: sum(refusedDaily),
      refusedDaily,
    };
  }

  return {
    loading,
    settingsFor,
    ruleFor,
    signalsFor,
    patch,
    patchRule,
    decide,
    lastSavedAt,
    refusals,
    stats,
  };
});

interface Decision {
  state: SignalState;
  reason: DismissReason | null;
  at: string | null;
}

/**
 * A detector that is off keeps what it found and stops finding more. Modelled as the last
 * day going quiet, which is what somebody watching the screen after a switch will see.
 */
function keepUnderRules(signal: SecuritySignal, rules: Record<DetectorId, DetectorRule>): boolean {
  const kind = signal.evidence.kind;
  if (kind === "token_reuse" || kind === "sms_pumping") return true;
  if (rules[kind].enabled) return true;
  return Date.now() - new Date(signal.seenAt).getTime() > DURATIONS.DAY;
}

/*
 * The placeholder.
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

/** A stable number from a public id, so a project's signals hold still between visits. */
function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function sumSeries(series: readonly number[][]): number[] {
  return Array.from({ length: WINDOW_DAYS }, (_, day) =>
    series.reduce((total, values) => total + (values[day] ?? 0), 0),
  );
}

/** A daily count that wanders around a level rather than jumping about it. */
function walk(seed: number, days: number, base: number, swing: number): number[] {
  const random = seeded(seed);
  let level = base;
  return Array.from({ length: days }, () => {
    level += (random() - 0.5) * swing;
    level = Math.max(base * 0.25, Math.min(base * 2, level));
    return Math.round(level);
  });
}

/**
 * Hops a person could not have made, with the distance each one really is. Real pairs
 * rather than random numbers, because "Berlin to Sao Paulo in 38 minutes" is a sentence
 * somebody reads and checks, and one that came out at 400 km would read as a bug.
 */
interface Hop {
  from: string;
  to: string;
  km: number;
}

const HOPS: readonly [Hop, ...Hop[]] = [
  { from: "DE", to: "BR", km: 9800 },
  { from: "GB", to: "VN", km: 9300 },
  { from: "US", to: "NG", km: 8600 },
  { from: "FR", to: "IN", km: 6600 },
  { from: "NL", to: "RU", km: 2200 },
  { from: "ES", to: "TR", km: 2900 },
  { from: "JP", to: "PL", km: 8600 },
];

/** Somewhere an account plausibly signs in from for the first time. */
const COUNTRIES: readonly [string, ...string[]] = [
  "PT",
  "IT",
  "CA",
  "AU",
  "MX",
  "SE",
  "IE",
  "ZA",
  "TH",
  "AR",
];

/** Blocks the SMS guard has refused. A prefix, never a number: a signal is not a contact. */
const PREFIXES: readonly [string, ...string[]] = [
  "+880 17xx",
  "+62 81xx",
  "+234 80xx",
  "+998 9xx",
  "+92 30xx",
];

const CURRENCY = "USD";

/* A non-empty tuple, so the first entry is the fallback the compiler wants under
   noUncheckedIndexedAccess without an assertion standing in for it. */
function pick<T>(random: () => number, values: readonly [T, ...T[]]): T {
  return values[Math.floor(random() * values.length)] ?? values[0];
}

function address(random: () => number): string {
  const octet = () => 1 + Math.floor(random() * 254);
  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

/** An instant inside the retention window, weighted towards the recent days. */
function seenAt(random: () => number): string {
  const age = random() ** 1.6 * SPREAD_DAYS * DURATIONS.DAY;
  return new Date(Date.now() - age).toISOString();
}

/**
 * A project's signals.
 *
 * The mix is the shape a real project has rather than an even spread: first countries are
 * common and dull, breached passwords arrive at a steady trickle, travel is rarer, and
 * reuse is rare enough that a project may have none. A project with no users gets the two
 * kinds that do not name an account, because a list being tried against addresses that do
 * not exist is exactly what a new project sees first.
 */
function placeholderSignals(projectId: string, userIds: readonly string[]): SecuritySignal[] {
  const random = seeded(seedOf(projectId) ^ 0x5ec0);
  const signals: SecuritySignal[] = [];

  /* Null where the project has nobody yet, which is the state a new project is in and
     exactly when the two kinds that name no account are the only ones it can have. */
  const account = () => userIds[Math.floor(random() * userIds.length)] ?? null;

  const push = (userId: string | null, evidence: SignalEvidence) => {
    signals.push({
      id: `sig_${signals.length.toString(36).padStart(4, "0")}${seedOf(projectId).toString(36)}`,
      userId,
      seenAt: seenAt(random),
      state: "open",
      decidedAt: null,
      decidedBy: null,
      reason: null,
      evidence,
    });
  };

  /* Deliberately sparse. A detector that fires on a tenth of a project's accounts every
     month is one nobody reads, and a screen whose own copy says a quiet list is normal
     must not open on three hundred rows. */
  const scale = Math.max(1, Math.round(userIds.length / 60));

  for (let index = 0; index < 4 * scale; index += 1) {
    push(account(), {
      kind: "new_country",
      country: pick(random, COUNTRIES),
      countriesBefore: Math.floor(random() * 3),
    });
  }

  for (let index = 0; index < 3 * scale; index += 1) {
    push(account(), {
      kind: "breached_password",
      corpusCount: 1 + Math.floor(random() ** 3 * 240_000),
      at: random() < 0.5 ? "sign_up" : random() < 0.6 ? "reset" : "sign_in",
    });
  }

  for (let index = 0; index < 1 + scale; index += 1) {
    const hop = pick(random, HOPS);
    const minutes = 15 + Math.floor(random() * 90);
    push(account(), {
      kind: "impossible_travel",
      from: hop.from,
      to: hop.to,
      kilometres: hop.km,
      minutes,
      impliedKmh: Math.round(hop.km / (minutes / 60) / 10) * 10,
    });
  }

  for (let index = 0; index < 3; index += 1) {
    const accounts = 8 + Math.floor(random() ** 2 * 90);
    push(null, {
      kind: "credential_stuffing",
      ip: address(random),
      accountsTried: accounts,
      refusals: accounts + Math.floor(random() * accounts),
      minutes: 5 + Math.floor(random() * 55),
    });
  }

  if (random() < 0.85) {
    push(account(), { kind: "token_reuse", sessionsRevoked: 1 + Math.floor(random() * 5) });
  }

  if (random() < 0.8) {
    const sends = 60 + Math.floor(random() * 400);
    push(null, {
      kind: "sms_pumping",
      prefix: pick(random, PREFIXES),
      sends,
      verified: Math.floor(random() * 4),
      spendAvoided: Number((sends * 0.042).toFixed(2)),
      currency: CURRENCY,
    });
  }

  return signals.sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}
