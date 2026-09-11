<script setup lang="ts">
/**
 * What this project used in a billing period and what Idenzy charges for it (PROJECT.md
 * 5.1, notes/usage.md).
 *
 * In the note's order: the period and the scope beside the title, ahead of every number;
 * actual charges beside the month-end projection and the hour the figures run to; active
 * users against the allowance; the activity chart; then the line items with who bills
 * each. Export and the meter definitions sit under the breakdown, secondary to it.
 *
 * Actual and projected are never one figure. The projection carries its assumption
 * wherever it appears, and it is worked out per meter, because active users are free up
 * to the allowance and a domain costs the same on the 1st as on the 30th: a straight line
 * through the dollars would project neither.
 *
 * The period lives in the URL, replaced rather than pushed, so a month can be linked to
 * and is still selected after a trip to Billing and back.
 */
import type { MetricOption } from "~/components/MetricCard.vue";
import type { RecordColumn } from "~/components/RecordTable.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import { formatCents, INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES } from "~/utils/billing";
import type { MetricSeries } from "~/utils/metric-chart";
import { formatDate } from "~/utils/time";
import {
  billableMau,
  billFor,
  bucketTick,
  bucketTitle,
  CHART_METERS,
  type ChartMeterId,
  FREE_MAU,
  MAU_DEFINITION,
  MAU_EXAMPLES,
  MAU_PRICE,
  MAU_SUMMARY,
  METER_DEFINITIONS,
  mauCents,
  monthBefore,
  PROJECTION_BASIS,
  periodAt,
  periodLastDay,
  periodMonth,
  periodSpan,
  projectBill,
  projectTotals,
  ROUNDING_RULE,
  totalsOf,
  type UsageRange,
  usageCsv,
  usageWindows,
  windowLabel,
} from "~/utils/usage";

const projects = useProjectStore();
const store = useUsageStore();
const billing = useBillingStore();
const route = useRoute();
const router = useRouter();
const now = useNow({ interval: 60_000 });

const project = computed(() => projects.current.id);
const periods = computed(() => store.periodsFor(project.value));

/*
 * The period, in the URL. The open month is the page's own address and carries no query.
 */
const periodId = computed<string>({
  get: () => {
    const asked = route.query["period"];
    const value = Array.isArray(asked) ? asked[0] : asked;
    const known = periods.value.find((entry) => entry.id === value);
    return known?.id ?? periods.value[0]?.id ?? "";
  },
  set: (value) => {
    const rest = Object.fromEntries(
      Object.entries(route.query).filter(([key]) => key !== "period"),
    );
    const open = periods.value[0]?.id;
    void router.replace({ query: value === open ? rest : { ...rest, period: value } });
  },
});

const period = computed(
  () =>
    periods.value.find((entry) => entry.id === periodId.value) ?? store.forProject(project.value),
);
const closed = computed(() => period.value.closed);
const loading = computed(() => store.loading);

/** No figures at all: unknown, which is never drawn as a zero. */
const unavailable = computed(() => !store.loading && periods.value.length === 0);

/** The instant the figures run to: the last metered hour, or the end of a closed month. */
const asOf = computed(() => {
  if (closed.value) return new Date(period.value.end);
  return store.updatedAt === null ? now.value : new Date(store.updatedAt);
});

const month = computed(() => periodMonth(period.value));
const lastDay = computed(() => periodLastDay(period.value));

/*
 * The bill, actual and projected.
 */
const bill = computed(() => billFor(period.value));
const projected = computed(() => (closed.value ? null : projectBill(period.value, asOf.value)));
const totals = computed(() => totalsOf(period.value));
const projectedMau = computed(() => projectTotals(period.value, asOf.value).mau);

function projectedCentsFor(id: string): number | null {
  return projected.value?.lines.find((line) => line.id === id)?.cents ?? null;
}

/**
 * The month before, at the same point for an open month and whole for a closed one, so
 * eleven days are compared with eleven days rather than with thirty-one.
 */
