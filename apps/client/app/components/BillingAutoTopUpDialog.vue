<script setup lang="ts">
/**
 * The rule that keeps the balance from running out: when it falls under one amount, add
 * another.
 *
 * The switch is in the dialog and not only on the row behind it, because saving is what
 * arms the rule and a form that always wrote `enabled: true` could not be used to turn
 * one off. The method is named here too: a rule that charges "whichever card is the
 * default" changes what it charges when somebody else changes the default.
 *
 * Three things are said before the write. How often it would fire at this month's rate,
 * because a hundred dollars is a number and a hundred dollars every three days is the
 * decision somebody is actually making. Whether it would fire immediately, which it does
 * when the balance is already under the threshold, and that is a charge rather than a
 * safety net. And what a failed charge does, which is nothing to anybody's sign-in.
 */
import {
  AUTO_TOPUP_ISSUE_LABELS,
  type AutoTopUp,
  autoTopUpEffect,
  cardExpiryWords,
  cardLabel,
  formatCents,
  isCardExpired,
  MIN_TOPUP_CENTS,
  PAYMENTS_UNAVAILABLE,
  type PaymentMethod,
  topUpEveryWords,
  validateAutoTopUp,
} from "~/utils/billing";

/* Whether a card can be charged is the server's answer about this deployment. */
const billing = useBillingStore();

const props = defineProps<{
  setting: AutoTopUp;
  methods: readonly PaymentMethod[];
  defaultMethod: PaymentMethod | null;
  /** What there is now, so the dialog can say whether saving charges straight away. */
  balanceCents: number;
  /** What the month is on course to draw down, so the interval is this account's own. */
  projectedMonthCents: number;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [setting: AutoTopUp];
  addMethod: [];
}>();

const titleId = `${useId()}-title`;

/**
 * What "whichever is the default" is worth in the select.
 *
 * A sentinel rather than a null option: a select holding null among strings is a union the
 * template has to narrow at every use, and selecting null is the one case Vuetify's own
 * model handling is least predictable about. It is converted back to null in the draft,
 * which is what the store and `methodForAuto` read.
 */
const DEFAULT_METHOD = "__default__";

const enabled = ref(props.setting.enabled);
const threshold = ref(String(props.setting.thresholdCents / 100));
const amount = ref(String(props.setting.amountCents / 100));
const methodChoice = ref<string>(props.setting.methodId ?? DEFAULT_METHOD);
const methodId = computed<string | null>(() =>
  methodChoice.value === DEFAULT_METHOD ? null : methodChoice.value,
);
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

onMounted(() => {
  window.setTimeout(() => field.value?.focus(), 0);
});

/** Whole dollars in the fields, cents everywhere else. */
function cents(value: string): number {
  const dollars = Number(value.trim());
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : Number.NaN;
}

const draft = computed<AutoTopUp>(() => ({
  enabled: enabled.value,
  thresholdCents: cents(threshold.value),
  amountCents: cents(amount.value),
  methodId: methodId.value,
}));

/** Which method the rule would charge: the one named, or the account's default. */
const charged = computed(() => {
  if (methodId.value !== null) {
    return props.methods.find((entry) => entry.id === methodId.value) ?? null;
  }
  return props.defaultMethod;
});

const issue = computed(() => {
  if (!enabled.value) return "";
  if (!Number.isFinite(draft.value.thresholdCents) || !Number.isFinite(draft.value.amountCents)) {
    return "Two amounts, in whole dollars.";
  }
  const found = validateAutoTopUp(draft.value, charged.value !== null);
  if (found !== null) return AUTO_TOPUP_ISSUE_LABELS[found];
  if (charged.value !== null && isCardExpired(charged.value, new Date())) {
    return AUTO_TOPUP_ISSUE_LABELS.method_expired;
  }
  return "";
});

const effect = computed(() => autoTopUpEffect(draft.value, props.balanceCents));

const ready = computed(() => issue.value === "" && !props.busy);

