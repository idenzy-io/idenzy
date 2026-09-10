/**
 * The ECharts option for a radar, built the way the metric chart's is: pure, outside the
 * component, and handed the theme's colours rather than left to read a stylesheet.
 *
 * A separate builder rather than a branch inside `buildMetricOption`, because a radar
 * answers a different question. A line says how a figure moved along an axis; a radar
 * says what shape a set of comparable figures makes, and whether that shape has changed.
 * Nothing about a category axis, a stack or a boundary gap means anything here.
 *
 * What does carry over is the panel's gridline rule, and it carries over by meaning
 * rather than by name: the rings a value is read against are solid, like the metric
 * chart's horizontal lines, and the spokes that only mark where an axis is are dashed,
 * like its vertical ones. Both under a tenth of the ink.
 */
import type { RadarSeriesOption } from "echarts/charts";
import { type WrittenFigureOptions, writeFigure } from "./format";
import {
  alpha,
  colorOf,
  escapeHtml,
  type MetricPalette,
  type MetricSeries,
  MONO,
  SANS,
  TOOLTIP_CLASS,
} from "./metric-chart";

export interface RadarChartInput {
  /** One name per spoke, clockwise from the top. */
  axes: readonly string[];
  /** One shape each, its values in the axes' order. */
  series: readonly MetricSeries[];
  /** Series names switched off in the legend. */
  hidden?: readonly string[];
  /**
   * A mark to draw over an axis's name, by axis name, as a data URI. An axis with none
   * keeps its name alone, so a set that covers some of the axes is not a broken chart.
   */
  marks?: Readonly<Record<string, string>>;
  /** How a value is written in the tooltip. */
  format?: WrittenFigureOptions;
  /** Off under `prefers-reduced-motion`. */
  animate?: boolean;
}

/* The rings and the spokes, as opacities of the ink so both themes get them from one
   number each. Same two values the metric chart's gridlines use, for the same reason. */
const RING_ALPHA = 0.07;
const SPOKE_ALPHA = 0.1;
const AXIS_NAME_ALPHA = 0.5;

/** The fill inside a shape. Low enough that two overlapping shapes both stay readable. */
const AREA_ALPHA = 0.16;

/** The box an axis's mark is fitted into, square whatever the mark's own proportions. */
const MARK_SIZE = 15;

/**
 * The axes in the order ECharts has to be given them to draw them clockwise.
 *
 * ECharts places the first indicator at the top and works anticlockwise, and there is no
 * option to reverse it. Anticlockwise is wrong for anything with an order to it: a week
 * running Monday, Sunday, Saturday around the dial is unreadable however correct the
 * numbers are. Keeping the first axis where it is and reversing the rest turns the same
 * sequence into a clockwise one, so callers pass their axes in reading order and the
 * chart draws them that way.
 *
 * Values are put through the same transform, which is why it is a function and not a
 * `.reverse()` written twice.
 */
export function clockwise<T>(values: readonly T[]): T[] {
  const [first, ...rest] = values;
  return first === undefined ? [] : [first, ...rest.reverse()];
}

/**
 * The readout for one shape: its name, then every axis and what it holds there.
 *
 * Built from the input rather than from the callback's parameters, so the rows are in
 * the axes' own order and an axis worth zero is still listed. A radar's whole subject is
 * the shape, and a shape with a dent in it is a reader's most likely question.
 */
export function renderRadarTooltip(
  index: number,
  input: RadarChartInput,
  palette: MetricPalette,
): string {
  const entry = input.series[index];
  if (!entry) return "";

  const color = colorOf(entry, index, palette);
  const rows = input.axes
    .map((axis, at) => {
      const value = entry.data[at] ?? 0;
      return `<li class="${TOOLTIP_CLASS}__row">
        <span class="${TOOLTIP_CLASS}__name">${escapeHtml(axis)}</span>
        <span class="${TOOLTIP_CLASS}__value">${escapeHtml(writeFigure(value, input.format ?? {}))}</span>
      </li>`;
    })
    .join("");

  return `<div class="${TOOLTIP_CLASS}__card">
    <p class="${TOOLTIP_CLASS}__title">
      <span class="${TOOLTIP_CLASS}__key ${TOOLTIP_CLASS}__key--fill" style="--metric-key: ${color}"></span>
      ${escapeHtml(entry.name)}
    </p>
    <ul class="${TOOLTIP_CLASS}__rows">${rows}</ul>
  </div>`;
}

