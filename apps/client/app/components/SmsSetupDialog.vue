<script setup lang="ts">
/**
 * Set up SMS: the guided transaction that replaced "Create a policy".
 *
 * The old button created the row with its column defaults and left the project exactly as
 * unable to send as before, because the allowlist was still empty and nothing said so
 * (notes/sms-policy.md P1). A row is a database step, not a decision; what an operator is
 * actually doing here is settling three things and reading a fourth, so the dialog asks
 * for all three and writes the row once.
 *
 * Countries first, because it is the only one with no safe default: the list starts empty
 * on purpose and choosing for somebody is choosing what they will pay for. The cap and the
 * human check carry the column's own defaults, which are safe in the direction that
 * matters. Delivery is a step that asks nothing, because it is settled on another screen
 * and the honest thing is to say what was found and let it be finished later: a policy
 * written today is still worth writing while the carrier account is half wired.
 */
import type { Step } from "~/components/Steps.vue";
import type { SmsPolicyDraft } from "~/stores/sms-policy";
import { countryFlag, countryName } from "~/utils/sessions";
import {
  allCountries,
  formatMoney,
  SMS_POLICY_BOUNDS,
  SMS_POLICY_DEFAULTS,
} from "~/utils/sms-policy";

const props = defineProps<{
  projectName: string;
  /** How SMS leaves, as the providers screen settled it. Read, never set here. */
  delivery: { ready: boolean; label: string };
  /** Whether anything on this deployment can answer an attestation. */
  attestationWired: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [draft: SmsPolicyDraft];
}>();

type StepId = "countries" | "cap" | "human" | "delivery";

const STEPS: readonly Step[] = [
  { id: "countries", label: "Countries" },
  { id: "cap", label: "Daily cap" },
  { id: "human", label: "Human check" },
  { id: "delivery", label: "Delivery" },
];

const step = ref<StepId>("countries");
const titleId = `${useId()}-title`;

const COUNTRIES = allCountries((code) => countryName(code) ?? code);

const chosen = ref<Set<string>>(new Set());
const query = ref("");
const capText = ref(String(SMS_POLICY_DEFAULTS.dailySpendCap));
const attestation = ref(SMS_POLICY_DEFAULTS.attestationRequired);

watch(open, (value) => {
  if (!value) return;
  step.value = "countries";
  chosen.value = new Set();
  query.value = "";
  capText.value = String(SMS_POLICY_DEFAULTS.dailySpendCap);
  attestation.value = SMS_POLICY_DEFAULTS.attestationRequired;
});

const listed = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle === "") return COUNTRIES;
  return COUNTRIES.filter(
    (country) =>
      country.name.toLowerCase().includes(needle) || country.code.toLowerCase() === needle,
  );
});

function toggle(code: string) {
  const next = new Set(chosen.value);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  chosen.value = next;
}

const cap = computed(() => Number(capText.value.trim()));

const capIssue = computed(() => {
  if (capText.value.trim() === "" || !Number.isInteger(cap.value)) {
    return "A cap is a whole number of currency units.";
  }
  const { min, max } = SMS_POLICY_BOUNDS.dailySpendCap;
  return cap.value < min || cap.value > max ? `Between ${min} and ${max}.` : "";
});

/* The unmet requirement beside the control rather than a disabled button nobody can
   explain (notes/layout-blueprint.md). */
const blocked = computed(() => {
  if (step.value === "countries" && chosen.value.size === 0) {
    return "Choose at least one country. A policy allowing nowhere sends nothing.";
  }
  if (step.value === "cap" && capIssue.value !== "") return capIssue.value;
  return "";
});

const at = computed(() => STEPS.findIndex((entry) => entry.id === step.value));
const last = computed(() => at.value === STEPS.length - 1);

/** How far the reader may jump back to. Never past a step that is not settled. */
const reached = computed<StepId>(() => {
  if (chosen.value.size === 0) return "countries";
  if (capIssue.value !== "") return "cap";
  return "delivery";
});

function goto(id: string) {
  step.value = id as StepId;
}

function next() {
  if (blocked.value !== "") return;
  const ahead = STEPS[at.value + 1];
  if (ahead !== undefined) step.value = ahead.id as StepId;
}

function back() {
  const behind = STEPS[at.value - 1];
  if (behind !== undefined) step.value = behind.id as StepId;
}

function confirm() {
  if (props.busy || blocked.value !== "") return;
  emit("confirm", {
    allowedCountries: [...chosen.value].sort(),
    dailySpendCap: cap.value,
    attestationRequired: attestation.value,
  });
}

const summary = computed(() =>
  [...chosen.value]
    .map((code) => countryName(code) ?? code)
    .sort((a, b) => a.localeCompare(b, "en")),
);
</script>

