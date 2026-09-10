export type OverviewRange = "1d" | "7d" | "14d";

const HOUR = 3_600_000;
const DAY = HOUR * 24;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const hourFormat = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * A value in [0, 1) for an integer. Not a hash worth the name: it only has to differ
 * between neighbours and hold still between reloads, because a placeholder chart that
 * redrew itself differently on every visit would read as live data.
 */
function noise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The shape of a day, by UTC hour: quiet overnight, a climb through the morning, a
 * plateau over the working day and an evening tail. It peaks at 15:00 UTC, where a
 * European afternoon overlaps an American morning.
 */
function hourWeight(hour: number): number {
  return 0.22 + 0.78 * Math.max(0, Math.sin(((hour - 3) / 24) * Math.PI)) ** 1.4;
}

/**
 * A day's own weight. The working week is most of what a sign-in chart is a picture of,
 * so a weekend is a little over half a weekday, and the drift keeps two weekdays from
 * drawing the same column twice.
 */
function dayWeight(timestamp: number, seed: number): number {
  const weekday = new Date(timestamp).getUTCDay();
  const rest = weekday === 0 || weekday === 6 ? 0.58 : 1;
  return rest * (0.85 + noise(Math.floor(timestamp / DAY) + seed) * 0.3);
}

/**
 * The overview's placeholder traffic, until the management API answers with real
 * figures. Seeded from the project id so a project's chart holds still between visits
 * and two projects do not draw the same picture.
 *
 * The successes and the failures are returned as bare arrays rather than as a chart's
 * series, because what the overview plots is this period against the one before it, and
 * that pairing is the page's decision rather than this file's.
 */
export function buildOverviewPreview(projectId: string, range: OverviewRange, now: Date) {
  const seed = [...projectId].reduce((total, character) => total + character.charCodeAt(0), 0);
  const hourly = range === "1d";
  const count = hourly ? 24 : range === "14d" ? 14 : 7;
  const interval = hourly ? HOUR : DAY;
  const end = Math.floor(now.getTime() / interval) * interval;
  const timestamps = Array.from(
    { length: count },
    (_, index) => end - (count - 1 - index) * interval,
  );
  const points = timestamps.map((timestamp) => {
    /* A daily bucket is its own hours added up, and the bucket the clock is standing in
       has only the hours that have happened. Which is what makes today partial. */
    const hours = hourly
      ? [timestamp]
      : Array.from({ length: 24 }, (_, hour) => timestamp + hour * HOUR).filter(
          (at) => at <= now.getTime(),
        );
    const traffic = hours.map((at) => {
      const index = Math.floor(at / HOUR);
      const base = 34 + (seed % 46);
      const success = Math.max(1, Math.round(base * hourWeight(index % 24) * dayWeight(at, seed)));
      /* Failures follow the volume rather than a flat rate, and spike now and again: a
         bad hour is a bad hour for everybody, and a perfectly even failure line is the
         one thing real traffic never draws. */
      const spike = noise(index + seed * 7) > 0.94 ? 4 : 1;
      const failed = Math.round(success * (0.04 + noise(index + seed) * 0.05) * spike);
      return {
        success,
        failed,
        signUps: Math.round(success * (0.05 + noise(index + seed * 3) * 0.05)),
      };
    });
    return {
      success: sum(traffic.map((point) => point.success)),
      failed: sum(traffic.map((point) => point.failed)),
      signUps: sum(traffic.map((point) => point.signUps)),
    };
  });

  const successful = points.map((point) => point.success);
  const failed = points.map((point) => point.failed);

  return {
    categories: timestamps.map((timestamp) => (hourly ? hourFormat : dateFormat).format(timestamp)),
    titles: timestamps.map(
      (timestamp) =>
        `${dateFormat.format(timestamp)}${hourly ? `, ${hourFormat.format(timestamp)}` : ""} UTC`,
    ),
    successful,
    failed,
    signIns: sum(successful),
    failures: sum(failed),
    signUps: sum(points.map((point) => point.signUps)),
    dateLabel: `${dateFormat.format(timestamps[0] ?? end)} – ${dateFormat.format(now)} · UTC`,
  };
}
