/**
 * Recovery codes as the server issues and spends them, and the small amount of arithmetic
 * the screen does over them.
 *
 * A set is ten single-use codes, issued when the account confirms its first second factor
 * and deleted when the last one is removed (`apps/api/src/mfa`). Almost nothing here
 * is configurable, and that is the point: the length is what makes a SHA-256 digest
 * defensible, the count is what makes losing a few survivable, and both are decisions the
 * server has already taken. The screen states them rather than offering them, in the same
 * way the passkey ceremony is stated on its own screen.
 *
 * The words matter here more than usual. A customer reads "recovery codes"; a "sheet" is
 * our word for the ten of them together and it made a support screen read like a
 * printing-press manual, so the noun is a *set* and every label says codes
 * (`notes/mfa-recovery.md` P2). The state a reader acts on is written out in full, never
 * carried by a colour: "No codes remaining" and "Never generated" are different answers
 * that both read as zero to the server.
 *
 * What the panel does decide is one line: at how few codes an account is flagged as
 * running low. That is a threshold for this dashboard and the security centre, never a
 * rule the server reads, and the row that sets it says so.
 *
 * What is shared with the authenticator screen is read from `utils/mfa.ts` rather than
 * written again here: the count of codes, the attempt cap and the challenge's lifetime
 * are one fact each.
 */

import { FACTOR_ROLES, type FactorRole, type MfaFactorKind, TOTP } from "./mfa";
import { plural } from "./setup-check";

/** How a set is made, from `@idenzy/crypto/mfa/recovery-codes`. */
export const CODE_SET = {
  /** `RECOVERY_CODE_COUNT`. Enough to lose a few and still have a way in. */
  codes: TOTP.recoveryCodes,
  groups: 4,
  groupLength: 5,
  /** 20 symbols over a 32-symbol alphabet, exactly. */
  bits: 100,
  digest: "SHA-256",
  /** Crockford's base32, which drops the four letters that get misread. */
  alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  dropped: "I, L, O and U",
} as const;

/** The shape of a code, for the row that shows one without showing anybody's. */
export const SAMPLE_RECOVERY_CODE = "K4M7Q-3XR9T-BW2HN-5PJ0V";

/** The routes a customer's own screens call. Named here so the screen and the docs agree. */
export const ROUTES = {
  confirm: "POST v1/auth/mfa/totp/confirm",
  regenerate: "POST v1/auth/mfa/recovery-codes",
  factors: "GET v1/auth/mfa/factors",
} as const;

/** The SDK call an owner's own screen makes to replace a set. */
export const REGENERATE_CALL = "mfa.regenerateRecoveryCodes()";

/**
 * What a set is a fallback from. A set exists only because one of these was enrolled, and
 * both are named in the factor family the authenticator screen draws from.
 */
export type FallbackFactor = Extract<MfaFactorKind, "totp" | "passkey">;

/** The family's entry for a factor, so a row's label and glyph come from one place. */
export function roleOf(kind: MfaFactorKind): FactorRole | null {
  return FACTOR_ROLES.find((role) => role.kind === kind) ?? null;
}

/**
 * The factor's name as a table cell can carry it. The family's own labels are written for
 * a settings row ("Authenticator app"), and two of those joined do not fit a column.
 */
const FACTOR_WORDS: Record<FallbackFactor, string> = {
  totp: "Authenticator",
  passkey: "passkey",
};

/** Stable, so two accounts holding the same pair read identically. */
const FACTOR_ORDER: readonly FallbackFactor[] = ["totp", "passkey"];

/**
 * "Authenticator + passkey": what the account can be challenged with, and therefore what
 * it can still sign in with while its codes are gone.
 */
export function factorLabel(set: RecoverySet): string {
  const held = FACTOR_ORDER.filter((factor) => set.factors.includes(factor));
  if (held.length === 0) return "None";
  const words = held.map((factor) => FACTOR_WORDS[factor]);
  const first = words[0] ?? "";
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(" + ");
}

