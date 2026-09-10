import { describe, expect, it } from "vitest";
import { buildOverviewPreview } from "../../app/utils/overview";

const NOW = new Date("2026-09-09T12:30:00.000Z");

describe("Overview analytics preview", () => {
  it("keeps the same fixture stable and isolates project data", () => {
    const personal = buildOverviewPreview("prj_personal", "7d", NOW);
    expect(buildOverviewPreview("prj_personal", "7d", NOW)).toEqual(personal);
    expect(buildOverviewPreview("prj_acme", "7d", NOW).signIns).not.toBe(personal.signIns);
  });

  it.each(["1d", "7d", "14d"] as const)("reconciles the %s chart and its totals", (range) => {
    const preview = buildOverviewPreview("prj_acme", range, NOW);
    expect(preview.successful.reduce((total, value) => total + value, 0)).toBe(preview.signIns);
    expect(preview.failed.reduce((total, value) => total + value, 0)).toBe(preview.failures);
    expect(preview.categories).toHaveLength(range === "1d" ? 24 : range === "7d" ? 7 : 14);
    expect(preview.successful).toHaveLength(preview.categories.length);
    expect(preview.titles.every((title) => title.endsWith("UTC"))).toBe(true);
  });

  it("preserves overlapping days across ranges", () => {
    const week = buildOverviewPreview("prj_acme", "7d", NOW);
    const fortnight = buildOverviewPreview("prj_acme", "14d", NOW);
    expect(fortnight.successful.slice(-7)).toEqual(week.successful);
    expect(fortnight.signIns).toBeGreaterThan(week.signIns);
  });

  it("does not generate future hours for today's partial daily bucket", () => {
    const midnight = new Date("2026-09-09T00:00:00.000Z");
    const hourly = buildOverviewPreview("prj_acme", "1d", midnight);
    const daily = buildOverviewPreview("prj_acme", "7d", midnight);
    expect(daily.successful.at(-1)).toBe(hourly.successful.at(-1));
  });

  /*
   * The reason the weights exist. A flat series is what the previous fixture drew, and a
   * chart with no shape in it reads as a chart that is broken rather than as quiet
   * traffic, which is the one thing a placeholder must not do.
   */
  it("draws a series with a working-week shape rather than a flat line", () => {
    const week = buildOverviewPreview("prj_acme", "14d", NOW);
    const busiest = Math.max(...week.successful);
    const quietest = Math.min(...week.successful);
    expect(busiest).toBeGreaterThan(quietest * 1.4);
  });
});
