<script setup lang="ts">
/**
 * The billing period, chosen beside the title and ahead of every figure it moves. A menu
 * and never a dialog (notes/usage.md): changing the month is reading, not deciding. Each
 * closed month carries its final total, so the expensive one can be found from here.
 */
import { formatCents } from "~/utils/billing";
import { billFor, periodLabel, type UsagePeriod } from "~/utils/usage";

const props = defineProps<{
  /** Newest first. */
  periods: readonly UsagePeriod[];
  loading?: boolean;
}>();

const model = defineModel<string>({ required: true });
const open = ref(false);

const chosen = computed(
  () => props.periods.find((period) => period.id === model.value) ?? props.periods[0] ?? null,
);
const label = computed(() => (chosen.value ? periodLabel(chosen.value) : "Billing period"));

function subtitle(period: UsagePeriod): string {
  return period.closed ? `${formatCents(billFor(period).totalCents)}, final` : "In progress";
}
</script>

<template>
  <v-btn
    :aria-label="`Billing period: ${label}`"
    :disabled="loading || periods.length === 0"
    append-icon="material-symbols:unfold-more"
    class="text-xs font-medium"
    color="neutral"
    prepend-icon="material-symbols:calendar-month-outline"
    size="small"
    variant="text"
  >
    {{ label }}

    <v-menu v-model="open" :offset="4" activator="parent" location="bottom end">
      <v-list min-width="240" nav>
        <v-list-item
          v-for="period in periods"
          :key="period.id"
          :active="period.id === model"
          :subtitle="subtitle(period)"
          :title="periodLabel(period)"
          @click="model = period.id"
        >
          <template v-if="period.id === model" #append>
            <Icon aria-hidden="true" class="text-base text-ink/70" name="material-symbols:check" />
          </template>
        </v-list-item>
      </v-list>
    </v-menu>
  </v-btn>
</template>
