<script setup lang="ts">
/**
 * Adds credit. Four amounts and a field, because most top-ups are one of four numbers and
 * the rest are a number somebody has in mind.
 *
 * What it says before it charges is what the balance turns into and roughly how long that
 * lasts, since the useful question about a prepaid balance is never the figure on its own.
 */
import {
  type Balance,
  cardLabel,
  formatCents,
  MIN_TOPUP_CENTS,
  type PaymentCard,
  runwayWords,
  TOPUP_ISSUE_LABELS,
  TOPUP_PRESETS_CENTS,
  validateTopUp,
} from "~/utils/billing";

const props = defineProps<{
  balance: Balance;
  card: PaymentCard | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [cents: number];
  addCard: [];
}>();

const chosen = ref<number>(TOPUP_PRESETS_CENTS[1] ?? MIN_TOPUP_CENTS);
const custom = ref("");

watch(open, (value) => {
  if (!value) return;
  chosen.value = TOPUP_PRESETS_CENTS[1] ?? MIN_TOPUP_CENTS;
  custom.value = "";
});

/** Whole dollars in the field, cents everywhere else. */
const cents = computed(() => {
  const typed = custom.value.trim();
  if (typed === "") return chosen.value;
  const dollars = Number(typed);
  return Number.isFinite(dollars) ? Math.round(dollars) * 100 : Number.NaN;
});

const issue = computed(() => {
  if (custom.value.trim() === "") return "";
  const found = validateTopUp(cents.value);
  return found === null ? "" : TOPUP_ISSUE_LABELS[found];
});

const ready = computed(() => props.card !== null && validateTopUp(cents.value) === null);

const after = computed<Balance>(() => ({
  ...props.balance,
  cents: props.balance.cents + (Number.isFinite(cents.value) ? cents.value : 0),
}));

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", cents.value);
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Top up</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Credit is drawn down as the month runs. There is nothing to cancel and nothing
            expires.
          </p>
        </header>

        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="preset in TOPUP_PRESETS_CENTS"
            :key="preset"
            :class="
              custom.trim() === '' && chosen === preset
                ? 'border-primary/50 bg-primary/8 text-ink'
                : 'border-line bg-canvas text-ink/70 hover:border-ink/20'
            "
            class="cursor-pointer rounded-(--idenzy-radius-small) border px-3 py-2 font-mono text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="
              chosen = preset;
              custom = '';
            "
          >
            {{ formatCents(preset) }}
          </button>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="topup-custom">Or an amount</label>
          <v-text-field
            id="topup-custom"
            v-model="custom"
            :error="issue !== ''"
            class="font-mono"
            hide-details
            placeholder="75"
            prefix="$"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ issue || `Whole dollars. The smallest top-up is ${formatCents(MIN_TOPUP_CENTS)}.` }}
          </p>
        </div>

        <div
          v-if="card"
          class="flex flex-col gap-1 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3"
        >
          <p class="m-0 flex items-baseline justify-between gap-3 text-xs">
            <span class="text-ink/60">Balance afterwards</span>
            <span class="font-mono text-ink tabular-nums">{{ formatCents(after.cents) }}</span>
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            {{ runwayWords(after) }} at this month's rate. Charged to
            {{ cardLabel(card).toLowerCase() }}.
          </p>
        </div>

        <p
          v-else
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:credit-card-outline"
          />
          <span>There is no card on file yet. Add one and this can charge it.</span>
        </p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            v-if="!card"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="emit('addCard')"
          >
            Add a card
          </v-btn>
          <v-btn
            v-else
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Add {{ formatCents(Number.isFinite(cents) ? cents : 0) }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
