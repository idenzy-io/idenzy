<script setup lang="ts">
/**
 * Overview page, currently a shape rather than a screen: it renders placeholder numbers
 * so the four halves of the panel stack (Vuetify, Tailwind, VueUse, ECharts) are exercised
 * by something that compiles. The management API client replaces the constants below.
 */

const theme = useTheme();

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
    <PageHeader description="Last seven days across every project." title="Overview">
      <template #actions>
        <!-- Unwired, like the numbers: the export is the management API's report
             endpoint once there is one. -->
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="outlined"
        >
          Export
        </v-btn>
      </template>
    </PageHeader>

    <!-- Placeholder figures, like the chart's. The `previous` on each is last week's, which
         is what the header promises the comparison is. -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Statistic
        :previous="11988"
        :value="12480"
        compact
        compare="vs last week"
        description="Signed in at least once in the last 30 days."
        info="A user who signed in on two projects is counted once."
        label="Monthly active users"
      />
      <Statistic
        :previous="3086"
        :value="3142"
        compare="vs last week"
        description="Every method, passkeys included."
        label="Sign-ins today"
        compact
      />
      <Statistic
        :previous="99"
        :value="87"
        compare="vs last week"
        description="Expired codes and refused passkeys."
        label="Failed sign-ins"
        positive="down"
        compact
      />
      <Statistic
        :previous="5868"
        :value="5903"
        compare="vs last week"
        description="Signed-in devices, across every user."
        info="A session is active while its refresh token has neither expired nor been revoked."
        label="Active sessions"
        compact
      />
    </div>

    <v-card border flat>
      <v-card-title class="text-base font-medium">Sign-ins</v-card-title>
      <v-card-text>
        <VChart :option="chart" autoresize class="h-72 w-full" />
      </v-card-text>
    </v-card>
  </div>
</template>
