const DAY_MS = 24 * 60 * 60 * 1000;

/** The first day of the month `at` falls in, `YYYY-MM-DD` in UTC. */
export function monthStart(at: Date): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/**
 * How long into a month the previous one is still repriced.
 *
 * A meter holds active users in memory and flushes on an interval, and the period closer waits
 * six hours past the month end for exactly that reason. Until this existed the drawdown only ever
 * priced the current month, so whatever was flushed after its last pass before midnight on the
 * 1st was never charged at all. Three days covers the closer's grace with a wide margin: once a
 * month is closed its days carry the frozen `mau_to_date`, which is what repricing then reads,
 * and the watermark makes every repricing after the final one charge nothing.
 */
const PREVIOUS_MONTH_GRACE_MS = 3 * DAY_MS;

/** The periods still being billed at `now`, oldest first: last month during the grace, then this one. */
export function openPeriods(now: Date): readonly string[] {
  const current = monthStart(now);
  const start = new Date(`${current}T00:00:00.000Z`);
  if (now.getTime() - start.getTime() >= PREVIOUS_MONTH_GRACE_MS) return [current];
  const previous = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  return [previous.toISOString().slice(0, 10), current];
}

/** The last day of the month beginning at `period`. */
export function monthEnd(period: string): string {
  const start = new Date(`${period}T00:00:00.000Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}
