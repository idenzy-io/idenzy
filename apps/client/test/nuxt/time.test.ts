import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatDate,
  formatDateTime,
  relativeTime,
  relativeTimeWords,
} from "../../app/utils/time";

const NOW = new Date("2026-09-09T12:00:00.000Z");

describe("relativeTime", () => {
  it("says just now under dayjs's first threshold, either way", () => {
    expect(relativeTime("2026-09-09T11:59:30.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-09T12:00:20.000Z", NOW)).toBe("now");
  });

  it("writes the largest unit dayjs picks, shortened", () => {
    expect(relativeTime("2026-09-09T11:56:00.000Z", NOW)).toBe("4m ago");
    expect(relativeTime("2026-09-09T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-09-07T12:00:00.000Z", NOW)).toBe("2d ago");
    expect(relativeTime("2026-08-19T12:00:00.000Z", NOW)).toBe("21d ago");
    expect(relativeTime("2026-06-01T12:00:00.000Z", NOW)).toBe("3mo ago");
    expect(relativeTime("2023-09-09T12:00:00.000Z", NOW)).toBe("3y ago");
  });

  it("writes a future span with 'in'", () => {
    expect(relativeTime("2026-09-16T12:00:00.000Z", NOW)).toBe("in 7d");
  });

  it("has a wordier voice for sentences", () => {
    expect(relativeTimeWords("2026-09-09T11:56:00.000Z", NOW)).toBe("4 minutes ago");
    expect(relativeTimeWords("2026-09-09T11:59:40.000Z", NOW)).toBe("a few seconds ago");
    expect(relativeTimeWords("2026-09-16T12:00:00.000Z", NOW)).toBe("in 7 days");
  });
});

describe("formatting", () => {
  it("writes a date and time in English on a 24-hour clock", () => {
    const written = formatDateTime("2026-09-09T14:03:00.000Z");
    expect(written).toMatch(/^Sep (8|9|10), 2026, \d{2}:\d{2}$/);
    expect(written).not.toContain("PM");
  });

  it("writes a date alone", () => {
    expect(formatDate("2026-09-09T14:03:00.000Z")).toMatch(/^Sep (8|9|10), 2026$/);
  });

  it("counts whole days", () => {
    expect(daysBetween(NOW, new Date("2026-09-16T11:00:00.000Z"))).toBe(6);
  });
});
