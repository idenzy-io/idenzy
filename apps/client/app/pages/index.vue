<script setup lang="ts">
/**
 * Overview page, currently a shape rather than a screen: it renders placeholder numbers
 * so the four halves of the panel stack (Vuetify, Tailwind, VueUse, ECharts) are exercised
 * by something that compiles. The management API client replaces the constants below.
 */

const theme = useTheme();

const tiles = [
  { label: "Monthly active users", value: "12,480", delta: "+4.1%" },
  { label: "Sign-ins today", value: "3,142", delta: "+1.8%" },
  { label: "Failed sign-ins", value: "87", delta: "-12.4%" },
  { label: "Active sessions", value: "5,903", delta: "+0.6%" },
];

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const signIns = [820, 932, 901, 1290, 1330, 640, 520];

/**
 * Charts draw to a canvas, outside Vuetify's stylesheet, so the series colour is read
 * from the theme rather than inherited. Recomputed rather than read once: `current` is
 * reactive and the system theme can flip while the page is open.
 *
 * A theme colour is a string in every theme we define, but Vuetify 4 also accepts RGB and
 * HSV objects, and ECharts takes neither. Falling back to its own palette beats coercing
 * an object into the string "[object Object]" and drawing an invisible line.
 */
const seriesColor = computed(() => {
  const primary = theme.current.value.colors["primary"];
  return typeof primary === "string" ? { color: primary } : {};
});

const chart = computed<ECOption>(() => ({
  grid: { top: 16, right: 8, bottom: 24, left: 40 },
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: days, boundaryGap: false },
  yAxis: { type: "value" },
  series: [
    {
      type: "line",
      name: "Sign-ins",
      data: signIns,
      smooth: true,
      showSymbol: false,
      areaStyle: { opacity: 0.12 },
      ...seriesColor.value,
    },
  ],
}));
</script>

<template>
  <div class="flex flex-col gap-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
      <p class="text-sm opacity-70">Last seven days across every project.</p>
    </header>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <v-card v-for="tile in tiles" :key="tile.label" border flat>
        <v-card-text>
          <p class="text-sm opacity-70">{{ tile.label }}</p>
          <p class="mt-1 text-3xl font-semibold tabular-nums">{{ tile.value }}</p>
          <p class="mt-1 text-xs opacity-70">{{ tile.delta }} on last week</p>
        </v-card-text>
      </v-card>
    </div>

    <v-card border flat>
      <v-card-title class="text-base font-medium">Sign-ins</v-card-title>
      <v-card-text>
        <VChart :option="chart" autoresize class="h-72 w-full" />
      </v-card-text>
    </v-card>
  </div>
</template>
