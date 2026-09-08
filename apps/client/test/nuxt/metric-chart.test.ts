import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import { describe, expect, it } from "vitest";
import {
  alpha,
  buildMetricOption,
  colorOf,
  escapeHtml,
  type MetricChartInput,
  type MetricPalette,
  MONO,
  MUTED_ALPHA,
  renderTooltip,
} from "../../app/utils/metric-chart";

const palette: MetricPalette = {
  ink: "#212121",
  surface: "#ffffff",
  series: ["#2979ff", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"],
};

const input: MetricChartInput = {
  categories: ["Mon", "Tue", "Wed"],
  titles: ["Mon 1 Sep", "Tue 2 Sep", "Wed 3 Sep"],
  series: [
    { name: "Current period", data: [820, 932, 901] },
    { name: "Previous period", data: [780, null, 850], tone: "muted", dashed: true },
  ],
};

/* The option is a union of every component's shape; these narrow to the one the test
   is about, because a chart with no axis is not a chart these tests should pass on. */
function axes(option: ECOption) {
  const { xAxis, yAxis } = option;
  if (Array.isArray(xAxis) || Array.isArray(yAxis) || !xAxis || !yAxis)
    expect.unreachable("expected one axis each way");
  return { xAxis, yAxis };
}

function seriesOf(option: ECOption): (LineSeriesOption | BarSeriesOption)[] {
  if (!Array.isArray(option.series)) expect.unreachable("expected a series array");
  return option.series as (LineSeriesOption | BarSeriesOption)[];
}

function lineStyleOf(line: unknown) {
  const style = (line as { lineStyle?: { type?: unknown; color?: string } }).lineStyle;
  if (!style) expect.unreachable("expected a line style");
  return style;
}

describe("alpha", () => {
  it("writes a hex colour at an opacity, in every length hex comes in", () => {
    expect(alpha("#2979ff", 0.5)).toBe("rgba(41, 121, 255, 0.5)");
    expect(alpha("#fff", 0.1)).toBe("rgba(255, 255, 255, 0.1)");
    expect(alpha("#2979ff80", 0.2)).toBe("rgba(41, 121, 255, 0.2)");
  });

  it("replaces the opacity of a colour that already has one", () => {
    expect(alpha("rgba(41, 121, 255, 0.32)", 0.1)).toBe("rgba(41, 121, 255, 0.1)");
    expect(alpha("rgb(1,2,3)", 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("hands back what it cannot read rather than an invisible mark", () => {
    expect(alpha("hsl(210 100% 50%)", 0.5)).toBe("hsl(210 100% 50%)");
    expect(alpha("#12345", 0.5)).toBe("#12345");
  });
});

describe("colorOf", () => {
  it("assigns the palette in order, and by position rather than by what is visible", () => {
    const third = { name: "c", data: [] };
    expect(colorOf({ name: "a", data: [] }, 0, palette)).toBe("#2979ff");
    expect(colorOf(third, 2, palette)).toBe("#1baf7a");
  });

  it("takes a named slot over the position", () => {
    expect(colorOf({ name: "a", data: [], tone: 4 }, 0, palette)).toBe("#eda100");
  });

  it("draws the comparison grey as a tint of the ink", () => {
    expect(colorOf({ name: "a", data: [], tone: "muted" }, 0, palette)).toBe(
      `rgba(33, 33, 33, ${MUTED_ALPHA})`,
    );
  });
});

describe("buildMetricOption", () => {
  it("dashes the vertical gridlines, keeps the horizontal ones solid, and keeps both faint", () => {
    const { xAxis, yAxis } = axes(buildMetricOption(input, palette));
    const vertical = lineStyleOf(xAxis.splitLine);
    const horizontal = lineStyleOf(yAxis.splitLine);

    expect(vertical.type).toEqual([4, 4]);
    expect(horizontal.type).toBe("solid");
    for (const color of [vertical.color, horizontal.color]) {
      const opacity = Number(/([\d.]+)\)$/.exec(color ?? "")?.[1]);
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThanOrEqual(0.1);
    }
  });

  it("sets the axis labels in the mono face and writes the ticks compactly", () => {
    const { xAxis, yAxis } = axes(
      buildMetricOption({ ...input, format: { prefix: "$" } }, palette),
    );
    expect(xAxis.axisLabel?.fontFamily).toBe(MONO);
    expect(yAxis.axisLabel?.fontFamily).toBe(MONO);

    const formatter = yAxis.axisLabel?.formatter;
    if (typeof formatter !== "function") expect.unreachable("expected a tick formatter");
    const tick = formatter as (value: number) => string;
    expect(tick(4212)).toBe("$4.2k");
    expect(tick(0)).toBe("$0");
  });

  it("draws a line for the default, an area as a line with a wash, and a bar as a bar", () => {
    const [line, previous] = seriesOf(buildMetricOption(input, palette));
    expect(line?.type).toBe("line");
    expect(line).not.toHaveProperty("areaStyle");
    expect(lineStyleOf(previous).type).toEqual([4, 4]);

    const [area] = seriesOf(buildMetricOption({ ...input, type: "area" }, palette));
    expect(area?.type).toBe("line");
    expect(area).toHaveProperty("areaStyle");

    const [bar] = seriesOf(buildMetricOption({ ...input, type: "bar" }, palette));
    expect(bar?.type).toBe("bar");
    expect((bar as BarSeriesOption).barMaxWidth).toBe(24);
  });

  it("gives bars a slot to stand in and a line the axis's first tick", () => {
    expect(axes(buildMetricOption(input, palette)).xAxis.boundaryGap).toBe(false);
    expect(axes(buildMetricOption({ ...input, type: "bar" }, palette)).xAxis.boundaryGap).toBe(
      true,
    );
  });

  it("rounds only the top of a stack, and parts the segments with the surface", () => {
    const stacked = buildMetricOption(
      {
        categories: ["Mon"],
        type: "bar",
        series: [
          { name: "Password", data: [1], stack: "method" },
          { name: "Passkey", data: [1], stack: "method" },
          { name: "Alone", data: [1] },
        ],
      },
      palette,
    );
    const [bottom, top, alone] = seriesOf(stacked) as BarSeriesOption[];

    expect(bottom?.itemStyle?.borderRadius).toBe(0);
    expect(top?.itemStyle?.borderRadius).toEqual([4, 4, 0, 0]);
    expect(alone?.itemStyle?.borderRadius).toEqual([4, 4, 0, 0]);
    expect(bottom?.itemStyle?.borderColor).toBe("#ffffff");
    expect(bottom?.itemStyle?.borderWidth).toBe(1);
    expect(alone?.itemStyle?.borderWidth).toBe(0);
  });

  it("keeps a series' colour when the one before it is hidden", () => {
    const shown = seriesOf(buildMetricOption({ ...input, type: "bar" }, palette));
    const hidden = seriesOf(
      buildMetricOption({ ...input, type: "bar", hidden: ["Current period"] }, palette),
    );
    expect(hidden[1]?.color).toBe(shown[1]?.color);
  });

  it("switches a hidden series off through the legend rather than dropping it", () => {
    const option = buildMetricOption({ ...input, hidden: ["Previous period"] }, palette);
    const legend = Array.isArray(option.legend) ? option.legend[0] : option.legend;

    expect(legend?.show).toBe(false);
    expect(legend?.selected).toEqual({ "Current period": true, "Previous period": false });
    expect(seriesOf(option)).toHaveLength(2);
  });

  it("holds still under a reduced-motion preference", () => {
    expect(buildMetricOption(input, palette).animation).toBe(true);
    expect(buildMetricOption({ ...input, animate: false }, palette).animation).toBe(false);
  });

  it("lets the tooltip's markup carry the look and draws no box of its own", () => {
    const option = buildMetricOption(input, palette);
    const tooltip = Array.isArray(option.tooltip) ? option.tooltip[0] : option.tooltip;

    expect(tooltip?.trigger).toBe("axis");
    expect(tooltip?.backgroundColor).toBe("transparent");
    expect(tooltip?.borderWidth).toBe(0);
    expect(tooltip?.className).toBe("metric-tooltip");

    const formatter = tooltip?.formatter;
    if (typeof formatter !== "function") expect.unreachable("expected a tooltip formatter");
    const html = formatter([{ dataIndex: 1 }] as never, "", () => {});
    expect(html).toContain("Tue 2 Sep");
  });
});

describe("renderTooltip", () => {
  it("names the point, then every series in order with its value", () => {
    const html = renderTooltip(0, input, palette);
    const values = [...html.matchAll(/metric-tooltip__value">([^<]*)</g)].map((m) => m[1]);
    const names = [...html.matchAll(/metric-tooltip__name">([^<]*)</g)].map((m) => m[1]);

    expect(html).toContain('metric-tooltip__title">Mon 1 Sep<');
    expect(names).toEqual(["Current period", "Previous period"]);
    expect(values).toEqual(["820", "780"]);
  });

  it("lists a series whose value is missing, with a dash, and skips one that is hidden", () => {
    expect(renderTooltip(1, input, palette)).toContain('metric-tooltip__value">–<');
    expect(renderTooltip(1, { ...input, hidden: ["Previous period"] }, palette)).not.toContain(
      "Previous period",
    );
  });

  it("keys a line with a stroke, a dashed line with a dashed one, and a bar with a square", () => {
    const html = renderTooltip(0, input, palette);
    expect(html).toContain("metric-tooltip__key--line");
    expect(html).toContain("metric-tooltip__key--dashed");
    expect(renderTooltip(0, { ...input, type: "bar" }, palette)).toContain(
      "metric-tooltip__key--fill",
    );
  });

  it("writes values the way the card does, unit and all", () => {
    const html = renderTooltip(0, { ...input, format: { unit: "ms", decimals: 0 } }, palette);
    expect(html).toContain('metric-tooltip__value">820 ms<');
  });

  it("totals a stack, and only a stack", () => {
    const stacked: MetricChartInput = {
      categories: ["Mon"],
      type: "bar",
      series: [
        { name: "Password", data: [520], stack: "method" },
        { name: "Passkey", data: [310], stack: "method" },
        { name: "Target", data: [900] },
      ],
    };
    const html = renderTooltip(0, stacked, palette);
    expect(html).toContain("metric-tooltip__total");
    expect(html).toContain('metric-tooltip__value">830<');
    expect(renderTooltip(0, input, palette)).not.toContain("metric-tooltip__total");
  });

  it("falls back to the tick when a point has no longer name", () => {
    expect(renderTooltip(2, { ...input, titles: undefined }, palette)).toContain(
      'metric-tooltip__title">Wed<',
    );
  });

  it("treats a series name as text, never as markup", () => {
    const hostile: MetricChartInput = {
      categories: ["<b>x</b>"],
      series: [{ name: '<img src=x onerror="alert(1)">', data: [1] }],
    };
    const html = renderTooltip(0, hostile, palette);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("escapeHtml", () => {
  it("neutralises the five characters that open markup", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});
