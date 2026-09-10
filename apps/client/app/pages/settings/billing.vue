<script setup lang="ts">
/**
 * What the account has to spend, how it is topped up, and what it has been invoiced
 * (PROJECT.md 5.1, `orgs.billing_customer_id`).
 *
 * The balance is prepaid, which is the model the app bar already shows, so the figure at
 * the top of this page and the figure in the bar are the same one. What makes a prepaid
 * balance readable is not the amount but how long it lasts, so the runway is beside it.
 *
 * What the month is drawing down is the usage screen's bill, read rather than recomputed.
 * Two screens reading the same meters twice would be two numbers to explain the day they
 * disagreed, and the meters belong to the screen that shows them.
 *
 * The rule this page exists to state is what a balance at zero does. It never stops a
 * sign-in: refusing to authenticate over an unpaid invoice takes a customer's product down
 * and their users with it. What stops is the traffic that costs money the moment it
 * leaves, which is the SMS spend cap's reasoning pointed the other way.
 */
import {
  AUTO_TOPUP_ISSUE_LABELS,
  type AutoTopUp,
  alertReached,
  type Balance,
  BILLING_PORTAL_URL,
  cardExpiryWords,
  cardLabel,
  formatCents,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type Invoice,
  isCardExpired,
  isCardExpiringSoon,
  MIN_TOPUP_CENTS,
  outstandingCents,
  runwayTone,
  runwayWords,
  topUpEveryWords,
  validateAutoTopUp,
  ZERO_KEEPS_WORKING,
  ZERO_STOPS,
} from "~/utils/billing";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { formatDate } from "~/utils/time";
import { billFor, periodProgress, projectedTotal } from "~/utils/usage";

const projects = useProjectStore();
const store = useBillingStore();
const usage = useUsageStore();

const now = useNow({ interval: 60_000 });

const card = computed(() => store.cardFor(projects.current.id));
const autoTopUp = computed(() => store.autoTopUpFor(projects.current.id));
const alert = computed(() => store.alertFor(projects.current.id));
const invoices = computed(() => store.invoicesFor(projects.current.id));
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/* The month's draw-down, read off the usage screen's bill rather than counted again. */
const period = computed(() => usage.forProject(projects.current.id));
const bill = computed(() => billFor(period.value));
const progress = computed(() => periodProgress(period.value, now.value));

const balance = computed<Balance>(() => ({
  cents: store.balanceFor(projects.current.id),
  currency: "USD",
  spentThisMonthCents: Math.round(bill.value.total * 100),
  projectedMonthCents: Math.round(projectedTotal(bill.value.total, progress.value) * 100),
}));

const owed = computed(() => outstandingCents(invoices.value));
const cardWarning = computed(() => {
  const held = card.value;
  if (held === null) return "";
  if (isCardExpired(held, now.value)) return "This card has expired. Nothing can charge it.";
  if (isCardExpiringSoon(held, now.value)) {
    return "This card expires soon. A declined charge and an empty balance fail together and quietly.";
  }
  return "";
});

const busy = ref<Set<string>>(new Set());
const saving = computed(() => busy.value.size > 0);

function isBusy(key: string): boolean {
  return busy.value.has(key);
}

