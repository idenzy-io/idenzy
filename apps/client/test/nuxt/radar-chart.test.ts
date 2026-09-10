import type { RadarSeriesOption } from "echarts/charts";
import { describe, expect, it } from "vitest";
import type { MetricPalette } from "../../app/utils/metric-chart";
import {
  buildRadarOption,
  clockwise,
  type RadarChartInput,
  renderRadarTooltip,
} from "../../app/utils/radar-chart";

const palette: MetricPalette = {
  ink: "#212121",
  surface: "#ffffff",
  series: ["#2979ff", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"],
};

const input: RadarChartInput = {
  axes: ["Windows", "Android", "iOS", "ChromeOS"],
  series: [
    { name: "Live sessions", data: [40, 12, 60, 0] },
    { name: "A month ago", data: [30, 9, 55, 2], tone: "muted" },
  ],
};

/* The radar is one series holding one entry per shape, which is the shape of the option
   these tests narrow to. */
function shapesOf(option: ECOption) {
  const series = option.series as RadarSeriesOption | undefined;
  const data = series?.data;
  if (!Array.isArray(data)) expect.unreachable("expected a radar series with shapes");
  return data as { name: string; value: number[]; lineStyle?: { color?: string } }[];
}

function radarOf(option: ECOption) {
  const { radar } = option;
  if (Array.isArray(radar) || !radar) expect.unreachable("expected one radar");
  return radar;
}

describe("clockwise", () => {
  it("keeps the first axis at the top and reverses the rest", () => {
    expect(clockwise(["Mon", "Tue", "Wed", "Thu"])).toEqual(["Mon", "Thu", "Wed", "Tue"]);
  });

  it("survives a list of one and a list of none", () => {
    expect(clockwise(["Mon"])).toEqual(["Mon"]);
    expect(clockwise([])).toEqual([]);
  });

  it("is its own inverse, so a value cannot drift from its axis", () => {
    const axes = ["a", "b", "c", "d", "e"];
    expect(clockwise(clockwise(axes))).toEqual(axes);
  });
});

describe("The radar option", () => {
  it("draws axes and values through the same rotation", () => {
    const option = buildRadarOption(input, palette);
    const names = radarOf(option).indicator?.map((entry) => entry.name);

    expect(names).toEqual(["Windows", "ChromeOS", "iOS", "Android"]);
    // iOS is third in the input and second on the dial; its 60 has to move with it.
    expect(shapesOf(option)[0]?.value).toEqual([40, 0, 60, 12]);
  });

  /*
   * The reason a radar has one scale. Axes each running to their own maximum draw a
   * regular polygon whatever the numbers are, which is the one thing the shape exists
   * to say.
   */
  it("gives every spoke the same maximum, taken from every series", () => {
    const maxima = radarOf(buildRadarOption(input, palette)).indicator?.map((e) => e.max);
    expect(new Set(maxima).size).toBe(1);
    expect(maxima?.[0]).toBeGreaterThanOrEqual(60);
  });

  it("holds the maximum still when a series is switched off", () => {
    const all = radarOf(buildRadarOption(input, palette)).indicator?.[0]?.max;
    const one = radarOf(buildRadarOption({ ...input, hidden: ["A month ago"] }, palette))
      .indicator?.[0]?.max;
    expect(one).toBe(all);
  });

  /* Colour follows the metric and never its rank: hiding the first shape must not
     repaint the second. */
  it("keeps a shape's colour when the one before it is hidden", () => {
    const second = shapesOf(buildRadarOption(input, palette))[1]?.lineStyle?.color;
    const alone = shapesOf(buildRadarOption({ ...input, hidden: ["Live sessions"] }, palette))[0]
      ?.lineStyle?.color;
    expect(alone).toBe(second);
  });

  /*
   * The panel's gridline rule, carried over by meaning. A ring is read against, so it is
   * solid; a spoke only marks where an axis is, so it is dashed. Neither above a tenth of
   * the ink, the bound the metric chart's own gridline test keeps. This is the sort of
   * thing a well-meant refactor evens out.
   */
  it("draws solid rings and dashed spokes, both faint", () => {
    const radar = radarOf(buildRadarOption(input, palette));
    const ring = radar.splitLine?.lineStyle;
    const spoke = radar.axisLine?.lineStyle;

    expect(ring?.type).toBeUndefined();
    expect(spoke?.type).toEqual([4, 4]);
    for (const line of [ring, spoke]) {
      const opacity = Number(/,\s*([\d.]+)\)$/.exec(String(line?.color))?.[1]);
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(0.1);
    }
  });

  /*
   * A mark over the name and never instead of it, so two Apple platforms wearing one
   * Apple are still told apart, and a reader who does not read logos is never guessing.
   */
  it("puts a mark over an axis's name and leaves an unmarked axis its name alone", () => {
    const option = buildRadarOption(
      { ...input, marks: { Windows: "data:image/svg+xml,x" } },
      palette,
    );
    const label = option.radar as { axisName?: { formatter?: (name?: string) => string } };
    const format = label.axisName?.formatter;

    expect(format?.("Windows")).toBe("{m0|}\n{n|Windows}");
    expect(format?.("Android")).toBe("Android");
    expect(format?.(undefined)).toBe("");
  });

  it("keys a mark by its axis's index, because an axis name is free text", () => {
    const option = buildRadarOption({ ...input, marks: { iOS: "data:image/svg+xml,x" } }, palette);
    const rich = (option.radar as { axisName?: { rich?: Record<string, unknown> } }).axisName?.rich;
    // iOS is third in the input, so its style is m2 whatever the dial does with it.
    expect(Object.keys(rich ?? {})).toEqual(["n", "m2"]);
  });

  it("draws no split areas and no legend of its own", () => {
    const option = buildRadarOption(input, palette);
    expect(radarOf(option).splitArea?.show).toBe(false);
    expect((option.legend as { show?: boolean } | undefined)?.show).toBe(false);
  });

  /* A radar has no gaps: a missing value is nothing happening, and leaving it null
     breaks the outline into pieces that read as a drawing error. */
  it("reads a missing value as zero rather than a break", () => {
    const option = buildRadarOption(
      { axes: ["a", "b"], series: [{ name: "One", data: [5, null] }] },
      palette,
    );
    expect(shapesOf(option)[0]?.value).toEqual([5, 0]);
  });
});

describe("The radar tooltip", () => {
  it("lists every axis in reading order, zero included", () => {
    const html = renderRadarTooltip(0, input, palette);
    expect(html.indexOf("Windows")).toBeLessThan(html.indexOf("ChromeOS"));
    expect(html).toContain("Live sessions");
    expect(html).toContain(">0<");
  });

  it("escapes a name, which is text from outside", () => {
    const html = renderRadarTooltip(
      0,
      { axes: ["<img src=x>"], series: [{ name: "Live sessions", data: [1] }] },
      palette,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
