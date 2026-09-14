<script setup lang="ts">
/**
 * The state of the organisation's money, on one screen: what there is, what the month is
 * taking, whether a payment has failed, and which project is costing what
 * (notes/settings-billing.md: entity and payment status, then balance, then the period's
 * reconciliation).
 *
 * Four facts first, in the band the wallet and the settings screens open with, because
 * the four figures are what a billing owner arrives for and the rest of the tab is their
 * explanation. The fourth is the payment state rather than a fifth figure: the runway
 * while nothing is wrong and the amount owed the moment something is, since the two are
 * never both worth reading (the note's "a failed payment replaces the normal status").
 *
 * Add credit sits beside the balance, as the note asks, and is disabled with its reason
 * where the deployment takes no payments. Nothing on this tab writes anything else.
 */
import type { Fact } from "~/components/FactGrid.vue";
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  formatCents,
  PAYMENTS_UNAVAILABLE,
  RUNWAY_HORIZON_DAYS,
  runwayDays,
  runwayTone,
  type TopUpRequest,
} from "~/utils/billing";
import { ORG_KIND_LABELS } from "~/utils/organisation";
import { formatDateTime } from "~/utils/time";
import { trendOf } from "~/utils/trend";
import { PROJECTION_BASIS, ROUNDING_RULE } from "~/utils/usage";

const screen = useBillingScreen();
const {
  store,
  usage,
  org,
  held,
  kind,
  wallet,
  methods,
  monthLabel,
  projectCharges,
  spentCents,
  projectedCents,
  lastMonth,
  balance,
  owed,
  pastDue,
  repair,
} = screen;

/* Written out rather than interpolated, because Tailwind reads the source for class names
   and a built one is not in the bundle. */
const TONE_DOTS = { success: "bg-success", warning: "bg-warning", error: "bg-error" } as const;

/**
 * The payment state, as one fact. The runway is an estimate from a straight line and says
 * so; past due is a fact with a repair, and it wins.
 */
const paymentFact = computed<Fact>(() => {
  if (repair.value) {
    const count = pastDue.value.length;
    return {
      key: "payment",
      label: "Past due",
      value: formatCents(owed.value),
      mono: true,
      dot: TONE_DOTS.error,
      note: `${count === 1 ? "One invoice" : `${count} invoices`} unpaid`,
      info: "What a failed payment left owing. The invoices tab names each one, and the payment provider's portal is where it is settled.",
    };
  }
  if (owed.value > 0) {
    return {
      key: "payment",
      label: "Awaiting payment",
      value: formatCents(owed.value),
      mono: true,
      dot: TONE_DOTS.warning,
      note: "Open invoice, not yet due",
      info: "An invoice raised and not yet paid. Nothing is wrong until its due date passes.",
    };
  }
  const runway: Fact = {
    key: "payment",
    label: "Runway",
    value: "",
    mono: true,
    dot: TONE_DOTS[runwayTone(balance.value)],
    info: "How long the balance lasts at this month's projected rate. An estimate from a straight line, not a promise: a busier week shortens it.",
  };
  if (balance.value.cents <= 0) {
    return { ...runway, value: "Spent", mono: false, note: "The balance is used up" };
  }
  const days = runwayDays(balance.value);
  if (!Number.isFinite(days)) {
    return { ...runway, value: "None needed", mono: false, note: "Nothing is being spent" };
  }
  if (days > RUNWAY_HORIZON_DAYS) {
    return { ...runway, value: "365+ days", note: "More than a year at this rate" };
  }
  const whole = Math.floor(days);
  return {
    ...runway,
    value: `${whole} ${whole === 1 ? "day" : "days"}`,
    note: "At this month's projected rate",
  };
});

/** How a figure moved against last month, for the line under it. */
function movement(cents: number, previousCents: number | undefined, against: string): string {
  if (previousCents === undefined) return "";
  const trend = trendOf(cents, previousCents, "down");
  return trend.text === "–" ? `Nothing to compare ${against}` : `${trend.text} ${against}`;
}

const figures = computed<Fact[]>(() => [
  {
    key: "balance",
    label: "Balance",
    value: formatCents(balance.value.cents),
    mono: true,
    note: `${formatCents(wallet.value.purchasedCents)} purchased · ${formatCents(wallet.value.promotionalCents)} promotional`,
    info: "Everything spendable, across every project this organisation holds. Promotional credit is drawn down before purchased, because it is the part that can expire.",
  },
  {
    key: "charged",
    label: "Charged this month",
    value: formatCents(spentCents.value),
    mono: true,
    note:
      movement(spentCents.value, lastMonth.value?.samePointCents, "vs this point last month") ||
      "So far, before tax",
    info: "Charged by Idenzy across every project in this organisation, so far and before tax. Each project's lines are rounded to the cent once and this is the sum of those totals, which is why it and the usage screen agree.",
  },
  {
    key: "projected",
    label: "Projected month-end",
    value: formatCents(projectedCents.value),
    mono: true,
    note:
      movement(projectedCents.value, lastMonth.value?.finalCents, "vs last month") ||
      "At the current average rate",
    info: `${PROJECTION_BASIS} Before tax.`,
  },
  paymentFact.value,
]);

