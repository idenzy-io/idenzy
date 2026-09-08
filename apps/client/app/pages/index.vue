<script setup lang="ts">
/**
 * Overview page, currently a shape rather than a screen: it renders placeholder numbers
 * so the four halves of the panel stack (Vuetify, Tailwind, VueUse, ECharts) are exercised
 * by something that compiles. The management API client replaces the walks below.
 */
import type { MetricOption } from "~/components/MetricCard.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { MetricSeries } from "~/utils/metric-chart";

const METRICS: readonly MetricOption[] = [
  { value: "sign-ins", label: "Sign-ins", description: "Every successful sign-in, by any method." },
  { value: "sign-ups", label: "Sign-ups", description: "Accounts created, before verification." },
  {
    value: "failures",
    label: "Failed sign-ins",
    description: "Wrong passwords, expired codes and refused passkeys.",
  },
  {
    value: "sessions",
    label: "Active sessions",
    description: "Signed-in devices across every user, at the end of each period.",
  },
];

const RANGES: readonly SegmentedOption[] = [
  { value: "1d", label: "1d", title: "The last 24 hours" },
  { value: "7d", label: "7d", title: "The last 7 days" },
  { value: "14d", label: "14d", title: "The last 14 days" },
];

const metric = ref("sign-ins");
const range = ref("7d");

/* A day's worth of each, and how it is summed up: a count adds up over the period, a
   level is whatever it was at the end. Failures are the one where down is good. */
const PROFILES: Record<
  string,
  { seed: number; base: number; swing: number; level?: true; positive?: "down" }
> = {
  "sign-ins": { seed: 3, base: 1100, swing: 520 },
  "sign-ups": { seed: 5, base: 140, swing: 90 },
  failures: { seed: 8, base: 30, swing: 24, positive: "down" },
  sessions: { seed: 13, base: 5900, swing: 300, level: true },
};

/**
 * A fixed pseudo-random walk, so the placeholder looks like traffic and does not change
 * between renders. The sine gives it a week's rhythm; the noise keeps it from looking
 * drawn.
 */
function walk(seed: number, length: number, base: number, swing: number): number[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  return Array.from({ length }, (_, index) =>
    Math.max(0, Math.round(base + Math.sin(index / 2.2) * swing * 0.5 + (next() - 0.5) * swing)),
  );
}

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const FULL = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const HOUR = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false });

/** The ticks and their long names for a range, ending now. */
function period(range: string) {
  const now = new Date();
  if (range === "1d") {
    const hours = Array.from({ length: 24 }, (_, index) => {
      const at = new Date(now);
      at.setMinutes(0, 0, 0);
      at.setHours(now.getHours() - 23 + index);
      return at;
    });
    return {
      categories: hours.map((at) => HOUR.format(at)),
      titles: hours.map((at) => `${DAY.format(at)}, ${HOUR.format(at)}`),
      label: "Hour",
    };
  }

  const count = range === "14d" ? 14 : 7;
  const days = Array.from({ length: count }, (_, index) => {
    const at = new Date(now);
    at.setHours(0, 0, 0, 0);
    at.setDate(at.getDate() - (count - 1) + index);
    return at;
  });
  return {
    categories: days.map((at) => DAY.format(at)),
    titles: days.map((at) => FULL.format(at)),
    label: "Day",
  };
}

const COMPARE: Record<string, string> = {
  "1d": "vs previous 24 hours",
  "7d": "vs previous 7 days",
  "14d": "vs previous 14 days",
};

const overview = computed(() => {
  const { categories, titles, label } = period(range.value);
  const profile = PROFILES[metric.value] ?? PROFILES["sign-ins"];
  const scale = range.value === "1d" ? 1 / 20 : 1;
  const base = (profile?.base ?? 0) * scale;
  const swing = (profile?.swing ?? 0) * scale;
  const seed = profile?.seed ?? 1;

  const current = walk(seed, categories.length, base, swing);
  const previous = walk(seed + 7, categories.length, base * 0.94, swing);
  const total = (values: number[]) =>
    profile?.level ? (values.at(-1) ?? 0) : values.reduce((sum, value) => sum + value, 0);

  const series: MetricSeries[] = [
    { name: "Current period", data: current, tone: 1 },
    { name: "Previous period", data: previous, tone: "muted", type: "line", dashed: true },
  ];
  const positive: "up" | "down" = profile?.positive ?? "up";

  return {
    categories,
    titles,
    label,
    series,
    value: total(current),
    previous: total(previous),
    positive,
  };
});

/* By first factor over the week, stacked: the height is the day's sign-ins and each
   band is one method's share of it. */
const methods = computed(() => {
  const { categories, titles } = period("7d");
  const series: MetricSeries[] = [
    { name: "Password", data: walk(21, 7, 520, 180), stack: "method" },
    { name: "Passkey", data: walk(22, 7, 310, 140), stack: "method" },
    { name: "Google", data: walk(23, 7, 240, 90), stack: "method" },
    { name: "Magic link", data: walk(24, 7, 90, 60), stack: "method" },
  ];
  return { categories, titles, series };
});
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

    <!-- Placeholder figures, like the charts'. The `previous` on each is last week's, which
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

    <MetricCard
      v-model="metric"
      :categories="overview.categories"
      :category-label="overview.label"
      :compare="COMPARE[range]"
      :options="METRICS"
      :positive="overview.positive"
      :previous="overview.previous"
      :series="overview.series"
      :titles="overview.titles"
      :value="overview.value"
      type="area"
    >
      <template #actions>
        <SegmentedControl v-model="range" :options="RANGES" label="Period" />
      </template>
    </MetricCard>

    <MetricCard
      :categories="methods.categories"
      :series="methods.series"
      :titles="methods.titles"
      category-label="Day"
      description="Which first factor each sign-in used, over the last seven days."
      title="Sign-ins by method"
      type="bar"
    />
  </div>
</template>
