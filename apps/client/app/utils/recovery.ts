/**
 * Recovery codes as the server issues and spends them, and the small amount of arithmetic
 * the screen does over them.
 *
 * A sheet is ten single-use codes, issued when the account confirms its first second
 * factor and deleted when the last one is removed (`apps/auth-api/src/mfa`). Almost
 * nothing here is configurable, and that is the point: the length is what makes a
 * SHA-256 digest defensible, the count is what makes losing a few survivable, and both
 * are decisions the server has already taken. The screen states them rather than
 * offering them, in the same way the passkey ceremony is stated on its own screen.
 *
 * What the panel does decide is one line: at how few codes a sheet counts as low. That is
 * a threshold for this dashboard and the security centre, never a rule the server reads,
 * and the row that sets it says so.
 *
 * What is shared with the authenticator screen is read from `utils/mfa.ts` rather than
 * written again here: the count of codes, the attempt cap and the challenge's lifetime
 * are one fact each, and two files stating them is two files that can disagree.
 */

import { FACTOR_ROLES, type FactorRole, type MfaFactorKind, TOTP } from "./mfa";

/** How a sheet is made, from `@idenzy/crypto/mfa/recovery-codes`. */
export const SHEET = {
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

/**
 * What a sheet is a fallback from. A sheet exists only because one of these was enrolled,
 * and both are named in the factor family the authenticator screen draws from.
 */
export type FallbackFactor = Extract<MfaFactorKind, "totp" | "passkey">;

/** The family's entry for a factor, so a row's label and glyph come from one place. */
export function roleOf(kind: MfaFactorKind): FactorRole | null {
  return FACTOR_ROLES.find((role) => role.kind === kind) ?? null;
}

/**
 * One account's sheet as the panel sees it.
 *
 * `remaining` is the only number the server publishes about a sheet: `countUnused` on
 * the recovery repository, which is what `recoveryCodesRemaining` in the factor list is.
 * A sheet nobody holds and a sheet spent to the last code both read as zero here,
 * because they read the same way to the server too.
 */
export interface RecoverySheet {
  /** The public user id, as every API surface names a user. */
  userId: string;
  /** Null when the account holds no sheet at all: never issued, or cleared. */
  issuedAt: string | null;
  remaining: number;
  /** When a code was last spent to get back in. */
  lastUsedAt: string | null;
  /** The second factors on the account, in the order the challenge would offer them. */
  factors: readonly FallbackFactor[];
}

export type SheetState = "healthy" | "low" | "none";

export const STATE_LABELS: Record<SheetState, string> = {
  healthy: "Healthy",
  low: "Low",
  none: "None left",
};

/**
 * What the state is worth saying in colour: green while there is a sheet to fall back on,
 * amber as it runs down, red once there is nothing left. The pips and the word beside them
 * read it from here, so a bar and its label cannot disagree.
 */
export const STATE_FILL: Record<SheetState, string> = {
  healthy: "bg-success",
  low: "bg-warning",
  none: "bg-error",
};

export const STATE_TEXT: Record<SheetState, string> = {
  healthy: "text-success",
  low: "text-warning",
  none: "text-error",
};

/** At how few codes this dashboard calls a sheet low. Never read by the server. */
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

export function stateOf(sheet: RecoverySheet, lowThreshold: number): SheetState {
  if (sheet.remaining === 0) return "none";
  return sheet.remaining <= lowThreshold ? "low" : "healthy";
}

/** An account with a second factor and nothing to fall back on. The list's whole reason. */
export function isAtRisk(sheet: RecoverySheet): boolean {
  return sheet.remaining === 0;
}

export type SheetFilter = "risk" | "low" | "all";

export function matchesFilter(
  sheet: RecoverySheet,
  filter: SheetFilter,
  lowThreshold: number,
): boolean {
  if (filter === "all") return true;
  const state = stateOf(sheet, lowThreshold);
  return filter === "risk" ? state === "none" : state === "low";
}

export interface SheetCounts {
  all: number;
  risk: number;
  low: number;
}

export function countByState(sheets: readonly RecoverySheet[], lowThreshold: number): SheetCounts {
  let risk = 0;
  let low = 0;
  for (const sheet of sheets) {
    const state = stateOf(sheet, lowThreshold);
    if (state === "none") risk += 1;
    else if (state === "low") low += 1;
  }
  return { all: sheets.length, risk, low };
}

/**
 * How the project's sheets are spread, for the panel beside the list.
 *
 * Buckets rather than a count per number, because ten bars of one figure each is a table
 * and the question this answers is "how much of the project is near the edge".
 */
export interface SheetBucket {
  id: string;
  label: string;
  /** Inclusive, over the codes left. */
  from: number;
  to: number;
  /** A text colour class for the count, where the bucket is one to act on. */
  tone: string;
}

const EMPTY_BUCKET: SheetBucket = {
  id: "none",
  label: "None left",
  from: 0,
  to: 0,
  tone: "text-error",
};

export const BUCKETS: readonly SheetBucket[] = [
  { id: "full", label: "Untouched", from: 10, to: 10, tone: "" },
  { id: "most", label: "7 to 9 left", from: 7, to: 9, tone: "" },
  { id: "half", label: "4 to 6 left", from: 4, to: 6, tone: "" },
  { id: "few", label: "1 to 3 left", from: 1, to: 3, tone: "text-warning" },
  EMPTY_BUCKET,
];

export function bucketOf(remaining: number): SheetBucket {
  // Every count from 0 to 10 falls in a bucket above. A number outside that range is one
  // the server could not have produced, and it reads as the emptiest rather than as none.
  return (
    BUCKETS.find((bucket) => remaining >= bucket.from && remaining <= bucket.to) ?? EMPTY_BUCKET
  );
}

export interface BucketTally extends SheetBucket {
  count: number;
  /** Of the sheets counted, rounded, for the bar. */
  share: number;
}

export function tallyBuckets(sheets: readonly RecoverySheet[]): BucketTally[] {
  const counts = new Map<string, number>();
  for (const sheet of sheets) {
    const bucket = bucketOf(sheet.remaining);
    counts.set(bucket.id, (counts.get(bucket.id) ?? 0) + 1);
  }
  const total = sheets.length;
  return BUCKETS.map((bucket) => {
    const count = counts.get(bucket.id) ?? 0;
    return { ...bucket, count, share: total === 0 ? 0 : Math.round((count / total) * 100) };
  });
}