/**
 * One account's recovery codes as the panel sees them.
 *
 * `remaining` is the only number the server publishes about a set: `countUnused` on the
 * recovery repository, which is what `recoveryCodesRemaining` in the factor list is. A set
 * nobody holds and a set spent to the last code both read as zero here, because they read
 * the same way to the server too.
 */
export interface RecoverySet {
  /** The public user id, as every API surface names a user. */
  userId: string;
  /** Null when the account holds no codes at all: never generated, or cleared. */
  issuedAt: string | null;
  remaining: number;
  /** When a code was last spent to get back in. */
  lastUsedAt: string | null;
  /** The second factors on the account, in the order the challenge would offer them. */
  factors: readonly FallbackFactor[];
}

export type RecoveryState = "healthy" | "low" | "none";

/** The state written out, because a colour is not a state and this one has to be read. */
export const STATE_LABELS: Record<RecoveryState, string> = {
  healthy: "Healthy",
  low: "Running low",
  none: "No codes left",
};

/**
 * What the state is worth saying in colour: green while there are codes to fall back on,
 * amber as they run down, red once there is nothing left. The pips and the word beside them
 * read it from here, so a bar and its label cannot disagree.
 */
export const STATE_FILL: Record<RecoveryState, string> = {
  healthy: "bg-success",
  low: "bg-warning",
  none: "bg-error",
};

export const STATE_TEXT: Record<RecoveryState, string> = {
  healthy: "text-success",
  low: "text-warning",
  none: "text-error",
};

/** At how few codes this dashboard flags an account. Never read by the server. */
export const LOW_THRESHOLD_MIN = 1;
export const LOW_THRESHOLD_MAX = 9;
export const DEFAULT_LOW_THRESHOLD = 3;

export interface RecoverySettings {
  lowThreshold: number;
}

export const DEFAULT_RECOVERY_SETTINGS: RecoverySettings = {
  lowThreshold: DEFAULT_LOW_THRESHOLD,
};

export const THRESHOLD_ISSUE = {
  range: `Between ${LOW_THRESHOLD_MIN} and ${LOW_THRESHOLD_MAX} codes.`,
  integer: "A whole number of codes.",
} as const;

export function stateOf(set: RecoverySet, lowThreshold: number): RecoveryState {
  if (set.remaining === 0) return "none";
  return set.remaining <= lowThreshold ? "low" : "healthy";
}

/** An account with a second factor and nothing to fall back on. The list's whole reason. */
export function isAtRisk(set: RecoverySet): boolean {
  return set.remaining === 0;
}

/**
 * How many codes are left, in words.
 *
 * Three answers and not two: a set nobody ever generated is not a set spent to its last
 * code, and "0 of 10" would claim ten codes that do not exist. The server cannot tell them
 * apart, the panel can, and the reader is the one who has to.
 */
export function remainingLabel(set: RecoverySet): string {
  if (set.issuedAt === null) return "Never generated";
  if (set.remaining === 0) return "No codes remaining";
  return `${set.remaining} of ${CODE_SET.codes}`;
}

/**
 * The safe next step for one account, which is the whole point of the queue.
 *
 * Nothing an operator can do restores a way back in: the codes are returned once and only
 * digests are kept. What resolves this is the owner making a new set from inside a session,
 * so the sentence names the factor they still hold and what it lets them do.
 */
export function nextStepFor(set: RecoverySet): string {
  const factors = factorLabel(set).toLowerCase();
  if (set.remaining === 0) {
    return `They can still sign in with their ${factors}, so they can make a new set themselves today. If that goes before they do, nothing here can let them back in.`;
  }
  if (set.remaining <= LOW_THRESHOLD_MAX) {
    return `They still have codes, so there is no hurry: a new set replaces whatever is left of this one, and their ${factors} keeps working either way.`;
  }
  return `Nothing to do. Their ${factors} answers a challenge and the codes are the fallback if it goes.`;
}

/**
 * What to tell the owner, in the order they do it. Plain text on purpose: an operator
 * pastes this into a ticket or an email, so it carries no markup and names the call a
 * customer's own screen makes rather than a screen of ours, because there is none.
 */
