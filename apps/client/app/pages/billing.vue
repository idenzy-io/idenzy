<script setup lang="ts">
/**
 * The organisation's wallet: what it holds, what may charge it, what the month is costing
 * and what it has been invoiced (PROJECT.md 5.1, `orgs.billing_customer_id`,
 * notes/settings-billing.md).
 *
 * Its own screen rather than a settings tab, because money is its own task: the entity
 * being charged, the period, the amounts and the payment state are what a billing owner
 * arrives for, and none of it is a preference somebody sets. It is also the organisation's
 * rather than one project's, which is the scope finding all three settings notes open
 * with: one wallet pays for every project underneath, so the figure here is the whole bill
 * and the per-project split is shown rather than implied.
 *
 * Nothing can be charged. `PAYMENTS.running` is false, so the page says that before
 * anything else, Add credit is shown disabled with the reason beside it, and the store
 * refuses the write rather than adding cents to a ref. A balance that grew because
 * somebody pressed a button is precisely what the note forbids as proof of a payment.
 *
 * What the month has drawn down is the usage screen's bill, summed per project and never
 * recomputed: each project's lines are rounded once by `billFor` and the total is the sum
 * of those, which is the only way this screen, Usage and an invoice agree to the cent.
 */

import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  type AutoTopUp,
  alertReached,
  type Balance,
  BILLING_CURRENCY,
  BILLING_PORTAL_URL,
  CREDIT_KIND_LABELS,
  CREDIT_KIND_NOTES,
  CREDIT_KIND_TONES,
  cardExpiryWords,
  cardLabel,
  drawOrder,
  expiryWords,
  formatCents,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type Invoice,
  isCardExpired,
  isCardExpiringSoon,
  isGrantExpiringSoon,
  MIN_TOPUP_CENTS,
  methodForAuto,
  methodRemovalIssue,
  outstandingCents,
  PAYMENTS,
  type PaymentMethod,
  paymentRepair,
  runwayTone,
  runwayWords,
  type TopUpRequest,
  topUpEveryWords,
  walletOf,
  ZERO_KEEPS_WORKING,
  ZERO_STOPS,
} from "~/utils/billing";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { ORG_KIND_LABELS, ORG_LEGAL_NOTE, orgKindOf } from "~/utils/organisation";
import type { SetupBlocker } from "~/utils/setup-check";
import { formatDate } from "~/utils/time";
import { billFor, projectBill, ROUNDING_RULE } from "~/utils/usage";

const projects = useProjectStore();
const store = useBillingStore();
const usage = useUsageStore();
const members = useMembersStore();

const now = useNow({ interval: 60_000 });

const org = computed(() => projects.currentOrg);
const held = computed(() => projects.projectsOf(org.value.id));
const kind = computed(() => orgKindOf(members.forOrg(org.value.id).length));

const grants = computed(() => store.grantsFor(org.value.id));
const wallet = computed(() => walletOf(grants.value, now.value));
const methods = computed(() => store.methodsFor(org.value.id));
const autoTopUp = computed(() => store.autoTopUpFor(org.value.id));
const alert = computed(() => store.alertFor(org.value.id));
const invoices = computed(() => store.invoicesFor(org.value.id));
const lastSaved = computed(() => store.lastSavedAt(org.value.id));

/* The month's figures, read off each project's own bill rather than counted again, to the
   same hour, so this screen and Usage cannot be a cent apart. */
const asOf = computed(() => (usage.updatedAt ? new Date(usage.updatedAt) : now.value));

const projectCharges = computed(() =>
  held.value
    .map((project) => {
      const period = usage.forProject(project.id);
      return {
        project,
        actualCents: billFor(period).totalCents,
        projectedCents: projectBill(period, asOf.value).totalCents,
      };
    })
    .sort((left, right) => right.actualCents - left.actualCents),
);

