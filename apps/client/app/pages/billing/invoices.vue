<script setup lang="ts">
/**
 * What the organisation has been billed: one invoice a month, raised from the closed
 * month's metered lines, with its PDF on its own row (notes/settings-billing.md).
 *
 * An invoice is the organisation's, and its total is the sum of each project's own rounded
 * total for that month, never recomputed from combined meters. That is what keeps this
 * table, the usage screen and the billing overview one figure by construction.
 *
 * A past-due invoice is the one thing here that wants doing now, so it is a strip with its
 * repair above the table rather than a status buried in a column: the repair happens on
 * the provider's portal, and the row it names is below.
 */
import {
  formatCents,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONES,
  type Invoice,
  isPayable,
} from "~/utils/billing";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { formatDate } from "~/utils/time";

const screen = useBillingScreen();
const { store, org, invoices, owed, repair } = screen;

const INVOICE_COLUMNS: readonly DataTableColumn<Invoice>[] = [
  { key: "number", title: "Invoice", fixed: true, minWidth: 180, mono: true },
  { key: "periodStart", title: "Period", width: 200 },
  { key: "issuedAt", title: "Issued", width: 140 },
  { key: "dueAt", title: "Due", width: 140 },
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

/* A past-due invoice is settled on its own payment page, which takes a card or a bank
   transfer. Only a prepaid organisation's repair is a card on file, which is the portal. */
function settle() {
  const due = invoices.value.find((invoice) => invoice.status === "past_due" && isPayable(invoice));
  if (due?.hostedUrl) window.open(due.hostedUrl, "_blank", "noopener");
  else screen.openPortal();
}

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Invoices">
      <template #badge>
        <StatusBadge v-if="owed > 0" :label="`${formatCents(owed)} outstanding`" tone="warning" />
        <StatusBadge v-else label="Nothing outstanding" tone="success" />
      </template>
      <template #description>
        One a month for <span class="font-medium text-ink">{{ org.name }}</span> when it is
        billed by invoice, raised from the closed month's metered lines across every project and
        due on its payment terms. Each one can be paid by card or bank transfer from its own page.
      </template>
      <template #actions>
        <DataTableColumnsMenu v-model="columnState" :columns="INVOICE_COLUMNS" />
      </template>
    </PageHeader>

    <BillingPastDue v-if="repair" :repair="repair" @settle="settle()" />

    <v-card border flat>
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

        <template #cell.dueAt="{ item }">
          <span :class="item.status === 'past_due' ? 'text-error' : 'text-ink/70'">
            {{ item.dueAt ? formatDate(item.dueAt) : "—" }}
          </span>
        </template>

        <template #cell.totalCents="{ item }">
          <span class="font-mono text-ink tabular-nums">
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
          <v-btn
            v-if="isPayable(item)"
            :href="item.hostedUrl ?? undefined"
            class="mr-1 text-xs font-medium"
            color="primary"
            rel="noopener"
            size="small"
            target="_blank"
            variant="tonal"
          >
            Pay
          </v-btn>
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
    </v-card>
  </div>
</template>
