<script setup lang="ts">
import type { OperatorMe, OperatorOrgBilling } from "@idenzy/protocol/schemas/operator";

/**
 * One organisation's billing (ADR-0019): how it pays, its balance or unbilled usage, and its
 * invoices — and, for billing staff, the one control that changes how it pays. The change needs a
 * reason and is recorded with the operator's name in `operator_actions`.
 */
const route = useRoute();
const orgId = computed(() => String(route.params["id"]));
const operator = useState<OperatorMe | null>("operator");
const canChange = computed(
  () => operator.value?.role === "billing" || operator.value?.role === "admin",
);

const api = useOperatorApi();
const { data, error, execute } = api(
  computed(() => `/v1/operator/orgs/${orgId.value}/billing`),
  {
    refetch: true,
  },
)
  .get()
  .json<OperatorOrgBilling>();

const mode = ref<"prepaid" | "invoiced">("prepaid");
const terms = ref(14);
const email = ref("");
const reason = ref("");
const saving = ref(false);
const saveError = ref<string | null>(null);
watch(data, (billing) => {
  if (billing === null) return;
  mode.value = billing.mode;
  terms.value = billing.invoiceTermsDays;
  email.value = billing.invoiceEmail ?? "";
});

const money = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

async function save() {
  saving.value = true;
  saveError.value = null;
  const { error: failed } = await api(`/v1/operator/orgs/${orgId.value}/billing`)
    .put({
      mode: mode.value,
      invoiceTermsDays: terms.value,
      invoiceEmail: mode.value === "invoiced" ? email.value : email.value || null,
      reason: reason.value,
    })
    .json();
  saving.value = false;
  if (failed.value !== null) {
    saveError.value = "Not saved. Check the terms, the invoice address and the reason.";
    return;
  }
  reason.value = "";
  await execute();
}
</script>

<template>
  <section v-if="error" class="warn">Could not load this organisation.</section>
  <section v-else-if="data">
    <p><NuxtLink to="/">← Organisations</NuxtLink></p>
    <h1>{{ data.org.name }}</h1>
    <p class="muted"><code>{{ data.org.id }}</code></p>

    <h2>How it pays</h2>
    <p v-if="data.balance.mode === 'prepaid'">
      Prepaid. Balance <strong>{{ money(data.balance.balanceCents) }}</strong>
      <span v-if="data.balance.pendingCents" class="muted">
        (includes {{ money(data.balance.pendingCents) }} not yet booked)</span>.
    </p>
    <p v-else>
      Invoiced, net {{ data.balance.invoiceTermsDays }} days, to {{ data.invoiceEmail }}.
      Unbilled <strong>{{ money(data.balance.unbilledCents) }}</strong>; outstanding
      {{ money(data.balance.outstandingCents) }},
      <span :class="data.balance.overdueCents > 0 ? 'warn' : ''">overdue {{ money(data.balance.overdueCents) }}</span>.
    </p>

    <form v-if="canChange" style="display: grid; gap: 8px; max-width: 460px; margin: 16px 0" @submit.prevent="save">
      <label>Mode
        <select v-model="mode">
          <option value="prepaid">Prepaid</option>
          <option value="invoiced">Invoiced</option>
        </select>
      </label>
      <label>Payment terms (days) <input v-model.number="terms" max="90" min="1" type="number" /></label>
      <label>Invoice address <input v-model="email" placeholder="ap@customer.com" type="email" /></label>
      <label>Reason (recorded with your name)
        <textarea v-model="reason" minlength="5" required rows="2" />
      </label>
      <p v-if="saveError" class="warn">{{ saveError }}</p>
      <button :disabled="saving" class="primary" type="submit">Save</button>
    </form>

    <h2>Invoices</h2>
    <table>
      <thead><tr><th>Number</th><th>Period</th><th>Amount</th><th>Status</th><th>Due</th><th /></tr></thead>
      <tbody>
        <tr v-for="invoice in data.invoices" :key="invoice.id">
          <td><code>{{ invoice.number }}</code></td>
          <td>{{ invoice.periodStart.slice(0, 7) }}</td>
          <td>{{ money(invoice.totalCents) }}</td>
          <td :class="invoice.status === 'past_due' ? 'warn' : ''">{{ invoice.status }}</td>
          <td class="muted">{{ invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString() : "—" }}</td>
          <td><a v-if="invoice.hostedUrl" :href="invoice.hostedUrl" rel="noopener" target="_blank">Open</a></td>
        </tr>
        <tr v-if="data.invoices.length === 0"><td class="muted" colspan="6">No invoices.</td></tr>
      </tbody>
    </table>
  </section>
</template>