const methodOptions = computed(() => [
  ...props.methods.map((entry) => ({
    value: entry.id,
    title: cardLabel(entry),
    subtitle: isCardExpired(entry, new Date())
      ? `${cardExpiryWords(entry)} and expired`
      : `${cardExpiryWords(entry)}${entry.isDefault ? " and the default" : ""}`,
  })),
  {
    value: DEFAULT_METHOD,
    title: "Whichever is the default",
    subtitle: props.defaultMethod
      ? `Today that is ${cardLabel(props.defaultMethod).toLowerCase()}`
      : "There is no default on the account",
  },
]);

function confirm() {
  if (!ready.value) return;
  emit("confirm", draft.value);
}
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="520">
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Automatic top-up</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A method is charged on its own when the balance runs low, so nothing stops for
            want of credit while nobody is looking.
          </p>
        </header>

        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5"
        >
          <label class="text-xs font-medium text-ink" for="auto-enabled">
            Top up automatically
          </label>
          <v-switch
            id="auto-enabled"
            v-model="enabled"
            color="primary"
            density="compact"
            hide-details
            inset
          />
        </div>

        <div :class="enabled ? '' : 'opacity-45'" class="flex flex-col gap-4 transition-opacity">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-ink" for="auto-threshold">
                When it falls under
              </label>
              <v-text-field
                id="auto-threshold"
                ref="field"
                v-model="threshold"
                :disabled="!enabled"
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
                :disabled="!enabled"
                :error="issue !== ''"
                class="font-mono"
                hide-details
                prefix="$"
                variant="filled"
              />
            </div>
          </div>

          <div v-if="methods.length > 0" class="flex flex-col gap-1">
            <label class="text-xs font-medium text-ink" for="auto-method">Charge</label>
            <!-- `item-props` rather than an `#item` slot: each option carries `title`,
                 `value` and `subtitle` and Vuetify passes the lot to the list item. -->
            <v-select
              id="auto-method"
              v-model="methodChoice"
              :disabled="!enabled"
              :items="methodOptions"
              hide-details
              item-props
              variant="filled"
            />
          </div>

          <p
            v-else
            class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/60"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-ink/45"
              name="material-symbols:credit-card-outline"
            />
            <span>
              There is no payment method on the account, so there is nothing for this rule
              to charge.
            </span>
          </p>
        </div>

        <p :class="issue ? 'text-error' : 'text-ink/55'" class="m-0 text-[11px] leading-4">
          <template v-if="issue">{{ issue }}</template>
          <template v-else-if="!enabled">
            Off. A balance that runs out stops SMS and leaves everything else owing, and no
            sign-in is refused either way.
          </template>
          <template v-else>
            {{ topUpEveryWords(draft.amountCents, projectedMonthCents) }} The smallest
            top-up is {{ formatCents(MIN_TOPUP_CENTS) }}.
          </template>
        </p>

        <!-- The case the note asks for by name: a threshold above what is already there
             means saving is a charge, now, and that has to be readable before the write. -->
        <p
          v-if="enabled && issue === '' && effect.firesNow"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/8 p-3 text-[11px] leading-4 text-warning"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
            name="material-symbols:warning-outline"
          />
          <span>
            The balance is {{ formatCents(balanceCents) }}, already under that, so saving
            this charges {{ formatCents(draft.amountCents) }} straight away and leaves
            {{ formatCents(effect.balanceAfterCents) }}.
          </span>
        </p>

        <p
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:info-outline"
          />
          <span>
            A failed charge does not stop a sign-in. It leaves the balance where it is and
            emails the billing address, so an expired method is a message rather than an
            outage.
            <template v-if="!billing.running">
              While no payment provider is connected, this rule is saved and never fires.
            </template>
          </span>
        </p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            :disabled="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            v-if="methods.length === 0 && enabled"
            append-icon="material-symbols:open-in-new"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="emit('addMethod')"
          >
            Add a method
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
            Save automatic top-up
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
