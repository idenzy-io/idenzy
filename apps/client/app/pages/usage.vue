<script setup lang="ts">
/**
 * What this project has used this month, and what it comes to (PROJECT.md 5.1).
 *
 * The screen opens on the free tier rather than on the total, because for most projects
 * the answer is "nothing yet" and the useful number is how much room is left. Fifty
 * thousand monthly active users is where a bill starts existing at all, so that meter is
 * the first thing on the page and the total is underneath it.
 *
 * Every rate comes from the screen that sets it. The email rates and the five dollars a
 * month for a sending domain are the sending-domains screen's; SMS is charged at what the
 * routing table actually priced each message at. A usage screen that restated a rate would
 * be a second place for it to be wrong.
 *
 * Logging is on the page and is not billed. It is metered per gigabyte ingested, the rate
 * is a proposal rather than a published price, and both the chart and the bill say so. The
 * alternative is a customer meeting their largest new line for the first time on an
 * invoice.
 */
import type { MetricOption } from "~/components/MetricCard.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { MetricSeries } from "~/utils/metric-chart";
import {
  billFor,
  FREE_MAU,
  formatBytes,
  freeTierShare,
  LOGGING_PRICE_PER_GB,
  latest,
  METERS,
  type MeterId,
  meter,
  periodProgress,
  projectedTotal,
  seriesFor,
  sum,
  totalFor,
} from "~/utils/usage";

const projects = useProjectStore();
const store = useUsageStore();

const now = useNow({ interval: 60_000 });

const period = computed(() => store.forProject(projects.current.id));
const bill = computed(() => billFor(period.value));
const progress = computed(() => periodProgress(period.value, now.value));

const mau = computed(() => latest(period.value.mau));
const freeShare = computed(() => freeTierShare(mau.value));
const projectedBill = computed(() => projectedTotal(bill.value.total, progress.value));

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const FULL = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const monthLabel = computed(() =>
  period.value.days.length === 0 ? "" : MONTH.format(new Date(period.value.start)),
);
const daysLeft = computed(() => {
  const left = Math.ceil((new Date(period.value.end).getTime() - now.value.getTime()) / 86_400_000);
  return Math.max(0, left);
});

/*
 * The chart. One card over the four meters, the way the overview's is over its four.
 */

const METRIC_OPTIONS: readonly MetricOption[] = METERS.map((entry) => ({
  value: entry.id,
  label: entry.label,
  description: entry.note,
}));

const VIEWS: readonly SegmentedOption[] = [
  { value: "daily", label: "Daily", title: "What each day added" },
  { value: "running", label: "Running", title: "The month so far, added up" },
];

const metric = ref<MeterId>("mau");
const view = ref("daily");

const chosen = computed(() => meter(metric.value));

/** A level metric has no running total: it already is one. */
const running = computed(() => view.value === "running" && chosen.value.cumulative);