export const REPLACEMENT_STEPS: readonly string[] = [
  "Sign in as usual, answering the challenge with the second factor you still have.",
  `Open the recovery-codes screen in your application, which calls ${REGENERATE_CALL}.`,
  "Save or print the new codes there and then. They are shown once, and every earlier code stops working the moment they appear.",
];

/** The same steps as one block of text, for the clipboard. */
export function replacementText(): string {
  return REPLACEMENT_STEPS.map((step, index) => `${index + 1}. ${step}`).join("\n");
}

export type RecoveryFilter = "risk" | "low" | "all";

export function matchesFilter(
  set: RecoverySet,
  filter: RecoveryFilter,
  lowThreshold: number,
): boolean {
  if (filter === "all") return true;
  const state = stateOf(set, lowThreshold);
  return filter === "risk" ? state === "none" : state === "low";
}

export interface RecoveryCounts {
  all: number;
  risk: number;
  low: number;
}

export function countByState(sets: readonly RecoverySet[], lowThreshold: number): RecoveryCounts {
  let risk = 0;
  let low = 0;
  for (const set of sets) {
    const state = stateOf(set, lowThreshold);
    if (state === "none") risk += 1;
    else if (state === "low") low += 1;
  }
  return { all: sets.length, risk, low };
}

/**
 * The finding, for the heading over the list.
 *
 * A section heading that says "Recovery codes" a second time tells a reader nothing they
 * did not get from the title. What they came for is whether anybody is stuck, so the
 * heading answers that and the segments below it carry the counts.
 */
export function queueHeading(counts: RecoveryCounts): string {
  if (counts.all === 0) return "No account here holds a second factor yet";
  if (counts.risk > 0) {
    return `${plural(counts.risk, "account has", "accounts have")} no codes left`;
  }
  if (counts.low > 0) {
    return `${plural(counts.low, "account is", "accounts are")} running low`;
  }
  return "Every account has codes to fall back on";
}

/**
 * How the project's sets are spread, for the strip under the list.
 *
 * Buckets rather than a count per number, because ten figures is a table and the question
 * this answers is "how much of the project is near the edge".
 */
export interface RemainingBucket {
  id: string;
  label: string;
  /** Inclusive, over the codes left. */
  from: number;
  to: number;
  /** A text colour class for the count, where the bucket is one to act on. */
  tone: string;
}

const EMPTY_BUCKET: RemainingBucket = {
  id: "none",
  label: "None left",
  from: 0,
  to: 0,
  tone: "text-error",
};

export const BUCKETS: readonly RemainingBucket[] = [
  { id: "full", label: "Untouched", from: 10, to: 10, tone: "" },
  { id: "most", label: "7 to 9 left", from: 7, to: 9, tone: "" },
  { id: "half", label: "4 to 6 left", from: 4, to: 6, tone: "" },
  { id: "few", label: "1 to 3 left", from: 1, to: 3, tone: "text-warning" },
  EMPTY_BUCKET,
];

export function bucketOf(remaining: number): RemainingBucket {
  // Every count from 0 to 10 falls in a bucket above. A number outside that range is one
  // the server could not have produced, and it reads as the emptiest rather than as none.
  return (
    BUCKETS.find((bucket) => remaining >= bucket.from && remaining <= bucket.to) ?? EMPTY_BUCKET
  );
}

export interface BucketTally extends RemainingBucket {
  count: number;
  /** Of the sets counted, rounded. */
  share: number;
}

export function tallyBuckets(sets: readonly RecoverySet[]): BucketTally[] {
  const counts = new Map<string, number>();
  for (const set of sets) {
    const bucket = bucketOf(set.remaining);
    counts.set(bucket.id, (counts.get(bucket.id) ?? 0) + 1);
  }
  const total = sets.length;
  return BUCKETS.map((bucket) => {
    const count = counts.get(bucket.id) ?? 0;
    return { ...bucket, count, share: total === 0 ? 0 : Math.round((count / total) * 100) };
  });
}
