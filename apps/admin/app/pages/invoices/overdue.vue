<script setup lang="ts">
import type { OperatorInvoiceList } from "@idenzy/protocol/schemas/operator";

/**
 * Overdue invoices across every organisation (ADR-0019). Nothing stops an organisation over an
 * unpaid invoice; this list is where a person sees them and decides.
 */
const { data, error } = useOperatorApi()("/v1/operator/invoices/overdue")
  .get()
  .json<OperatorInvoiceList>();
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
</script>

<template>
  <section>
    <h1>Overdue invoices</h1>
    <p class="muted">Oldest first. Nothing acts on these automatically.</p>
    <p v-if="error" class="warn">Could not load overdue invoices.</p>
    <table v-else>
      <thead><tr><th>Organisation</th><th>Invoice</th><th>Amount</th><th>Due</th><th /></tr></thead>
      <tbody>
        <tr v-for="invoice in data?.invoices ?? []" :key="invoice.number">
          <td><NuxtLink :to="`/orgs/${invoice.orgId}`">{{ invoice.orgName }}</NuxtLink></td>
          <td><code>{{ invoice.number }}</code></td>
          <td>{{ money(invoice.totalCents) }}</td>
          <td class="warn">{{ invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : "—" }}</td>
          <td><a v-if="invoice.hostedUrl" :href="invoice.hostedUrl" rel="noopener" target="_blank">Open</a></td>
        </tr>
        <tr v-if="(data?.invoices ?? []).length === 0"><td class="muted" colspan="5">Nothing overdue.</td></tr>
      </tbody>
    </table>
  </section>
</template>