/** The month so far, added up day by day. */
function accumulate(values: readonly number[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (const value of values) {
    running += value;
    out.push(running);
  }
  return out;
}

const chart = computed(() => {
  const values = seriesFor(period.value, metric.value);
  const drawn = running.value ? accumulate(values) : values;

  const series: MetricSeries[] = [{ name: chosen.value.headline, data: drawn, tone: 1 }];

  return {
    categories: period.value.days.map((day) => DAY.format(new Date(day))),
    titles: period.value.days.map((day) => FULL.format(new Date(day))),
    series,
    value: totalFor(period.value, metric.value),
  };
});

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The meters that came to nothing this month still get a tile, with the reason. */
const tiles = computed(() => [
  {
    id: "emails",
    label: "Emails sent",
    value: sum(period.value.emails),
    description: "Verification, reset, magic link and one-time codes.",
  },
  {
    id: "sms",
    label: "Messages sent",
    value: sum(period.value.sms),
    description: period.value.byoSms
      ? "Through your own account, so we charge nothing."
      : "Billed per segment at the destination's rate.",
  },
  {
    id: "logs",
    label: "Logs ingested",
    value: sum(period.value.logBytes),
    bytes: true,
    description: "Not billed yet. Logging is not shipped.",
  },
]);
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:bar-chart-4-bars" title="Usage">
      <template #description>
        What
        <span class="font-medium text-ink">{{ projects.current.name }}</span> has used in
        {{ monthLabel }}, and what it comes to. Security features are never a plan tier:
        passkeys, MFA and custom domains are free on every project.
      </template>
      <template #actions>
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

    <!-- The free tier first. For most projects the total underneath is zero, and the
         question they actually arrived with is how much room is left. -->
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <LayerCard
        description="Every project gets fifty thousand active users a month, forever. A bill starts on the user after that."
        title="Free tier"
      >
        <template #badge>
          <StatusBadge
            :label="mau >= FREE_MAU ? 'Past the free tier' : 'Inside the free tier'"
            :tone="mau >= FREE_MAU ? 'warning' : 'success'"
          />
        </template>

        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <p class="m-0 flex items-baseline gap-2">
              <span
                class="font-mono text-3xl leading-none font-medium tracking-tight text-ink tabular-nums"
              >
                {{ mau.toLocaleString("en") }}
              </span>
              <span class="text-xs text-ink/55">
                of {{ FREE_MAU.toLocaleString("en") }} active users
              </span>
            </p>
            <p class="m-0 text-xs text-ink/55">
              {{ Math.round(progress * 100) }}% through {{ monthLabel }},
              {{ daysLeft }} {{ daysLeft === 1 ? "day" : "days" }} left
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="relative block h-2 overflow-hidden rounded-full bg-ink/8">
              <span
                :class="mau >= FREE_MAU ? 'bg-warning' : 'bg-primary'"
                :style="{ width: `${freeShare * 100}%` }"
                class="block h-full rounded-full transition-[width] duration-300 ease-out"
              />
              <!-- Where the month is, against where the users are. Ahead of the bar means
                   the tier will hold; behind it means it will not. -->
              <span
                :style="{ left: `${progress * 100}%` }"
                aria-hidden="true"
                class="absolute inset-y-0 w-px bg-ink/40"
              />
            </span>
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              The mark is how far into the month it is. A bar behind it is a project that
              will finish inside the tier at this rate; a bar ahead of it will not.
            </p>
          </div>
        </div>
      </LayerCard>

      <LayerCard description="At this month's rate, and nothing cleverer." title="This month">
        <div class="flex flex-col gap-3">
          <p class="m-0 flex items-baseline gap-2">
            <span
              class="font-mono text-3xl leading-none font-medium tracking-tight text-ink tabular-nums"
            >
              {{ money(bill.total) }}
            </span>
            <span class="text-xs text-ink/55">so far</span>
          </p>
          <div class="flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <span class="text-xs text-ink/60">Projected for {{ monthLabel }}</span>
            <span class="font-mono text-sm text-ink tabular-nums">{{ money(projectedBill) }}</span>
          </div>
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            The month so far divided by how much of it has passed. A straight line, because
            a bill is not a forecast.
          </p>
        </div>
      </LayerCard>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Statistic
        v-for="tile in tiles"
        :key="tile.id"
        :description="tile.description"
        :format="tile.bytes ? 'bytes' : 'number'"
        :label="tile.label"
        :value="tile.value"
        compact
      />
    </div>

    <MetricCard
      v-model="metric"
      :categories="chart.categories"
      :format="chosen.format"
      :loading="store.loading"
      :options="METRIC_OPTIONS"
      :series="chart.series"
      :titles="chart.titles"
      :value="chart.value"
      category-label="Day"
      compact
      type="bar"
    >
      <template #actions>
        <SegmentedControl
          v-model="view"
          :disabled="!chosen.cumulative"
          :options="VIEWS"
          label="View"
        />
      </template>
    </MetricCard>

    <LayerCard
      :padded="false"
      description="Every line, including the ones that come to nothing: a meter counted and free is not the same as a meter nobody counted."
      title="What it comes to"
    >
      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="line in bill.lines"
          :key="line.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
        >
          <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-medium text-ink">{{ line.label }}</span>
              <span
                v-if="line.provisional"
                class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
              >
                Not billed yet
              </span>
            </span>
            <span class="text-[11px] text-ink/55">{{ line.quantity }}</span>
          </div>
          <span class="flex-none text-[11px] whitespace-nowrap text-ink/45">{{ line.rate }}</span>
          <span
            :class="line.free ? 'text-ink/45' : 'text-ink'"
            class="w-20 flex-none text-right font-mono text-xs tabular-nums"
          >
            <template v-if="line.free && line.amount === 0">Free</template>
            <template v-else>{{ money(line.amount) }}</template>
          </span>
        </li>
      </ul>

      <div
        class="flex items-center justify-between gap-4 border-t border-line px-4 py-3 text-sm"
      >
        <span class="font-medium text-ink">Total so far</span>
        <span class="font-mono font-medium text-ink tabular-nums">{{ money(bill.total) }}</span>
      </div>
    </LayerCard>

    <LayerCard
      description="How each meter is counted, and the two that are free whatever the volume."
      title="What is billed"
    >
      <div class="divide-y divide-line">
        <SettingRow
          v-for="entry in METERS"
          :key="entry.id"
          :description="entry.note"
          :fixed="entry.provisional ? 'Not yet' : undefined"
          :label="entry.label"
        />
        <SettingRow
          description="Passkeys, TOTP, recovery codes, custom auth domains, the audit trail and every fraud control are on every project at no charge. Gating security is how a product ends up with insecure customers, so there is no tier that unlocks them."
          fixed="Always free"
          label="Security features"
        />
        <SettingRow
          description="Bringing your own SES or SMTP makes email free, and your own Twilio or Vonage makes SMS free. We charge for carriage, so where we are not carrying it there is nothing to charge for."
          fixed="Free"
          label="Your own vendors"
        />
        <SettingRow
          description="Metered by what is ingested rather than by what is stored, so searching costs nothing. The rate on this page is a proposal and the meter reads zero until the feature ships, at which point this row will state the published price."
          :fixed="`$${LOGGING_PRICE_PER_GB.toFixed(2)} per GB, proposed`"
          label="Logging, when it arrives"
        />
      </div>
    </LayerCard>
  </div>
</template>
