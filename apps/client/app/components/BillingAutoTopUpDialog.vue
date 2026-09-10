<script setup lang="ts">
/**
 * The rule that keeps the balance from running out: when it falls under one amount, add
 * another.
 *
 * Two fields and one sentence. The sentence is the point: a hundred dollars is a number,
 * and a hundred dollars about once every three days is the decision somebody is actually
 * making. It is computed from the month's own rate rather than described in general.
 *
 * The amount is refused when it is smaller than the threshold, because a top-up that
 * leaves the balance back under the trigger charges the card again immediately, and every
 * one of those is a fee. That rule lives in `~/utils/billing` with a test on it rather
 * than in this form.
 */
import {
  AUTO_TOPUP_ISSUE_LABELS,
  type AutoTopUp,
  formatCents,
  MIN_TOPUP_CENTS,
  topUpEveryWords,
  validateAutoTopUp,
} from "~/utils/billing";

const props = defineProps<{
  setting: AutoTopUp;
  hasCard: boolean;
  /** What the month is on course to draw down, so the interval is this project's own. */
  projectedMonthCents: number;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [setting: AutoTopUp];
}>();

const threshold = ref("");
const amount = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (!value) return;
  threshold.value = String(props.setting.thresholdCents / 100);
  amount.value = String(props.setting.amountCents / 100);
});

/** Whole dollars in the fields, cents everywhere else. */
function cents(value: string): number {
  const dollars = Number(value.trim());
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : Number.NaN;
}

const draft = computed<AutoTopUp>(() => ({
  enabled: true,
  thresholdCents: cents(threshold.value),
  amountCents: cents(amount.value),
}));

const issue = computed(() => {
  if (!Number.isFinite(draft.value.thresholdCents) || !Number.isFinite(draft.value.amountCents)) {
    return "Two amounts, in whole dollars.";
  }
  const found = validateAutoTopUp(draft.value, props.hasCard);
  return found === null ? "" : AUTO_TOPUP_ISSUE_LABELS[found];
});

const ready = computed(() => issue.value === "");

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", draft.value);
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Top up automatically</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            The card is charged on its own when the balance runs low, so nothing stops for
            want of credit while nobody is looking.
          </p>
        </header>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-ink" for="auto-threshold">
              When it falls under
            </label>
            <v-text-field
              id="auto-threshold"
              ref="field"
              v-model="threshold"
              class="font-mono"
              hide-details
              prefix="$"
              variant="filled"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-ink" for="auto-amount">Add</label>
            <v-text-field
              id="auto-amount"
              v-model="amount"
              :error="issue !== ''"
              class="font-mono"
              hide-details
              prefix="$"
              variant="filled"
            />
          </div>
        </div>

        <p :class="issue ? 'text-error' : 'text-ink/55'" class="m-0 text-[11px] leading-4">
          <template v-if="issue">{{ issue }}</template>
          <template v-else>
            {{ topUpEveryWords(draft.amountCents, projectedMonthCents) }} The smallest
            top-up is {{ formatCents(MIN_TOPUP_CENTS) }}.
          </template>
        </p>

        <p
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:info-outline"
          />
          <span>
            A failed charge does not stop a sign-in. It leaves the balance where it is and
            emails the billing address, so an expired card is a message rather than an
            outage.
          </span>
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
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Save the rule
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