const PROJECT_COLUMNS: readonly RecordColumn[] = [
  { key: "project", label: "Project", width: "minmax(0, 1.6fr)" },
  { key: "actual", label: "Charged so far", width: "minmax(0, 1fr)", align: "end" },
  { key: "projected", label: "Projected", width: "minmax(0, 1fr)", align: "end" },
];

const chargesDescription = computed(() => {
  const to = usage.updatedAt ? `to ${formatDateTime(usage.updatedAt)} UTC` : "so far";
  return `Each project's own bill ${to}, before tax. ${ROUNDING_RULE}`;
});

/*
 * Funding.
 */

const topUpOpen = ref(false);

async function confirmTopUp(request: TopUpRequest) {
  /* The dialog stays open on a refusal, with the reason: closing it would be the panel
     reporting a charge it did not make. */
  if (await screen.topUp(request)) topUpOpen.value = false;
}

/* A dialog belongs to the organisation it was opened from. */
watch(
  () => org.value.id,
  () => {
    topUpOpen.value = false;
    screen.topUpIssue.value = "";
  },
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Billing">
      <template #badge>
        <StatusBadge :detail="ORG_KIND_LABELS[kind]" :label="org.name" tone="neutral" />
      </template>
      <template #description>
        The wallet belongs to
        <span class="font-medium text-ink">{{ org.name }}</span>, so it pays for
        {{ held.length === 1 ? "its one project" : `all ${held.length} of its projects` }}.
        What the month is costing, and why, is <NuxtLink to="/usage">Usage</NuxtLink>.
      </template>
      <template #actions>
        <BillingAddCredit @click="topUpOpen = true" />
      </template>
    </PageHeader>

    <!-- Said once, at the top, because it is true of every figure below it. -->
    <InfoNote
      v-if="!store.running"
      :text="PAYMENTS_UNAVAILABLE"
      icon="material-symbols:warning-outline"
      tone="warning"
    />

    <!-- The answer first: what there is, what the month is taking, and whether anything is
         wrong with the payments. -->
    <FactGrid :columns="4" :facts="figures" label="The wallet" />

    <BillingPastDue v-if="repair" :repair="repair" @settle="screen.openPortal()" />

    <!-- The month, split the way the wallet pays it: one bill per project, summed above.
         `divided` off because the fact band above is already a boundary. -->
    <PageSection
      :description="chargesDescription"
      :divided="false"
      :title="`Charges for ${monthLabel}`"
      action="Open usage"
      to="/usage"
    >
      <RecordTable
        :columns="PROJECT_COLUMNS"
        :loading="usage.loading"
        framed
        label="Charges by project"
      >
        <li v-for="entry in projectCharges" :key="entry.project.id" class="record-row">
          <span class="record-cell record-cell--primary">
            <span class="truncate font-medium text-ink">{{ entry.project.name }}</span>
          </span>
          <span class="record-cell record-cell--end record-cell--half" data-label="Charged so far">
            <span class="font-mono text-ink tabular-nums">{{ formatCents(entry.actualCents) }}</span>
          </span>
          <span class="record-cell record-cell--end record-cell--half" data-label="Projected">
            <span class="font-mono text-ink/60 tabular-nums">
              {{ formatCents(entry.projectedCents) }}
            </span>
          </span>
        </li>

        <template v-if="projectCharges.length === 0" #empty>
          <p class="m-0 px-4 py-10 text-center text-xs leading-5 text-ink/55">
            No project under this organisation has metered anything this month.
          </p>
        </template>
      </RecordTable>
    </PageSection>

    <!-- `v-if` on the flag rather than left mounted: a Vuetify dialog that closes in the
         same flush as a store write leaves its teleported content on the page with its own
         model already false, and the only way out is a reload. -->
    <BillingTopUpDialog
      v-if="topUpOpen"
      v-model="topUpOpen"
      :balance="balance"
      :busy="screen.isBusy('topup')"
      :issue="screen.topUpIssue.value"
      :methods="methods"
      :state="store.checkoutFor(org.id)"
      @add-method="screen.openPortal()"
      @confirm="confirmTopUp"
    />
  </div>
</template>