<template>
  <!-- `width` as well as `max-width`: a cap alone lets a multi-step dialog size itself to
       its narrowest step and rewrap at every other one. -->
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="640" scrollable width="100%">
    <v-card border flat>
      <div class="flex max-h-[86vh] flex-col">
        <header class="flex flex-none flex-col gap-2.5 px-5 py-3.5">
          <div class="flex min-w-0 flex-col gap-0.5">
            <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
              Set up SMS on {{ projectName }}
            </h2>
            <p class="m-0 text-xs leading-5 text-ink/55">
              Where it may send, what it may spend in a day, and whether a caller has to
              prove they are human first. Written as one policy when you finish.
            </p>
          </div>
          <Steps :current="step" :reached="reached" :steps="STEPS" @select="goto" />
        </header>

        <div
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-line px-5 py-5"
        >
          <!-- 1 · Countries ---------------------------------------------------- -->
          <template v-if="step === 'countries'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Where this project may send</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                A destination outside this list is refused before it costs anything. There is
                no default: pumping picks the destination, so the countries a product does not
                serve are exactly the ones an attacker sends to, and a list somebody else
                opened is one nobody ever narrows.
              </p>
            </div>

            <v-text-field
              v-model="query"
              aria-label="Search countries"
              class="sms-setup__search"
              clearable
              density="comfortable"
              hide-details
              placeholder="Search a country"
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />

            <div
              class="max-h-72 overflow-y-auto rounded-(--idenzy-radius-small) ring-1 ring-ink/6 ring-inset"
            >
              <ul v-if="listed.length > 0" class="m-0 list-none divide-y divide-line p-0">
                <li v-for="country in listed" :key="country.code">
                  <label
                    class="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-ink/3"
                  >
                    <input
                      :checked="chosen.has(country.code)"
                      class="size-3.5 flex-none accent-[rgb(var(--v-theme-primary))]"
                      type="checkbox"
                      @change="toggle(country.code)"
                    />
                    <span aria-hidden="true" class="w-5 flex-none text-sm">
                      {{ countryFlag(country.code) }}
                    </span>
                    <span class="min-w-0 flex-1 truncate text-xs text-ink">
                      {{ country.name }}
                    </span>
                    <span class="flex-none font-mono text-[11px] text-ink/45">
                      {{ country.code }}
                    </span>
                  </label>
                </li>
              </ul>
              <p v-else class="m-0 px-4 py-10 text-center text-xs text-ink/50">
                No country matches that.
              </p>
            </div>
          </template>

          <!-- 2 · The cap ------------------------------------------------------ -->
          <template v-else-if="step === 'cap'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">What it may spend in a day</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                A hard stop and not an alert. A send that would take the UTC day past this is
                refused with <span class="font-mono">spend_cap_reached</span>, and it is held
                in Postgres rather than the cache because this is the one limit whose failure
                mode is an invoice.
              </p>
            </div>

            <div class="flex max-w-xs flex-col gap-1">
              <label class="text-xs font-medium text-ink" for="sms-setup-cap">Daily cap</label>
              <v-text-field
                id="sms-setup-cap"
                v-model="capText"
                :error="capIssue !== ''"
                :max="SMS_POLICY_BOUNDS.dailySpendCap.max"
                :min="SMS_POLICY_BOUNDS.dailySpendCap.min"
                :suffix="SMS_POLICY_DEFAULTS.currency"
                autocomplete="off"
                class="font-mono"
                hide-details
                inputmode="numeric"
                type="number"
                variant="filled"
              />
              <p
                :class="capIssue ? 'text-error' : 'text-ink/50'"
                class="m-0 text-[11px] leading-4"
              >
                {{
                  capIssue ||
                  `Whole units of ${SMS_POLICY_DEFAULTS.currency}. The default is ${SMS_POLICY_DEFAULTS.dailySpendCap}, which is deliberately small.`
                }}
              </p>
            </div>

            <p class="m-0 text-[11px] leading-4 text-ink/55">
              It can be raised at any time and takes effect on the next send. Raising it never
              releases what a day has already spent, and lowering it below the day's spend
              stops the channel until the next UTC midnight.
            </p>
          </template>

          <!-- 3 · The human check ---------------------------------------------- -->
          <template v-else-if="step === 'human'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Ask the caller to prove they are human</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                A CAPTCHA or an app attestation, checked before any counter is touched. That
                ordering is the point of it: without it anybody could exhaust a stranger's
                daily allowance by naming their number, and the victim would find their own
                sign-in refused having never been sent a code.
              </p>
            </div>

            <label class="flex cursor-pointer items-start gap-3">
              <v-switch
                v-model="attestation"
                class="-mt-1.5 flex-none"
                color="primary"
                density="compact"
                hide-details
                inset
              />
              <span class="flex min-w-0 flex-col gap-0.5 pt-1">
                <span class="text-xs font-medium text-ink">Require a human check</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Turning it off means anybody who can reach your start endpoint can have a
                  message sent to any allowed number at your expense.
                </span>
              </span>
            </label>

            <p
              v-if="attestation && !attestationWired"
              class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 p-3 text-[11px] leading-4 text-ink/70 ring-1 ring-ink/6 ring-inset"
            >
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm text-warning"
                name="material-symbols:error-outline"
              />
              <span>
                Nothing is wired on this deployment that can answer one, so leaving this on
                means every send is refused for a token the caller had no way to obtain. That
                is the intended failure rather than an oversight: a verifier that accepted
                what it cannot check would make the setting read as protection while being
                none. The readiness list on the screen behind says the same.
              </span>
            </p>
          </template>

          <!-- 4 · Delivery, which is read and not set --------------------------- -->
          <template v-else>
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">What this policy will do</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                Written as one row. Every value here can be changed afterwards on the screen
                behind this one.
              </p>
            </div>

            <dl class="m-0 grid grid-cols-1 gap-px rounded-(--idenzy-radius-small) bg-line ring-1 ring-ink/6 sm:grid-cols-3">
              <div class="flex flex-col gap-1 bg-surface p-3.5">
                <dt class="text-[11px] leading-4 text-ink/45">Countries</dt>
                <dd class="m-0 text-xs font-medium text-ink">
                  {{ chosen.size === 1 ? "1 allowed" : `${chosen.size} allowed` }}
                </dd>
                <dd class="m-0 line-clamp-2 text-[11px] leading-4 text-ink/55">
                  {{ summary.join(", ") }}
                </dd>
              </div>
              <div class="flex flex-col gap-1 bg-surface p-3.5">
                <dt class="text-[11px] leading-4 text-ink/45">Daily cap</dt>
                <dd class="m-0 font-mono text-xs text-ink">
                  {{ formatMoney(cap, SMS_POLICY_DEFAULTS.currency) }}
                </dd>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  A hard stop, reset at midnight UTC.
                </dd>
              </div>
              <div class="flex flex-col gap-1 bg-surface p-3.5">
                <dt class="text-[11px] leading-4 text-ink/45">Human check</dt>
                <dd class="m-0 text-xs font-medium text-ink">
                  {{ attestation ? "Required" : "Not required" }}
                </dd>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  {{
                    attestation
                      ? "Checked before any counter is touched."
                      : "Anybody who reaches the endpoint can spend."
                  }}
                </dd>
              </div>
            </dl>

            <!-- The one thing this dialog cannot settle, said rather than skipped: a
                 policy is still worth writing while the carrier account is half wired. -->
            <div
              class="flex items-start gap-2.5 rounded-(--idenzy-radius-small) bg-ink/4 p-3.5 ring-1 ring-ink/6 ring-inset"
            >
              <Icon
                :class="delivery.ready ? 'text-success' : 'text-warning'"
                :name="
                  delivery.ready
                    ? 'material-symbols:check-circle-outline'
                    : 'material-symbols:error-outline'
                "
                aria-hidden="true"
                class="mt-px flex-none text-base"
              />
              <div class="flex min-w-0 flex-col gap-0.5">
                <p class="m-0 text-xs font-medium text-ink">
                  {{ delivery.ready ? "Delivery is ready" : "Delivery is not ready yet" }}
                </p>
                <p class="m-0 text-[11px] leading-4 text-ink/55">
                  {{ delivery.label }}. It is settled on the providers screen rather than
                  here, and this policy is written either way.
                </p>
                <NuxtLink
                  class="mt-1 inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink/70 no-underline transition-colors duration-150 hover:text-ink"
                  to="/sms/providers"
                >
                  Providers
                  <Icon
                    aria-hidden="true"
                    class="text-sm"
                    name="material-symbols:chevron-right"
                  />
                </NuxtLink>
              </div>
            </div>
          </template>
        </div>

        <footer
          class="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
        >
          <v-btn
            :disabled="at === 0 || busy"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:arrow-back"
            size="small"
            variant="text"
            @click="back"
          >
            Back
          </v-btn>

          <div class="flex items-center gap-2">
            <span v-if="blocked" class="hidden text-[11px] text-ink/45 sm:inline">
              {{ blocked }}
            </span>
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
              v-if="!last"
              :disabled="blocked !== ''"
              class="text-xs font-medium"
              color="primary"
              size="small"
              variant="flat"
              @click="next"
            >
              Continue
            </v-btn>
            <v-btn
              v-else
              :disabled="blocked !== ''"
              :loading="busy"
              class="text-xs font-medium"
              color="primary"
              size="small"
              variant="flat"
              @click="confirm"
            >
              Create policy
            </v-btn>
          </div>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.sms-setup__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.sms-setup__search :deep(.v-field__input),
.sms-setup__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
}

.sms-setup__search :deep(.v-field__prepend-inner > .v-icon),
.sms-setup__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
