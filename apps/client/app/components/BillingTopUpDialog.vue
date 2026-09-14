<script setup lang="ts">
/**
 * Adds credit: four amounts and a field, the method it charges, and what the balance
 * turns into.
 *
 * The steps are the note's, in its order: an amount, the currency, the method, the total
 * being charged and the balance afterwards. The method is a choice rather than an
 * assumption, because an account can hold several and a charge landing on a different
 * card from the one the reader had in mind is the one mistake here nobody forgives.
 *
 * The footer names the outcome, "Add $50.00 credit" and not "Add", because the button is
 * the last thing read before money moves (notes/dialogs.md).
 *
 * It does not close on its own. A refusal comes back as `issue` and stays on screen with
 * the amount still typed: a dialog that closed cleanly would be the only evidence the
 * reader gets, and while no provider is connected that evidence would be false.
 */
import {
  type Balance,
  BILLING_CURRENCY,
  CHECKOUT_STATE_LABELS,
  CHECKOUT_STATE_NOTES,
  type CheckoutState,
  cardExpiryWords,
  cardLabel,
  defaultMethodOf,
  formatCents,
  isCardExpired,
  isCheckoutPending,
  MIN_TOPUP_CENTS,
  type PaymentMethod,
  runwayWords,
  TOPUP_ISSUE_LABELS,
  TOPUP_PRESETS_CENTS,
  type TopUpIssue,
  type TopUpRequest,
  validateTopUp,
} from "~/utils/billing";

/* Whether a card can be charged is the server's answer about this deployment. */
const billing = useBillingStore();

const props = defineProps<{
  balance: Balance;
  methods: readonly PaymentMethod[];
  busy: boolean;
  /** Where the last attempt got to, so a pending charge is not offered twice. */
  state: CheckoutState;
  /** The refusal from the last attempt, or empty. */
  issue: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [request: TopUpRequest];
  addMethod: [];
}>();

const titleId = `${useId()}-title`;

const chosen = ref<number>(TOPUP_PRESETS_CENTS[1] ?? MIN_TOPUP_CENTS);
const custom = ref("");
const methodId = ref<string | null>(defaultMethodOf(props.methods)?.id ?? null);

/** Whole dollars in the field, cents everywhere else. */
const cents = computed(() => {
  const typed = custom.value.trim();
  if (typed === "") return chosen.value;
  const dollars = Number(typed);
  return Number.isFinite(dollars) ? Math.round(dollars) * 100 : Number.NaN;
});

const amountIssue = computed(() => {
  if (custom.value.trim() === "") return "";
  const found = validateTopUp(cents.value);
  return found === null ? "" : TOPUP_ISSUE_LABELS[found];
});

const method = computed(() => props.methods.find((entry) => entry.id === methodId.value) ?? null);

const now = new Date();

/** What stops the charge, in the order the reader can do something about it. */
const blocker = computed<TopUpIssue | null>(() => {
  const amount = validateTopUp(cents.value);
  if (amount !== null) return amount;
  if (method.value === null) return "no_method";
  return billing.running ? null : "unavailable";
});

const ready = computed(
  () => blocker.value === null && !props.busy && !isCheckoutPending(props.state),
);

const after = computed<Balance>(() => ({
  ...props.balance,
  cents: props.balance.cents + (Number.isFinite(cents.value) ? cents.value : 0),
}));

const methodOptions = computed(() =>
  props.methods.map((entry) => ({
    value: entry.id,
    title: cardLabel(entry),
    subtitle: isCardExpired(entry, now)
      ? `${cardExpiryWords(entry)} and expired`
      : `${cardExpiryWords(entry)}${entry.isDefault ? " and the default" : ""}`,
  })),
);

function confirm() {
  if (!ready.value) return;
  emit("confirm", {
    amountCents: cents.value,
    currency: BILLING_CURRENCY,
    methodId: methodId.value,
  });
}
</script>

<template>
  <v-dialog v-model="open" :persistent="busy" max-width="480">
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Add credit</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Credit is drawn down as the month runs. Promotional credit is spent before
            anything purchased, because it is the part that can expire.
          </p>
        </header>

        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="preset in TOPUP_PRESETS_CENTS"
            :key="preset"
            :class="
              custom.trim() === '' && chosen === preset
                ? 'border-primary/50 bg-primary/8 text-ink'
                : 'border-line bg-ink/4 text-ink/70 hover:border-ink/20'
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
            :error="amountIssue !== ''"
            :suffix="BILLING_CURRENCY"
            class="font-mono"
            hide-details
            placeholder="75"
            prefix="$"
            variant="filled"
          />
          <p
            :class="amountIssue ? 'text-error' : 'text-ink/50'"
            class="m-0 text-[11px] leading-4"
          >
            {{
              amountIssue ||
              `Whole dollars. The account is held in ${BILLING_CURRENCY}, which is set at the provider, and the smallest top-up is ${formatCents(MIN_TOPUP_CENTS)}.`
            }}
          </p>
        </div>

        <div v-if="methods.length > 0" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="topup-method">Charge</label>
          <!-- `item-props` rather than an `#item` slot: each option carries `title`,
               `value` and `subtitle`, and Vuetify passes the lot to the list item, so the
               expiry and which one is the default are read without reaching into the
               slot's raw item. -->
          <v-select
            id="topup-method"
            v-model="methodId"
            :items="methodOptions"
            hide-details
            item-props
            variant="filled"
          />
        </div>

        <!-- The total and the balance afterwards, which is the pair the note asks for: an
             amount on its own does not say what it buys. -->
        <div
          class="flex flex-col gap-1.5 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3"
        >
          <p class="m-0 flex items-baseline justify-between gap-3 text-xs">
            <span class="text-ink/60">Charged now</span>
            <span class="font-mono text-ink tabular-nums">
              {{ formatCents(Number.isFinite(cents) ? cents : 0) }}
            </span>
          </p>
          <p class="m-0 flex items-baseline justify-between gap-3 text-xs">
            <span class="text-ink/60">Balance afterwards</span>
            <span class="font-mono text-ink tabular-nums">{{ formatCents(after.cents) }}</span>
          </p>
          <p v-if="method" class="m-0 text-[11px] leading-4 text-ink/55">
            {{ runwayWords(after) }} at this month's rate. Charged to
            {{ cardLabel(method).toLowerCase() }}.
          </p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
            There is no payment method on the account yet. Add one and this can charge it.
          </p>
        </div>

        <!-- The state of the attempt. A charge can be in flight, need the cardholder at
             their bank, or have failed after being accepted, and a dialog that only knew
             "busy" would report the same thing for all three. -->
        <p
          v-if="issue || state === 'unavailable' || isCheckoutPending(state) || state === 'failed'"
          :class="
            issue || state === 'failed' || state === 'unavailable' ? 'text-error' : 'text-ink/70'
          "
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3 text-[11px] leading-4"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
            :name="
              isCheckoutPending(state)
                ? 'material-symbols:hourglass-top-outline'
                : 'material-symbols:error-outline'
            "
          />
          <span>
            <span class="font-medium">{{ CHECKOUT_STATE_LABELS[state] }}.</span>
            {{ issue ? TOPUP_ISSUE_LABELS[issue as TopUpIssue] ?? issue : CHECKOUT_STATE_NOTES[state] }}
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
            v-if="methods.length === 0"
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
            Add {{ formatCents(Number.isFinite(cents) ? cents : 0) }} credit
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
