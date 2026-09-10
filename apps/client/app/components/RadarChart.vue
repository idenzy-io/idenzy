<script setup lang="ts">
/**
 * The canvas half of a radar card, the way `MetricChart` is a metric card's. What it
 * draws is decided in `utils/radar-chart.ts`; this reads the theme, honours the motion
 * preference and repaints once the fonts are in.
 *
 * The repaint is the same problem and the same fix. A canvas is painted on mount, before
 * DM Mono has arrived, and does not re-render itself when a font lands: left alone, every
 * axis name here stays in the fallback face. The tooltip's styles are `MetricChart`'s,
 * because it writes the same `metric-tooltip` markup and two copies of that stylesheet
 * would drift.
 */
import type { WrittenFigureOptions } from "~/utils/format";
import { alpha, type MetricSeries } from "~/utils/metric-chart";
import { markDataUri } from "~/utils/platform-marks";
import { buildRadarOption } from "~/utils/radar-chart";

const props = withDefaults(
  defineProps<{
    /** One name per spoke, clockwise from the top. */
    axes: readonly string[];
    /** One shape each, its values in the axes' order. */
    series: readonly MetricSeries[];
    /** Series names switched off in the legend. */
    hidden?: readonly string[];
    /**
     * A mark to draw over an axis's name, by axis name, given as a key into the vendored
     * platform marks. Resolved here rather than by the caller, because the colour they
     * are painted in is the theme's and this is the half that reads the theme.
     */
    marks?: Readonly<Record<string, string>>;
    format?: WrittenFigureOptions;
    /** In pixels. Ignored when the chart is filling. */
    height?: number;
    /**
     * Take the whole of whatever the parent gives, rather than a fixed height. For a card
     * matching the height of the one beside it: the chrome is the same either way and the
     * spare room should go to the picture, not to a gap under it.
     */
    fill?: boolean;
    /** What a screen reader is told the picture is. */
    label?: string;
  }>(),
  { hidden: () => [], marks: undefined, format: () => ({}), height: 256, fill: false, label: "" },
);

/* The same opacity `radar-chart.ts` gives the axis names. Named here because this is
   where the mark is painted and the two have to agree. */
const AXIS_MARK_ALPHA = 0.5;

const palette = useMetricPalette();
const motion = usePreferredReducedMotion();

/* The marks take the axis text's own ink, at the axis text's own opacity, so the mark
   and the word under it read as one label rather than as a picture with a caption. */
const marks = computed(() => {
  if (props.marks === undefined) return undefined;
  const ink = alpha(palette.value.ink, AXIS_MARK_ALPHA);
  const drawn: Record<string, string> = {};
  for (const [axis, mark] of Object.entries(props.marks)) {
    const uri = markDataUri(mark, ink);
    if (uri !== null) drawn[axis] = uri;
  }
  return drawn;
});

const option = computed<ECOption>(() =>
  buildRadarOption(
    {
      axes: props.axes,
      series: props.series,
      hidden: props.hidden,
      format: props.format,
      animate: motion.value !== "reduce",
      ...(marks.value === undefined ? {} : { marks: marks.value }),
    },
    palette.value,
  ),
);

const chart = useTemplateRef<{ resize: () => void }>("chart");

onMounted(() => {
  // `resize` runs a full update, which is what repaints the text in the loaded face.
  document.fonts?.ready.then(() => chart.value?.resize());
});
</script>

<template>
  <VChart
    ref="chart"
    :aria-label="label"
    :option="option"
    :style="{ height: fill ? '100%' : `${height}px` }"
    autoresize
    class="block w-full"
    role="img"
  />
</template>
