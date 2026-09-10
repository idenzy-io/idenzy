/**
 * The vocabulary a filtered list needs whatever it lists: a rolling window counted back
 * from now, a yes/no/any switch, and the escaping a CSV cell wants.
 *
 * Here rather than in `users.ts` because the sessions screen wants the same three, and a
 * second copy of a window's arithmetic is how two screens come to disagree about what
 * "last 7 days" means. Pure, so the rules are tested rather than trusted.
 */

import { DURATIONS } from "./time";

/** A rolling window, counted back from now. */
export type TimeWindow = "any" | "24h" | "7d" | "30d" | "90d";

export const WINDOW_LABELS: Record<TimeWindow, string> = {
  any: "Any time",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

const WINDOW_MS: Record<Exclude<TimeWindow, "any">, number> = {
  "24h": DURATIONS.DAY,
  "7d": DURATIONS.WEEK,
  "30d": 30 * DURATIONS.DAY,
  "90d": 90 * DURATIONS.DAY,
};

/** Whether an instant falls inside the window. Nothing never does; "any" always does. */
export function within(iso: string | null, window: TimeWindow, now: Date): boolean {
  if (window === "any") return true;
  if (iso === null) return false;
  return now.getTime() - new Date(iso).getTime() <= WINDOW_MS[window];
}

export type Tristate = "any" | "yes" | "no";

export function tristate(value: boolean, wanted: Tristate): boolean {
  return wanted === "any" || (wanted === "yes") === value;
}

/** Whether a set of wanted values keeps a row. An empty set keeps every row. */
export function anyOf<T>(wanted: readonly T[], value: T | null): boolean {
  if (wanted.length === 0) return true;
  return value !== null && wanted.includes(value);
}

/** A CSV cell, quoted only where a comma, a quote or a newline forces it. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