const spentCents = computed(() =>
  projectCharges.value.reduce((total, entry) => total + entry.actualCents, 0),
);
const projectedCents = computed(() =>
  projectCharges.value.reduce((total, entry) => total + entry.projectedCents, 0),
);

const balance = computed<Balance>(() => ({
  cents: wallet.value.totalCents,
  currency: BILLING_CURRENCY,
  spentThisMonthCents: spentCents.value,
  projectedMonthCents: projectedCents.value,
}));

const owed = computed(() => outstandingCents(invoices.value));

/**
 * A failed payment takes the place of the runway rather than sitting beside it.
 *
 * An estimate of how long the credit lasts, printed above an invoice nobody paid, is the
 * optimistic reading the note asks to remove: what the reader needs is the repair.
 */
const repair = computed(() => paymentRepair(invoices.value));

const defaultMethod = computed(() => store.defaultMethodFor(org.value.id));
const autoMethod = computed(() => methodForAuto(autoTopUp.value, methods.value));
const alertTripped = computed(() => alertReached(alert.value, spentCents.value));

/** What is stopping a charge, which today is the whole integration. */
const blockers = computed<SetupBlocker[]>(() =>
  PAYMENTS.running
    ? []
    : [
        {
          id: "provider",
          title: "No payment provider is connected",
          detail: PAYMENTS.reason,
          action: "",
        },
      ],
);

function methodWarning(method: PaymentMethod): string {
  if (isCardExpired(method, now.value)) return "Expired. Nothing can charge it.";
  if (isCardExpiringSoon(method, now.value)) {
    return "Expires soon. A declined charge and an empty balance fail together and quietly.";
  }
  return "";
}

/*
 * Saving.
 */

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
 * Funding.
 */

const topUpOpen = ref(false);
const autoOpen = ref(false);
const alertOpen = ref(false);
const removing = ref<PaymentMethod | null>(null);

/** The refusal from the last attempt, shown in the dialog rather than swallowed. */
const topUpIssue = ref<string>("");

async function confirmTopUp(request: TopUpRequest) {
  await whileBusy("topup", async () => {
    const issue = await store.topUp(org.value.id, request);
    /* The dialog stays open on a refusal, with the reason: closing it would be the panel
       reporting a charge it did not make. */
    topUpIssue.value = issue === null ? "" : issue;
    if (issue === null) topUpOpen.value = false;
  });
}

/** The provider's hosted page, which is where a card number is taken, on their origin. */
function openPortal() {
  window.open(BILLING_PORTAL_URL, "_blank", "noopener");
}

async function confirmAuto(setting: AutoTopUp) {
  await whileBusy("auto", () => store.setAutoTopUp(org.value.id, setting));
  autoOpen.value = false;
}

function setAutoEnabled(enabled: boolean) {
  void whileBusy("auto", () => store.setAutoTopUp(org.value.id, { ...autoTopUp.value, enabled }));
}

function setAlertEnabled(enabled: boolean) {
  void whileBusy("alert", () => store.setAlert(org.value.id, { ...alert.value, enabled }));
}

function confirmAlert(dollars: number) {
  void whileBusy("alert", () =>
    store.setAlert(org.value.id, { ...alert.value, thresholdCents: dollars * 100 }),
  );
}

function makeDefault(id: string) {
  void whileBusy(id, () => store.setDefaultMethod(org.value.id, id));
}

const removalIssue = computed(() =>
  removing.value === null
    ? null
    : methodRemovalIssue(methods.value, removing.value.id, autoTopUp.value),
);

async function confirmRemoval() {
  const target = removing.value;
  if (target === null) return;
  await whileBusy(target.id, () => store.removeMethod(org.value.id, target.id));
  removing.value = null;
}

/* A dialog belongs to the organisation it was opened from. */
watch(
  () => org.value.id,
  () => {
    topUpOpen.value = false;
    autoOpen.value = false;
    alertOpen.value = false;
    removing.value = null;
    topUpIssue.value = "";
  },
);