export function buildRadarOption(input: RadarChartInput, palette: MetricPalette): ECOption {
  const hidden = new Set(input.hidden ?? []);

  /*
   * One scale across every spoke, taken from every series and not only the shown ones.
   * Axes each running to their own maximum would draw a regular polygon whatever the
   * numbers were, which is precisely the thing the shape is supposed to say; and a
   * maximum that moved as series were switched off would redraw the remaining shape at
   * a size that means nothing.
   */
  const peak = Math.max(
    1,
    ...input.series.flatMap((entry) => entry.data.map((value) => value ?? 0)),
  );
  const max = Math.ceil((peak * 1.1) / 10) * 10;

  /* Colour follows the metric and never its rank, so the index is the one in the full
     list: hiding the first series must not repaint the second. */
  const shapes = input.series
    .map((entry, index) => ({ entry, color: colorOf(entry, index, palette) }))
    .filter(({ entry }) => !hidden.has(entry.name));

  const series: RadarSeriesOption = {
    type: "radar",
    // A radar has no gaps. A missing value is nothing happening, which is zero, and
    // leaving it null breaks the outline into pieces that read as a drawing error.
    data: shapes.map(({ entry, color }) => ({
      name: entry.name,
      value: clockwise(input.axes.map((_, at) => entry.data[at] ?? 0)),
      symbolSize: 3,
      itemStyle: { color },
      lineStyle: { color, width: 1.5, ...(entry.dashed ? { type: [4, 4] as number[] } : {}) },
      areaStyle: { color: alpha(color, AREA_ALPHA) },
    })),
  };

  return {
    animation: input.animate ?? true,
    animationDuration: 400,
    animationDurationUpdate: 300,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    textStyle: { fontFamily: SANS },

    // Hidden, because the legend the reader sees is HTML in the card. The radar takes
    // its selection from `data` rather than from here, so this only stops ECharts
    // drawing a second one of its own.
    legend: { show: false },

    tooltip: {
      trigger: "item",
      renderMode: "html",
      className: TOOLTIP_CLASS,
      // ECharts draws no box of its own; the card inside the markup carries the look.
      backgroundColor: "transparent",
      borderWidth: 0,
      padding: 0,
      extraCssText: "box-shadow: none;",
      transitionDuration: 0.15,
      confine: true,
      formatter: (params) => {
        const name = Array.isArray(params) ? params[0]?.name : params.name;
        const at = input.series.findIndex((entry) => entry.name === name);
        return at === -1 ? "" : renderRadarTooltip(at, input, palette);
      },
    },

    radar: {
      shape: "polygon",
      /* Room for the axis names, which are drawn outside the outermost ring and are two
         lines tall wherever they carry a mark. The dial sits a touch above centre because
         the label below it is the one with a card edge to run into. */
      radius: "64%",
      center: ["50%", "47%"],
      splitNumber: 4,
      indicator: clockwise(input.axes).map((name) => ({ name, max })),
      // `axisName` and not `name`: in ECharts 6 the latter is the component's own name,
      // and setting a style object there typechecks as a string and styles nothing.
      axisName: {
        color: alpha(palette.ink, AXIS_NAME_ALPHA),
        fontFamily: MONO,
        fontSize: 11,
        /*
         * A mark over the name, never instead of it. The mark is what the eye finds at a
         * glance and the word is what says which: two Apple platforms wear one Apple, and
         * a reader who does not know a logo is never left guessing. The same rule the
         * session table keeps, where the glyph's colour restates the line under it.
         *
         * `rich` keys have to be identifiers, so they are indices rather than the axis
         * names, which are free text and arrive with spaces in them.
         */
        formatter: (name?: string) => {
          if (name === undefined) return "";
          const at = input.axes.indexOf(name);
          return input.marks?.[name] === undefined ? name : `{m${at}|}\n{n|${name}}`;
        },
        /* Both lines of a label centre on each other, so the mark sits over the middle
           of its word whatever the word's length. Without it ECharts aligns each rich
           segment to the start of the block and the mark hangs off the left of "ChromeOS". */
        align: "center",
        rich: {
          n: {
            color: alpha(palette.ink, AXIS_NAME_ALPHA),
            fontFamily: MONO,
            fontSize: 11,
            lineHeight: 15,
            align: "center",
          },
          ...Object.fromEntries(
            input.axes.flatMap((name, at) => {
              const image = input.marks?.[name];
              return image === undefined
                ? []
                : [
                    [
                      `m${at}`,
                      {
                        width: MARK_SIZE,
                        height: MARK_SIZE,
                        align: "center",
                        verticalAlign: "middle",
                        backgroundColor: { image },
                      },
                    ],
                  ];
            }),
          ),
        },
      },
      // A label is two lines now, and the one at the bottom of the dial is the one that
      // runs out of card. The gap is what keeps it off the outermost ring; the radius
      // above is what leaves room for it at all.
      axisNameGap: 8,
      // The rings carry a value, so they are solid; the spokes only say where an axis
      // is, so they are dashed. The same division the metric chart's grid makes.
      splitLine: { lineStyle: { color: alpha(palette.ink, RING_ALPHA), width: 1 } },
      axisLine: {
        lineStyle: { color: alpha(palette.ink, SPOKE_ALPHA), width: 1, type: [4, 4] },
      },
      // Alternating bands between the rings would be decoration, and this panel's
      // charts spend their ink on the data.
      splitArea: { show: false },
    },

    series,
  };
}
