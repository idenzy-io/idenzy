<script setup lang="ts">
/**
 * The cards on file, with the default called out, and the things about the account that
 * live with the payment provider rather than here.
 *
 * The default is the one an unattended charge uses, so which it is has to be readable
 * without opening anything: the badge beside the title names it, and the row wears a tag.
 * Exactly one is the default, moved in a single change, and the last method cannot go
 * while an automatic top-up is armed (`methodRemovalIssue`), because an armed rule with
 * nothing to charge stops firing without anybody switching it off.
 *
 * The card is never ours to see. A method is added on the provider's hosted page, on their
 * origin, and comes back as a token, a brand and four digits. So is everything downstream
 * of the charge: the legal entity, the address that decides the tax, the registration and
 * every receipt. A second implementation here would be a second thing to keep correct in
 * two tax jurisdictions, which is why the fold at the foot is four facts and a link rather
 * than a form.
 */
import type { Fact } from "~/components/FactGrid.vue";
import type { RecordColumn } from "~/components/RecordTable.vue";
import { cardExpiryWords, cardLabel, isCardExpired, type PaymentMethod } from "~/utils/billing";
import { ORG_LEGAL_NOTE } from "~/utils/organisation";
import { formatDate } from "~/utils/time";

const screen = useBillingScreen();
const { store, now, org, methods, lastSaved, defaultMethod, methodWarning, saving, isBusy } =
  screen;

const METHOD_COLUMNS: readonly RecordColumn[] = [
  { key: "method", label: "Method", width: "minmax(0, 1.6fr)" },
  { key: "expires", label: "Expires", width: "minmax(0, 0.9fr)" },
  { key: "added", label: "Added", width: "minmax(0, 1.2fr)" },
  { key: "actions", label: "", width: "48px", align: "end" },
];

/*
 * Removing one.
 */

const removing = ref<PaymentMethod | null>(null);

const removalIssue = computed(() =>
  removing.value === null ? null : screen.removalIssue(removing.value),
);

async function confirmRemoval() {
  const target = removing.value;
  if (target === null) return;
  await screen.removeMethod(target.id);
  removing.value = null;
}

/* A dialog belongs to the organisation it was opened from. */
watch(
  () => org.value.id,
  () => {
    removing.value = null;
  },
);

/*
 * What is the provider's rather than ours, folded because nobody reads it twice.
 */

const detailsOpen = ref(false);

const portalFacts = computed<Fact[]>(() => [
  {
    key: "entity",
    label: "Billed entity",
    value: org.value.name,
    note: "Legal name at the provider",
    info: ORG_LEGAL_NOTE,
  },
  {
    key: "numbers",
    label: "Card numbers",
    value: "Never held here",
    note: "A brand and four digits come back",
    info: "A method is added on the provider's hosted page, where the number is taken on their origin. What this panel holds is a token, a brand and four digits, which is all that can be shown and all that is worth storing.",
  },
  {
    key: "tax",
    label: "Address and tax",
    value: "At the provider",
    note: "VAT registration, reverse charge",
    info: "The billing address decides which tax applies and the registration decides whether it is reverse-charged. Both live with the provider, so there is one place to get them right in two jurisdictions.",
  },
  {
    key: "receipts",
    label: "Receipts",
    value: "Every invoice",
    note: "As a PDF, from the portal",
    info: "Every receipt and invoice PDF is issued by the provider. The invoices tab links to each one.",
  },
]);
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Payment methods">
      <template #badge>
        <StatusBadge
          v-if="defaultMethod"
          :label="cardLabel(defaultMethod)"
          detail="default"
          tone="neutral"
        />
        <StatusBadge v-else label="No method on file" tone="warning" />
      </template>
      <template #description>
        What <span class="font-medium text-ink">{{ org.name }}</span> is charged on. Added on
        the provider's own page, where the number is taken on their origin and never touches
        this one. Exactly one is the default, and that is the one anything automatic charges.
      </template>
      <template #actions>
        <v-btn
          append-icon="material-symbols:open-in-new"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="screen.openPortal()"
        >
          Add a Method
        </v-btn>
      </template>
    </PageHeader>

    <RecordTable :columns="METHOD_COLUMNS" :loading="store.loading" framed label="Payment methods">
      <li v-for="method in methods" :key="method.id" class="record-row">
        <span class="record-cell record-cell--primary">
          <span class="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              class="flex size-8 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) bg-ink/4 text-ink/60 ring-1 ring-ink/6 ring-inset"
            >
              <Icon class="text-base" name="material-symbols:credit-card-outline" />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="flex min-w-0 flex-wrap items-center gap-2">
                <span class="truncate font-medium text-ink">{{ cardLabel(method) }}</span>
                <Tag v-if="method.isDefault" label="Default" tone="chart-1" />
              </span>
              <span v-if="methodWarning(method)" class="text-[11px] leading-4 text-warning">
                {{ methodWarning(method) }}
              </span>
            </span>
          </span>
        </span>

        <span class="record-cell record-cell--half" data-label="Expires">
          <StatusBadge
            v-if="methodWarning(method)"
            :detail="cardExpiryWords(method)"
            :label="isCardExpired(method, now) ? 'Expired' : 'Soon'"
            :tone="isCardExpired(method, now) ? 'error' : 'warning'"
          />
          <span v-else class="font-mono text-ink/70">{{ cardExpiryWords(method) }}</span>
        </span>

        <span class="record-cell record-cell--half text-ink/60" data-label="Added">
          <span class="truncate">{{ method.addedBy }} · {{ formatDate(method.addedAt) }}</span>
        </span>

        <span class="record-cell record-cell--end record-cell--action">
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
                @click="screen.makeDefault(method.id)"
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
                @click="screen.openPortal()"
              />
            </v-list>
          </v-menu>
        </span>
      </li>

      <template v-if="!store.loading && methods.length === 0" #empty>
        <EmptyState
          description="A method is added on the provider's hosted page and comes back here as a brand and four digits. Without one, nothing can be topped up by hand or automatically."
          icon="material-symbols:credit-card-outline"
          title="No payment method on the account"
        >
          <template #actions>
            <v-btn
              append-icon="material-symbols:open-in-new"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="screen.openPortal()"
            >
              Add a method
            </v-btn>
          </template>
        </EmptyState>
      </template>
    </RecordTable>

    <!-- Everything a customer cannot act on here, folded, with the portal beside the
         heading so a shut section still offers the way out. -->
    <PageSection
      v-model:open="detailsOpen"
      :description="ORG_LEGAL_NOTE"
      :summary="`Held by the payment provider · ${org.name} · card, address, tax registration and receipts`"
      foldable
      title="Billing details and tax"
    >
      <template #actions>
        <v-btn
          append-icon="material-symbols:open-in-new"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="screen.openPortal()"
        >
          Open the billing portal
        </v-btn>
      </template>

      <FactGrid :columns="4" :facts="portalFacts" label="Billing details" />

      <InfoNote icon="material-symbols:lock-outline">
        The portal opens on their origin. Nothing on this page has ever held a card number, an
        address or a tax id, which is why a method can be on file at all without this product
        inheriting somebody else's compliance problem.
      </InfoNote>
    </PageSection>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

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