const comparison = computed(() => {
  const index = periods.value.findIndex((entry) => entry.id === period.value.id);
  const prior = index < 0 ? null : (periods.value[index + 1] ?? null);
  if (prior === null) return null;
  const point = closed.value ? prior : periodAt(prior, monthBefore(asOf.value));
  const priorMonth = periodMonth(prior);
  return {
    cents: billFor(point).totalCents,
    mau: totalsOf(point).mau,
    finalCents: billFor(prior).totalCents,
    finalMau: totalsOf(prior).mau,
    words: closed.value
      ? `vs ${priorMonth}`
      : `vs ${bucketTitle(monthBefore(asOf.value).getTime(), "day")}`,
    finalWords: `vs all of ${priorMonth}`,
  };
});

const invoice = computed(() =>
  closed.value
    ? (billing
        .invoicesFor(project.value)
        .find((entry) => entry.periodStart === period.value.start) ?? null)
    : null,
);

function count(value: number): string {
  return value.toLocaleString("en");
}

/*
 * Active users against the allowance. The heading states where the project stands.
 */
const mauHeading = computed(() => {
  if (loading.value || unavailable.value) return "Monthly active users";
  const over = billableMau(totals.value.mau);
  if (over > 0) return `${count(over)} past the free ${count(FREE_MAU)}`;
  if (!closed.value && projectedMau.value > FREE_MAU) return "Inside the free allowance so far";
  return "Inside the free allowance";
});

const mauWords = computed(() => {
  const over = billableMau(totals.value.mau);
  if (over > 0) return `${count(over)} past the free ${count(FREE_MAU)}`;
  return `${Math.floor((totals.value.mau / FREE_MAU) * 100)}% of the free ${count(FREE_MAU)}`;
});

const projectedMauInfo = computed(
  () =>
    `${PROJECTION_BASIS} At ${count(projectedMau.value)} users the line would come to ${formatCents(mauCents(projectedMau.value))}.`,
);

/*
 * When the figures are from, and what to do when they could not be read.
 */
const updatedHour = computed(() =>
  store.updatedAt === null ? null : bucketTick(Date.parse(store.updatedAt), "hour"),
);
const updatedDay = computed(() =>
  store.updatedAt === null ? "" : bucketTitle(Date.parse(store.updatedAt), "day"),
);
const closedAt = computed(() => bucketTitle(Date.parse(period.value.end), "day"));

const staleWords = computed(() =>
  store.updatedAt === null
    ? "Nothing has been read yet, so the figures are unknown rather than nought."
    : `The figures below are as of ${updatedDay.value}, ${updatedHour.value} UTC.`,
);

/*
 * Activity: one meter over a window, against the same window a month before.
 */
const METRIC_OPTIONS: readonly MetricOption[] = CHART_METERS.map((entry) => ({
  value: entry.id,
  label: entry.label,
  description: entry.description,
}));

const RANGES: readonly SegmentedOption[] = [
  { value: "1d", label: "1d", title: "The last 24 hours, by the hour" },
  { value: "7d", label: "7d", title: "The last 7 days" },
  { value: "30d", label: "30d", title: "The last 30 days" },
];

const meter = ref<ChartMeterId>("mau");
const range = ref<UsageRange>("7d");

const windows = computed(() => usageWindows(range.value, asOf.value));

const chart = computed(() => {
  const { current, previous } = windows.value;
  const series: MetricSeries[] = [
    {
      name: windowLabel(current),
      data: store.valuesFor(project.value, meter.value, current),
      tone: 1,
    },
    {
      name: windowLabel(previous),
      data: store.valuesFor(project.value, meter.value, previous),
      tone: 2,
      type: "line",
      dashed: true,
    },
  ];
  return {
    categories: current.buckets.map((bucket) => bucketTick(bucket, current.granularity)),
    titles: current.buckets.map(
      (bucket, index) =>
        `${bucketTitle(bucket, current.granularity)}, against ${bucketTitle(previous.buckets[index] ?? bucket, previous.granularity)}`,
    ),
    series,
  };
});

const activityWords = computed(() => {
  const of = closed.value ? ` of ${month.value}` : "";
  return range.value === "1d"
    ? `The last 24 hours${of} by the hour, against the same hours a month before. UTC.`
    : `The last ${range.value === "7d" ? 7 : 30} days${of}, against the same dates a month before. UTC.`;
});