/*
 * The credit the balance is made of.
 */

const GRANT_COLUMNS: readonly RecordColumn[] = [
  { key: "note", label: "Source", width: "minmax(0, 1.4fr)" },
  { key: "kind", label: "Kind", width: "minmax(0, 0.9fr)" },
  { key: "remaining", label: "Remaining", width: "minmax(0, 0.9fr)", align: "end" },
  { key: "expires", label: "Expires", width: "minmax(0, 1fr)", align: "end" },
];

/* In the order it is drawn down: promotional first and soonest to expire first, so the
   list reads as the queue it is rather than as an arbitrary sort. */
const spendQueue = computed(() => drawOrder(grants.value, now.value));

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
  "The card number, and every other payment method",
  "The legal entity and the billing address, which decide the tax",
  "The VAT or tax registration, and the reverse charge that follows from it",
  "Every receipt and invoice PDF",
];
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
    </PageHeader>

    <SetupBlockerCard
      v-if="blockers.length > 0"
      :blockers="blockers"
      description="Everything below is readable. Nothing below can take a payment."
      title="Before anything can be charged"
    />

    <!-- The answer first: what there is, and whether anything is wrong with the payments.
         A past-due invoice replaces the runway rather than sitting beside it. -->
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <LayerCard
        description="Credit is drawn down as the month runs. Promotional credit is spent first, because it is the part that can expire."
        title="Balance"
      >
        <template #badge>
          <StatusBadge
            v-if="repair"
            :label="`${formatCents(owed)} past due`"
            tone="error"
          />
          <StatusBadge v-else :label="runwayWords(balance)" :tone="runwayTone(balance)" />
        </template>

        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <p class="m-0 flex flex-col gap-1">
              <span
                :class="balance.cents <= 0 ? 'text-error' : 'text-ink'"
                class="font-mono text-3xl leading-none font-medium tracking-tight tabular-nums"
              >
                {{ formatCents(balance.cents, balance.currency) }}
              </span>
              <span class="text-xs text-ink/55">
                {{ formatCents(wallet.purchasedCents) }} purchased,
                {{ formatCents(wallet.promotionalCents) }} promotional
              </span>
            </p>

            <!-- Beside the balance, as the note asks, and full width on a phone. Disabled
                 with the reason rather than hidden: a missing funding control on a billing
                 screen reads as a fault in the page. -->
            <v-tooltip
              :disabled="PAYMENTS.running"
              :text="PAYMENTS.reason"
              location="top"
              max-width="320"
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="w-full sm:w-auto">
                  <FancyButton
                    :disabled="!PAYMENTS.running"
                    class="w-full sm:w-auto"
                    @click="topUpOpen = true"
                  >
                    <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                    Add credit
                  </FancyButton>
                </span>
              </template>
            </v-tooltip>
          </div>

          <p
            v-if="repair"
            class="m-0 flex flex-wrap items-center justify-between gap-3 rounded-(--idenzy-radius-small) border border-error/40 bg-error/6 px-3 py-2.5 text-[11px] leading-4 text-error"
          >
            <span class="flex min-w-0 items-start gap-2">
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm"
                name="material-symbols:error-outline"
              />
              <span>{{ repair }}</span>
            </span>
            <v-btn
              append-icon="material-symbols:open-in-new"
              class="flex-none text-xs font-medium"
              color="error"
              size="small"
              variant="outlined"
              @click="openPortal"
            >
              Settle it
            </v-btn>
          </p>

          <p
            v-else-if="wallet.expiringSoonCents > 0"
            class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/8 p-3 text-[11px] leading-4 text-warning"
          >
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm"
              name="material-symbols:schedule-outline"
            />
            <span>
              {{ formatCents(wallet.expiringSoonCents) }} of promotional credit expires
              soon. It is drawn down before anything purchased, so it is only lost if the
              month does not reach it.
            </span>
          </p>

          <div class="divide-y divide-line">
            <SettingRow
              :description="
                autoTopUp.enabled && autoMethod
                  ? `Adds ${formatCents(autoTopUp.amountCents)} when the balance falls under ${formatCents(autoTopUp.thresholdCents)}, charged to ${cardLabel(autoMethod).toLowerCase()}. ${topUpEveryWords(autoTopUp.amountCents, balance.projectedMonthCents)}`
                  : `Would add ${formatCents(autoTopUp.amountCents)} when the balance falls under ${formatCents(autoTopUp.thresholdCents)}. Off, a balance that runs out stops SMS and leaves the rest owing.`
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
                  :disabled="methods.length === 0 || isBusy('auto')"
                  :loading="isBusy('auto')"
                  :model-value="autoTopUp.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="setAutoEnabled($event === true)"
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
              <div class="flex items-center gap-2">
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="text"
                  @click="alertOpen = true"
                >
                  {{ formatCents(alert.thresholdCents) }}
                </v-btn>
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
              </div>
            </SettingRow>
          </div>
        </div>
      </LayerCard>

      <LayerCard
        description="What the month has drawn down, across every project this wallet pays for."
        title="This month"
      >
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-3">
            <Statistic
              :value="spentCents / 100"
              compare="so far this month"
              format="money"
              info="Charged by Idenzy across every project in this organisation. Each project's lines are rounded to the cent once and these are the sum of those totals, which is why this figure and the usage screen's agree."
              label="Charges so far"
              prefix="$"
            />
            <Statistic
              :value="projectedCents / 100"
              format="money"
              info="At the current average rate, continued to the end of the month. A straight line and not a forecast of what anybody will do."
              label="Projected"
              prefix="$"
            />
          </div>

          <div class="divide-y divide-line">
            <div
              v-for="entry in projectCharges"
              :key="entry.project.id"
              class="flex items-center justify-between gap-3 py-2 text-xs"
            >
              <span class="min-w-0 truncate text-ink/70">{{ entry.project.name }}</span>
              <span class="flex-none font-mono text-ink tabular-nums">
                {{ formatCents(entry.actualCents) }}
              </span>
            </div>
          </div>

          <p class="m-0 text-[11px] leading-4 text-ink/50">{{ ROUNDING_RULE }}</p>

          <v-btn
            append-icon="material-symbols:chevron-right"
            class="self-start text-xs font-medium"
            color="neutral"
            size="small"
            to="/usage"
            variant="outlined"
          >
            View usage
          </v-btn>
        </div>
      </LayerCard>
    </div>

    <!-- What the balance is actually made of, which is the question a single figure cannot
         answer: how much of it expires, and when. -->
    <LayerCard
      :padded="false"
      description="In the order it is spent: promotional credit first, and the soonest to expire before the rest."
      title="Credit"
    >
      <template #badge>
        <StatusBadge
          :label="`${formatCents(wallet.totalCents)} spendable`"
          tone="neutral"
        />
      </template>

      <div class="px-4 py-1">
        <RecordTable :columns="GRANT_COLUMNS" :loading="store.loading" framed label="Credit">
          <li v-for="grant in spendQueue" :key="grant.id" class="record-row">
            <span class="record-cell record-cell--primary">
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate text-ink">{{ grant.note }}</span>
                <span class="truncate text-[11px] text-ink/50">
                  Granted {{ formatDate(grant.grantedAt) }}
                </span>
              </span>
            </span>
            <span class="record-cell record-cell--half" data-label="Kind">
              <v-tooltip :text="CREDIT_KIND_NOTES[grant.kind]" location="top" max-width="300">
                <template #activator="{ props: tip }">
                  <span v-bind="tip">
                    <Tag
                      :label="CREDIT_KIND_LABELS[grant.kind]"
                      :tone="CREDIT_KIND_TONES[grant.kind]"
                    />
                  </span>
                </template>
              </v-tooltip>
            </span>
            <span class="record-cell record-cell--end record-cell--half" data-label="Remaining">
              <span class="font-mono text-ink tabular-nums">
                {{ formatCents(grant.remainingCents) }}
              </span>
              <span class="block text-[11px] text-ink/45">
                of {{ formatCents(grant.amountCents) }}
              </span>
            </span>
            <span class="record-cell record-cell--end" data-label="Expires">
              <span
                :class="isGrantExpiringSoon(grant, now) ? 'text-warning' : 'text-ink/60'"
                class="text-[11px]"
              >
                {{ expiryWords(grant, now) }}
              </span>
            </span>
          </li>

          <template v-if="spendQueue.length === 0" #empty>
            <EmptyState
              description="Credit appears here when it is bought or granted. A balance of nothing never stops a sign-in: what it stops is SMS, and anything metered above the free tier is owed rather than refused."
              icon="material-symbols:account-balance-wallet-outline"
              title="No credit on the account"
            />
          </template>
        </RecordTable>
      </div>
    </LayerCard>

    <!-- The methods, with the default called out: it is the one an unattended charge uses,
         so which it is has to be readable without opening anything. -->
    <LayerCard
      :padded="false"
      description="Added on the payment provider's own page, where the number is taken on their origin and never touches this one. Exactly one is the default, and that is the one anything automatic charges."
      title="Payment methods"
    >
      <template #actions>
        <v-btn
          append-icon="material-symbols:open-in-new"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="openPortal"
        >
          Add a method
        </v-btn>
      </template>

      <ul v-if="methods.length > 0" class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="method in methods"
          :key="method.id"
          class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5"
        >
          <span
            aria-hidden="true"
            class="flex size-8 items-center justify-center rounded-(--idenzy-radius-x-small) bg-ink/4 ring-1 ring-ink/6 ring-inset text-ink/60"
          >
            <Icon class="text-base" name="material-symbols:credit-card-outline" />
          </span>

          <div class="flex min-w-0 flex-col gap-1">
            <span class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="truncate text-sm font-medium text-ink">{{ cardLabel(method) }}</span>
              <Tag v-if="method.isDefault" label="Default" tone="chart-1" />
              <StatusBadge
                v-if="methodWarning(method)"
                :label="isCardExpired(method, now) ? 'Expired' : 'Expires soon'"
                :tone="isCardExpired(method, now) ? 'error' : 'warning'"
              />
            </span>
            <span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
              <span class="font-mono">{{ cardExpiryWords(method) }}</span>
              <span>Added by {{ method.addedBy }}</span>
              <span>{{ formatDate(method.addedAt) }}</span>
            </span>
            <span v-if="methodWarning(method)" class="text-[11px] leading-4 text-warning">
              {{ methodWarning(method) }}
            </span>
          </div>

          <v-menu :offset="4" location="bottom end">
            <template #activator="{ props: activator }">
              <button
                v-bind="activator"
                :aria-label="`Actions for ${cardLabel(method)}`"
                class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                type="button"
              >
                <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
              </button>
            </template>
            <v-list density="compact" min-width="240" nav>
              <v-list-item
                v-if="!method.isDefault"
                :disabled="isBusy(method.id)"
                prepend-icon="material-symbols:check-circle-outline"
                title="Make it the default"
                @click="makeDefault(method.id)"
              />
              <v-list-item
                :disabled="isBusy(method.id)"
                prepend-icon="material-symbols:delete-outline"
                title="Remove"
                @click="removing = method"
              />
              <v-list-item
                append-icon="material-symbols:open-in-new"
                prepend-icon="material-symbols:edit-outline"
                title="Manage at the provider"
                @click="openPortal"
              />
            </v-list>
          </v-menu>
        </li>
      </ul>

      <EmptyState
        v-else
        description="A method is added on the provider's hosted page and comes back here as a brand and four digits. Without one, nothing can be topped up by hand or automatically."
        icon="material-symbols:credit-card-outline"
        title="No payment method on the account"
      >
        <template #actions>
          <v-btn
            append-icon="material-symbols:open-in-new"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="openPortal"
          >
            Add a method
          </v-btn>
        </template>
      </EmptyState>
    </LayerCard>

    <LayerCard
      :padded="false"
      description="One a month for the whole organisation, raised from the closed month's metered lines. Every one has a PDF."
      title="Invoices"
    >
      <template #badge>
        <StatusBadge v-if="owed > 0" :label="`${formatCents(owed)} outstanding`" tone="warning" />
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
        empty-description="An invoice is raised at the end of a month with something on it. An organisation inside the free tier never gets one."
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

    <!-- Everything downstream of the charge is the payment provider's: the card number,
         the billing address that decides the tax, the registration and every receipt. A
         second implementation here would be a second thing to keep correct in two tax
         jurisdictions, so this is a link rather than a form. -->
    <LayerCard
      description="The methods, the billing address, the tax registration and every receipt live with our payment provider."
      expandable
      title="Billing details and tax"
    >
      <div class="flex flex-col gap-4">
        <p class="m-0 text-xs leading-5 text-ink/65">{{ ORG_LEGAL_NOTE }}</p>

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
          address or a tax id, which is why a method can be on file at all without this
          product inheriting somebody else's compliance problem.
        </p>
      </div>
    </LayerCard>

    <LayerCard
      description="The question everybody asks about a prepaid balance, answered before it is asked."
      expandable
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
        The first 50,000 monthly active users are free on every project and no security
        feature sits behind a tier: passkeys, multi-factor, custom domains and the audit
        trail cost nothing at any volume. The smallest top-up is
        {{ formatCents(MIN_TOPUP_CENTS) }}. Prices are the published ones in PROJECT.md 5.1
        rather than a contract, and a plan somebody signed wins over anything on this page.
      </p>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <!-- `v-if` on the flag rather than left mounted: a Vuetify dialog that closes in the
         same flush as a store write leaves its teleported content on the page with its own
         model already false, and the only way out is a reload. -->
    <BillingTopUpDialog
      v-if="topUpOpen"
      v-model="topUpOpen"
      :balance="balance"
      :busy="isBusy('topup')"
      :issue="topUpIssue"
      :methods="methods"
      :state="store.checkoutFor(org.id)"
      @add-method="openPortal"
      @confirm="confirmTopUp"
    />

    <BillingAutoTopUpDialog
      v-if="autoOpen"
      v-model="autoOpen"
      :balance-cents="balance.cents"
      :busy="isBusy('auto')"
      :default-method="defaultMethod"
      :methods="methods"
      :projected-month-cents="balance.projectedMonthCents"
      :setting="autoTopUp"
      @add-method="openPortal"
      @confirm="confirmAuto"
    />

    <NumberDialog
      v-if="alertOpen"
      v-model="alertOpen"
      :current="Math.round(alert.thresholdCents / 100)"
      :max="1_000_000"
      :min="1"
      confirm-label="Save the figure"
      description="An email to the billing address when the organisation's charges pass this in a month. It is an alert and never a cap: nothing is stopped and no sign-in is refused."
      integer-label="A whole number of dollars."
      label="Tell me above"
      prefix-hint=""
      range-label="Between $1 and $1,000,000."
      suffix="USD"
      title="Spend alert"
      @confirm="confirmAlert"
    />

    <BillingMethodRemoveDialog
      v-if="removing"
      :busy="removing !== null && isBusy(removing.id)"
      :issue="removalIssue"
      :method="removing"
      :model-value="removing !== null"
      :remaining="methods.length - 1"
      @confirm="confirmRemoval"
      @update:model-value="removing = null"
    />
  </div>
</template>
