<script setup lang="ts">
/**
 * The billing shell: the rail on the left, the screen it opened on the right.
 *
 * A parent route rather than one long page, for the same reason Settings is: every tab is
 * a URL, so an invoice somebody is asked about is a link to `/billing/invoices` and the
 * breadcrumb can say "Billing / Invoices" because the navigation tree names each one. The
 * one page this replaced put the balance, the credit, the methods, the invoices and two
 * folds of reference in a column, and a person who came to download a PDF scrolled past
 * everything they did not come for.
 *
 * Four screens, in the order a billing owner asks: what is the state (overview), what do
 * we have and what may add to it (wallet), what does it charge (payment methods), what
 * have we been billed (invoices). No page header here, because each screen owns its own:
 * the overview carries the funding control, the methods screen carries the way to the
 * provider, and the invoices screen carries its columns menu.
 *
 * Everything on these four is the organisation's rather than one project's, which the
 * rail says on each row: one wallet pays for every project underneath (PROJECT.md 5.1,
 * notes/settings-billing.md P1).
 */
import type { SettingsTab } from "~/components/SettingsTabs.vue";

const TABS: readonly SettingsTab[] = [
  {
    to: "/billing",
    title: "Overview",
    scope: "This month",
    icon: "material-symbols:receipt-long-outline",
  },
  {
    to: "/billing/wallet",
    title: "Wallet",
    scope: "Credit and funding",
    icon: "material-symbols:account-balance-wallet-outline",
  },
  {
    to: "/billing/methods",
    title: "Payment methods",
    scope: "At the provider",
    icon: "material-symbols:credit-card-outline",
  },
  {
    to: "/billing/invoices",
    title: "Invoices",
    scope: "One a month",
    icon: "material-symbols:description-outline",
  },
];
</script>

<template>
  <!-- The settings shell's grid, so the two rails read as one family: sticky under the
       56px app bar from `lg`, a strip above the content below it. -->
  <div class="grid gap-6 lg:grid-cols-[196px_minmax(0,1fr)] lg:items-start lg:gap-8">
    <div class="lg:sticky lg:top-20">
      <SettingsTabs :tabs="TABS" label="Billing" />
    </div>

    <div class="min-w-0">
      <NuxtPage />
    </div>
  </div>
</template>