/*
 * The line items.
 */
const LINE_COLUMNS: readonly RecordColumn[] = [
  { key: "item", label: "Line item", width: "minmax(0, 1.5fr)" },
  { key: "quantity", label: "Quantity", width: "minmax(0, 1fr)" },
  { key: "rate", label: "Unit rate", width: "minmax(0, 1.2fr)" },
  { key: "charge", label: "Idenzy charge", width: "minmax(7.5rem, 0.9fr)", align: "end" },
  { key: "owner", label: "Billing owner", width: "minmax(0, 1fr)" },
];

const definitionsOpen = ref(false);
const definitionsId = useId();

/** The period as a file, named by project and month so two exports do not collide. */
function exportCsv() {
  const csv = usageCsv({
    period: period.value,
    projectId: project.value,
    projectName: projects.current.name,
    actual: bill.value,
    projected: projected.value,
    updatedAt: closed.value ? period.value.end : store.updatedAt,
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `idenzy-usage-${project.value}-${period.value.id}${closed.value ? "" : "-to-date"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Usage">
      <template #description>
        What <span class="font-medium text-ink">{{ projects.current.name }}</span> used and
        what Idenzy charges for it. Billed per project, in US dollars, before tax.
      </template>
      <template #actions>
        <UsagePeriodMenu v-model="periodId" :loading="loading" :periods="periods" />
      </template>
    </PageHeader>

    <!-- A failed read keeps what was last read and says when that was. Never a zero: an
         unread meter is unknown, and "$0.00" would be an assurance nobody checked. -->
    <div
      v-if="store.error || unavailable"
      class="flex flex-wrap items-center justify-between gap-3 rounded-(--idenzy-radius) border border-line bg-surface px-4 py-3"
      role="status"
    >
      <p class="m-0 flex min-w-0 items-start gap-2.5 text-sm text-ink">
        <span aria-hidden="true" class="mt-1.5 size-1.5 flex-none rounded-full bg-warning" />
        <span>
          Usage could not be read.
          <span class="text-ink/60">{{ staleWords }}</span>
        </span>
      </p>
      <v-btn
        :loading="store.refreshing"
        class="text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:refresh"
        size="small"
        variant="outlined"
        @click="store.refresh()"
      >
        Retry
      </v-btn>
    </div>

    <!-- Actual beside projected, never one figure, and the hour both are as of. -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ loading ? "Charges" : `Charges for ${month}` }}
        </h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          {{ periodSpan(period) }}, UTC.
          {{
            closed
              ? "The month is closed, so every figure here is final."
              : "What has been charged so far, beside where the month lands at the current average rate."
          }}
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-3">
        <Statistic
          :compare="comparison?.words ?? ''"
          :description="closed ? `All of ${month}, before tax` : 'So far, before tax'"
          :label="closed ? 'Charges' : 'Actual charges'"
          :loading="loading"
          :previous="comparison ? comparison.cents / 100 : null"
          :value="unavailable ? null : bill.totalCents / 100"
          format="money"
          info="Every line in the table below, each rounded to the cent. Charges your own vendors bill you are not in it."
          positive="down"
          prefix="$"
        />

        <Statistic
          v-if="!closed"
          :compare="comparison?.finalWords ?? ''"
          :info="`${PROJECTION_BASIS} Before tax.`"
          :loading="loading"
          :previous="comparison ? comparison.finalCents / 100 : null"
          :value="unavailable ? null : (projected?.totalCents ?? 0) / 100"
          description="At the current average rate"
          format="money"
          label="Projected month-end"
          positive="down"
          prefix="$"
        />
        <Statistic
          v-else
          :description="
            invoice
              ? `${invoice.number}, issued ${formatDate(invoice.issuedAt)}`
              : 'Nothing was charged'
          "
          :loading="loading"
          :value="invoice ? INVOICE_STATUS_LABELS[invoice.status] : 'None'"
          info="Raised the day after a month closes, for exactly the total beside it."
          label="Invoice"
        />

        <Statistic
          v-if="!closed"
          :description="updatedDay ? `${updatedDay}, metered hourly` : 'Not read yet'"
          :loading="loading"
          :value="updatedHour"
          info="Metered hourly, so the hour in progress is not in these figures yet."
          label="Data updated"
          unit="UTC"
        />
        <Statistic
          v-else
          :description="`Closed ${closedAt}, 00:00 UTC`"
          :loading="loading"
          info="Nothing more is metered into a month once it closes."
          label="Data updated"
          value="Final"
        />
      </div>
    </section>

    <!-- Active users against the allowance, and where they land at the same rate. -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">{{ mauHeading }}</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">{{ MAU_SUMMARY }}</p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2">
        <Statistic
          :compare="comparison?.words ?? ''"
          :description="mauWords"
          :info="MAU_DEFINITION"
          :loading="loading"
          :previous="comparison?.mau ?? null"
          :value="unavailable ? null : totals.mau"
          label="Monthly active users"
        />

        <Statistic
          v-if="!closed"
          :compare="comparison?.finalWords ?? ''"
          :info="projectedMauInfo"
          :loading="loading"
          :previous="comparison?.finalMau ?? null"
          :value="unavailable ? null : projectedMau"
          description="At the current average rate"
          label="Projected month-end"
        />
        <Statistic
          v-else
          :description="
            billableMau(totals.mau) === 0
              ? 'Inside the allowance'
              : `${formatCents(mauCents(totals.mau))} at $${MAU_PRICE} each`
          "
          :loading="loading"
          :value="unavailable ? null : billableMau(totals.mau)"
          info="Only the users past the allowance are charged."
          label="Billed past the allowance"
        />
      </div>
    </section>

    <!-- The shape of the period, one meter at a time, against the same window a month
         before. No figure on the card: the tiles above carry them, and a number printed
         twice on one screen is read as two numbers that happen to agree. -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Activity</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">{{ activityWords }}</p>
      </header>

      <MetricCard
        v-model="meter"
        :categories="chart.categories"
        :category-label="range === '1d' ? 'Hour' : 'Day'"
        :loading="loading"
        :options="METRIC_OPTIONS"
        :series="chart.series"
        :titles="chart.titles"
        type="area"
      >
        <template #actions>
          <SegmentedControl v-model="range" :options="RANGES" label="Range" />
        </template>
      </MetricCard>

      <p class="m-0 text-xs text-ink/45">
        {{ closed ? "Times are UTC." : "Times are UTC and the last hour is not in yet." }}
        These figures are sample data until the management API reports this project's usage.
      </p>
    </section>

    <!-- Every line, the ones worth nothing included, each with its unit and who bills it.
         Below 900px a row stacks with the charge on its top line. -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Line items</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Every meter on this project, the ones that come to nothing included, and who bills
          each.
          <template v-if="!closed">
            The note under a charge is where it lands by {{ lastDay }} at the current average
            rate.
          </template>
        </p>
      </header>

      <RecordTable :columns="LINE_COLUMNS" framed label="Line items">
        <template v-if="loading">
          <li v-for="row in 4" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex flex-col gap-1.5">
              <span class="h-2.5 w-32 animate-pulse rounded-full bg-ink/8" />
              <span class="h-2 w-24 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell"><span class="block h-2.5 w-20 animate-pulse rounded-full bg-ink/8" /></span>
            <span class="record-cell"><span class="block h-2.5 w-28 animate-pulse rounded-full bg-ink/6" /></span>
            <span class="record-cell record-cell--action justify-self-end">
              <span class="block h-2.5 w-14 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half"><span class="block h-2.5 w-16 animate-pulse rounded-full bg-ink/6" /></span>
          </li>
        </template>

        <template v-else-if="!unavailable">
          <UsageLineRow
            v-for="line in bill.lines"
            :key="line.id"
            :line="line"
            :projected-by="lastDay"
            :projected-cents="projectedCentsFor(line.id)"
          />

          <li class="record-row bg-ink/2">
            <span class="record-cell record-cell--primary flex flex-col gap-0.5">
              <span class="text-xs font-medium text-ink">{{ closed ? "Total" : "Total so far" }}</span>
              <span class="text-[11px] leading-4 text-ink/50">Before tax</span>
            </span>
            <span aria-hidden="true" class="record-cell max-[900px]:hidden" />
            <span aria-hidden="true" class="record-cell max-[900px]:hidden" />
            <span
              class="record-cell record-cell--action flex flex-col items-end gap-0.5 justify-self-end text-right"
            >
              <span class="font-mono text-sm font-medium text-ink tabular-nums">
                {{ formatCents(bill.totalCents) }}
              </span>
              <span v-if="projected" class="text-[11px] leading-4 text-ink/50">
                {{ formatCents(projected.totalCents) }} by {{ lastDay }}
              </span>
            </span>
            <span aria-hidden="true" class="record-cell max-[900px]:hidden" />
          </li>
        </template>

        <template v-if="unavailable" #empty>
          <p class="m-0 px-4 py-8 text-center text-xs leading-5 text-ink/55">
            No usage could be read for this period. That is unknown rather than nothing, so
            no line and no total is shown.
          </p>
        </template>
      </RecordTable>

      <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p class="m-0 max-w-2xl text-xs leading-5 text-ink/55">
          {{ ROUNDING_RULE }} Charges your own vendors bill you directly are not in it.
        </p>

        <div class="flex flex-none flex-wrap items-center gap-2">
          <template v-if="closed">
            <template v-if="invoice">
              <StatusBadge
                :label="INVOICE_STATUS_LABELS[invoice.status]"
                :tone="INVOICE_STATUS_TONES[invoice.status]"
              />
              <v-btn
                :href="invoice.pdfUri ?? undefined"
                append-icon="material-symbols:open-in-new"
                class="text-xs font-medium"
                color="neutral"
                rel="noopener"
                size="small"
                target="_blank"
                variant="outlined"
              >
                View invoice {{ invoice.number }}
              </v-btn>
            </template>
            <span v-else-if="!loading" class="text-xs text-ink/55">
              No invoice: nothing was charged
            </span>
          </template>
          <template v-else>
            <span class="text-xs text-ink/55">Invoiced after {{ lastDay }}</span>
            <NuxtLink
              class="inline-flex items-center gap-0.5 text-xs font-medium text-ink/70 no-underline transition-colors duration-150 hover:text-ink"
              to="/billing"
            >
              Billing
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
            </NuxtLink>
          </template>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <v-btn
          :disabled="loading || unavailable"
          class="-ml-2 text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="text"
          @click="exportCsv"
        >
          Export usage
        </v-btn>

        <button
          :aria-controls="definitionsId"
          :aria-expanded="definitionsOpen"
          class="-mr-1 inline-flex h-7 items-center gap-1 rounded-(--idenzy-radius-x-small) px-1 text-xs font-medium text-ink/60 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="definitionsOpen = !definitionsOpen"
        >
          Meter definitions
          <Icon
            :class="definitionsOpen ? 'rotate-180' : ''"
            aria-hidden="true"
            class="text-base transition-transform duration-200"
            name="material-symbols:keyboard-arrow-down"
          />
        </button>
      </div>

      <!-- Folded as a grid row going from one fraction to none, the way LayerCard folds,
           so nothing is measured and the gap folds with it. -->
      <div
        :id="definitionsId"
        :aria-hidden="!definitionsOpen || undefined"
        :class="definitionsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        class="-mt-3 grid transition-[grid-template-rows] duration-200 ease-out"
      >
        <div :inert="!definitionsOpen" class="min-h-0 overflow-hidden">
          <v-card border class="mt-3" flat>
            <div class="divide-y divide-line p-5">
              <SettingRow
                v-for="entry in METER_DEFINITIONS"
                :key="entry.id"
                :description="entry.description"
                :fixed="entry.badge"
                :label="entry.label"
              >
                <template v-if="entry.id === 'mau'" #detail>
                  <ul class="m-0 flex list-disc flex-col gap-1 pl-4 text-xs leading-5 text-ink/60">
                    <li v-for="example in MAU_EXAMPLES" :key="example">{{ example }}</li>
                  </ul>
                </template>
              </SettingRow>
              <SettingRow :description="PROJECTION_BASIS" fixed="Straight line" label="Projections" />
            </div>
          </v-card>
        </div>
      </div>
    </section>
  </div>
</template>