async function whileBusy(key: string, work: () => Promise<void>) {
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

/*
 * Topping up.
 */

const topUpOpen = ref(false);
const autoOpen = ref(false);

async function confirmTopUp(cents: number) {
  await whileBusy("topup", () => store.topUp(projects.current.id, cents));
  topUpOpen.value = false;
}

/** The provider's hosted page. A card is added there and comes back on the next load. */
function openPortal() {
  window.open(BILLING_PORTAL_URL, "_blank", "noopener");
}

/*
 * The two settings.
 */

const autoIssue = computed(() => {
  const found = validateAutoTopUp(autoTopUp.value, card.value !== null);
  return found === null ? "" : AUTO_TOPUP_ISSUE_LABELS[found];
});

function setAuto(change: Partial<AutoTopUp>) {
  void whileBusy("auto", () =>
    store.setAutoTopUp(projects.current.id, { ...autoTopUp.value, ...change }),
  );
}

async function confirmAuto(setting: AutoTopUp) {
  await whileBusy("auto", () => store.setAutoTopUp(projects.current.id, setting));
  autoOpen.value = false;
}

function setAlertEnabled(enabled: boolean) {
  void whileBusy("alert", () => store.setAlert(projects.current.id, { ...alert.value, enabled }));
}

const alertTripped = computed(() => alertReached(alert.value, balance.value.spentThisMonthCents));

/*
 * Invoices.
 */

const INVOICE_COLUMNS: readonly DataTableColumn<Invoice>[] = [
  { key: "number", title: "Invoice", fixed: true, minWidth: 180, mono: true },
  { key: "periodStart", title: "Period", width: 200 },
  { key: "issuedAt", title: "Issued", width: 140 },
  { key: "totalCents", title: "Amount", width: 130, mono: true, align: "end" },
  { key: "status", title: "Status", width: 140, skeleton: "pill" },
];

const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.invoices.columns",
  defaultColumnState(INVOICE_COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(INVOICE_COLUMNS, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});

const sortBy = ref<DataTableSort[]>([{ key: "issuedAt", order: "desc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.invoices.page-size", 10);

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });

/** What is theirs rather than ours, said plainly so nobody looks for it here. */
const PORTAL_HOLDS = [
  "The card, and any other payment method",
  "The legal entity and the billing address, which decide the tax",
  "The VAT or tax registration, and the reverse charge that follows from it",
  "Every receipt and invoice PDF",
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:credit-card-outline" title="Billing">
      <template #description>
        What
        <span class="font-medium text-ink">{{ projects.current.name }}</span> has to spend
        and what it has been invoiced. What the month is costing, and why, is
        <NuxtLink to="/usage">Usage</NuxtLink>.
      </template>
      <template #actions>
        <FancyButton @click="topUpOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Top up
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <LayerCard
        description="Credit is drawn down as the month runs. Nothing expires and there is nothing to cancel."
        title="Balance"
      >
        <template #badge>
          <StatusBadge :label="runwayWords(balance)" :tone="runwayTone(balance)" />
        </template>

        <div class="flex flex-col gap-4">
          <p class="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              :class="balance.cents <= 0 ? 'text-error' : 'text-ink'"
              class="font-mono text-3xl leading-none font-medium tracking-tight tabular-nums"
            >
              {{ formatCents(balance.cents, balance.currency) }}
            </span>
            <span class="text-xs text-ink/55">
              {{ formatCents(balance.spentThisMonthCents) }} drawn down this month,
              {{ formatCents(balance.projectedMonthCents) }} projected
            </span>
          </p>

          <div class="divide-y divide-line">
            <SettingRow
              :description="
                card === null
                  ? 'Added on the payment provider\'s own page, where the number is taken on their origin and never touches this one.'
                  : `Added by ${card.addedBy}. What is stored here is a token, a brand and four digits; the number, the address and the tax registration are the provider's.`
              "
              label="Card on file"
            >
              <div class="flex items-center gap-2">
                <span v-if="card" class="flex items-center gap-2 text-xs text-ink">
                  <Icon
                    aria-hidden="true"
                    class="text-base text-ink/60"
                    name="material-symbols:credit-card-outline"
                  />
                  {{ cardLabel(card) }}
                  <span class="font-mono text-ink/50">{{ cardExpiryWords(card) }}</span>
                </span>
                <v-btn
                  append-icon="material-symbols:open-in-new"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="outlined"
                  @click="openPortal"
                >
                  {{ card ? "Manage" : "Add a card" }}
                </v-btn>
              </div>
            </SettingRow>

            <SettingRow
              :description="
                autoIssue ||
                (autoTopUp.enabled
                  ? `Adds ${formatCents(autoTopUp.amountCents)} when the balance falls under ${formatCents(autoTopUp.thresholdCents)}. ${topUpEveryWords(autoTopUp.amountCents, balance.projectedMonthCents)}`
                  : `Would add ${formatCents(autoTopUp.amountCents)} when the balance falls under ${formatCents(autoTopUp.thresholdCents)}. Off, a balance that runs out stops SMS and leaves the rest owing.`)
              "
              label="Top up automatically"
            >
              <div class="flex items-center gap-2">
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:tune"
                  size="small"
                  variant="outlined"
                  @click="autoOpen = true"
                >
                  Configure
                </v-btn>
                <v-switch
                  aria-label="Top up automatically"
                  :disabled="card === null || isBusy('auto')"
                  :loading="isBusy('auto')"
                  :model-value="autoTopUp.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="setAuto({ enabled: $event === true })"
                />
              </div>
            </SettingRow>

            <SettingRow
              :description="
                alertTripped
                  ? `This month has already passed ${formatCents(alert.thresholdCents)}. An alert and never a cap: the lever that would stop the spend is refusing to sign somebody in, and that is not a lever we have.`
                  : `Emails the billing address when the month passes ${formatCents(alert.thresholdCents)}. An alert and never a cap, because the only way to stop the spend would be to stop authenticating people.`
              "
              label="Tell me when the month passes a figure"
            >
              <v-switch
                aria-label="Spend alert"
                :disabled="isBusy('alert')"
                :loading="isBusy('alert')"
                :model-value="alert.enabled"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setAlertEnabled($event === true)"
              />
            </SettingRow>
          </div>

          <p
            v-if="cardWarning"
            class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/8 p-3 text-[11px] leading-4 text-warning"
          >
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm"
              name="material-symbols:warning-outline"
            />
            <span>{{ cardWarning }}</span>
          </p>
        </div>
      </LayerCard>

      <!-- Everything downstream of the charge is the payment provider's: the card number,
           the billing address that decides the tax, the registration and every receipt.
           A second implementation here would be a second thing to keep correct in two tax
           jurisdictions, so this is a link rather than a form. -->
      <LayerCard
        description="The card, the billing address, the tax registration and every receipt live with our payment provider."
        title="Invoice details"
      >
        <div class="flex flex-col gap-3">
          <ul class="m-0 flex list-none flex-col gap-2 p-0 text-[11px] leading-4 text-ink/60">
            <li v-for="item in PORTAL_HOLDS" :key="item" class="flex items-start gap-2">
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm text-ink/40"
                name="material-symbols:arrow-outward"
              />
              <span>{{ item }}</span>
            </li>
          </ul>
          <v-btn
            append-icon="material-symbols:open-in-new"
            class="self-start text-xs font-medium"
            color="neutral"
            size="small"
            variant="outlined"
            @click="openPortal"
          >
            Open the billing portal
          </v-btn>
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            It opens on their origin. Nothing on this page has ever held a card number, an
            address or a tax id, which is why a card can be on file at all without this
            product inheriting somebody else's compliance problem.
          </p>
        </div>
      </LayerCard>
    </div>

    <LayerCard
      :padded="false"
      description="One a month, for the metered lines above the free tier. Every one has a PDF."
      title="Invoices"
    >
      <template #badge>
        <StatusBadge
          v-if="owed > 0"
          :label="`${formatCents(owed)} outstanding`"
          tone="warning"
        />
        <StatusBadge v-else label="Nothing outstanding" tone="success" />
      </template>
      <template #actions>
        <DataTableColumnsMenu v-model="columnState" :columns="INVOICE_COLUMNS" />
      </template>

      <DataTable
        v-model:column-state="columnState"
        v-model:items-per-page="pageSize"
        v-model:page="page"
        v-model:sort-by="sortBy"
        :columns="INVOICE_COLUMNS"
        :items="invoices"
        :loading="store.loading"
        empty-description="An invoice is raised at the end of a month with something on it. A project inside the free tier never gets one."
        empty-title="No invoices yet"
        item-value="id"
        label="Invoices"
      >
        <template #cell.periodStart="{ item }">
          <span class="text-ink/70">{{ MONTH.format(new Date(item.periodStart)) }}</span>
        </template>

        <template #cell.issuedAt="{ item }">
          <span class="text-ink/70">{{ formatDate(item.issuedAt) }}</span>
        </template>

        <template #cell.totalCents="{ item }">
          <span class="font-mono tabular-nums text-ink">
            {{ formatCents(item.totalCents, item.currency) }}
          </span>
        </template>

        <template #cell.status="{ item }">
          <StatusBadge
            :label="INVOICE_STATUS_LABELS[item.status]"
            :tone="INVOICE_STATUS_TONES[item.status]"
          />
        </template>

        <template #actions="{ item }">
          <v-tooltip location="top" text="The invoice as a PDF">
            <template #activator="{ props: tip }">
              <a
                v-bind="tip"
                :aria-label="`Download ${item.number}`"
                :href="item.pdfUri ?? '#'"
                class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                rel="noopener"
                target="_blank"
              >
                <Icon aria-hidden="true" class="text-base" name="material-symbols:download" />
              </a>
            </template>
          </v-tooltip>
        </template>
      </DataTable>
    </LayerCard>

    <LayerCard
      description="The question everybody asks about a prepaid balance, answered before it is asked."
      title="What happens at zero"
    >
      <div class="grid gap-6 lg:grid-cols-2">
        <section class="flex flex-col gap-3">
          <h3 class="m-0 flex items-center gap-2 text-xs font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-base text-success"
              name="material-symbols:check-circle-outline"
            />
            Keeps working, whatever is owed
          </h3>
          <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
            <li v-for="rule in ZERO_KEEPS_WORKING" :key="rule.what" class="flex flex-col gap-0.5">
              <span class="text-[11px] font-medium text-ink">{{ rule.what }}</span>
              <span class="text-[11px] leading-4 text-ink/55">{{ rule.why }}</span>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-3">
          <h3 class="m-0 flex items-center gap-2 text-xs font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-base text-warning"
              name="material-symbols:pause-circle-outline"
            />
            Stops, or accrues
          </h3>
          <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
            <li v-for="rule in ZERO_STOPS" :key="rule.what" class="flex flex-col gap-0.5">
              <span class="text-[11px] font-medium text-ink">{{ rule.what }}</span>
              <span class="text-[11px] leading-4 text-ink/55">{{ rule.why }}</span>
            </li>
          </ul>
        </section>
      </div>

      <p class="m-0 mt-4 border-t border-line pt-3 text-[11px] leading-4 text-ink/55">
        Fifty thousand monthly active users are free on every project, forever, and no
        security feature is behind a tier: passkeys, MFA, custom domains and the audit trail
        cost nothing at any volume. The smallest top-up is
        {{ formatCents(MIN_TOPUP_CENTS) }}.
      </p>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <BillingTopUpDialog
      v-model="topUpOpen"
      :balance="balance"
      :busy="isBusy('topup')"
      :card="card"
      @add-card="openPortal"
      @confirm="confirmTopUp"
    />
    <BillingAutoTopUpDialog
      v-model="autoOpen"
      :busy="isBusy('auto')"
      :has-card="card !== null"
      :projected-month-cents="balance.projectedMonthCents"
      :setting="autoTopUp"
      @confirm="confirmAuto"
    />
  </div>
</template>
