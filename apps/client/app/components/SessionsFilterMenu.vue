<script setup lang="ts">
/**
 * The Filter button and the menu behind it: every way of narrowing the sessions list
 * that is not a status tab or a search term, those two being controls of their own on
 * the toolbar. The button carries a count of what is set, so a list that looks short is
 * never a mystery.
 *
 * "Ended by" is the one worth putting first among the lists, because it is what a sweep
 * after an incident is filtered on: every session that ended in a refresh token reuse,
 * across every account, is one click. It reads a derived reason rather than the column,
 * so a session that lapsed and has not been swept yet is still found under the expiry it
 * hit.
 */
import type { TimeWindow, Tristate } from "~/utils/filters";
import {
  countryFlag,
  DEVICE_FORMS,
  type DeviceForm,
  FACTOR_LABELS,
  FORM_ICONS,
  FORM_LABELS,
  isNetworkConcern,
  isSecurityEvent,
  NETWORK_ICONS,
  NETWORK_LABELS,
  NETWORK_SIGNALS,
  type NetworkSignal,
  REASON_LABELS,
  REVOKE_REASONS,
  type RevokeReason,
  type SessionFilters,
  SIGN_IN_FACTORS,
  type SignInFactor,
  sessionFilterCount,
} from "~/utils/sessions";
import type { SegmentedOption } from "./SegmentedControl.vue";

withDefaults(
  defineProps<{
    /** The countries this project's sessions actually came from, not all two hundred. */
    countries?: readonly { code: string; name: string }[];
  }>(),
  { countries: () => [] },
);

const filters = defineModel<SessionFilters>({ required: true });

const count = computed(() => sessionFilterCount(filters.value));

const FACTOR: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Proved" },
  { value: "no", label: "None" },
];

const BOUND: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Bound" },
  { value: "no", label: "Not bound" },
];

const WINDOWS: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

const TRISTATES: readonly Tristate[] = ["any", "yes", "no"];
const TIME_WINDOWS: readonly TimeWindow[] = ["any", "24h", "7d", "30d", "90d"];

function isTristate(value: string): value is Tristate {
  return (TRISTATES as readonly string[]).includes(value);
}

function isWindow(value: string): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

function patch(change: Partial<SessionFilters>) {
  filters.value = { ...filters.value, ...change };
}

/* The segmented controls hand back strings; each is narrowed before it is stored. */
function setTristate(key: "factor" | "bound", value: string) {
  if (isTristate(value)) patch({ [key]: value });
}

function setWindow(key: "lastActive" | "started", value: string) {
  if (isWindow(value)) patch({ [key]: value });
}

function toggleMethod(method: SignInFactor) {
  const methods = filters.value.methods.includes(method)
    ? filters.value.methods.filter((entry) => entry !== method)
    : [...filters.value.methods, method];
  patch({ methods });
}

function toggleReason(reason: RevokeReason) {
  const reasons = filters.value.reasons.includes(reason)
    ? filters.value.reasons.filter((entry) => entry !== reason)
    : [...filters.value.reasons, reason];
  patch({ reasons });
}

function toggleForm(form: DeviceForm) {
  const forms = filters.value.forms.includes(form)
    ? filters.value.forms.filter((entry) => entry !== form)
    : [...filters.value.forms, form];
  patch({ forms });
}

function toggleNetwork(signal: NetworkSignal) {
  const networks = filters.value.networks.includes(signal)
    ? filters.value.networks.filter((entry) => entry !== signal)
    : [...filters.value.networks, signal];
  patch({ networks });
}

function toggleCountry(code: string) {
  const countries = filters.value.countries.includes(code)
    ? filters.value.countries.filter((entry) => entry !== code)
    : [...filters.value.countries, code];
  patch({ countries });
}

function clear() {
  patch({
    methods: [],
    factor: "any",
    bound: "any",
    forms: [],
    reasons: [],
    networks: [],
    countries: [],
    lastActive: "any",
    started: "any",
  });
}
</script>

<template>
  <v-menu :close-on-content-click="false" :offset="6" location="bottom end">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        class="idenzy-toolbar-control text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:filter-list"
        size="small"
        variant="text"
      >
        Filter
        <span
          v-if="count > 0"
          class="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-on-primary tabular-nums"
        >
          {{ count }}
        </span>
      </v-btn>
    </template>

    <v-card class="w-[23rem]" flat>
      <div class="sessions-filter__body flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-3">
        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Ended by
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <ul class="m-0 flex list-none flex-col p-0">
            <li v-for="reason in REVOKE_REASONS" :key="reason">
              <label
                class="flex h-7 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
              >
                <v-checkbox-btn
                  :model-value="filters.reasons.includes(reason)"
                  color="primary"
                  density="compact"
                  @update:model-value="toggleReason(reason)"
                />
                <span :class="isSecurityEvent(reason) ? 'text-error' : ''">
                  {{ REASON_LABELS[reason] }}
                </span>
              </label>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Signed in with
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <ul class="m-0 grid list-none grid-cols-2 gap-x-2 p-0">
            <li v-for="method in SIGN_IN_FACTORS" :key="method">
              <label
                class="flex h-7 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
              >
                <v-checkbox-btn
                  :model-value="filters.methods.includes(method)"
                  color="primary"
                  density="compact"
                  @update:model-value="toggleMethod(method)"
                />
                <span class="truncate">{{ FACTOR_LABELS[method] }}</span>
              </label>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Network
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <ul class="m-0 flex list-none flex-wrap gap-1 p-0">
            <li v-for="signal in NETWORK_SIGNALS" :key="signal">
              <button
                :aria-pressed="filters.networks.includes(signal)"
                :class="[
                  filters.networks.includes(signal)
                    ? 'border-primary bg-primary/8 text-ink'
                    : 'border-line text-ink/65 hover:text-ink',
                  isNetworkConcern(signal) ? 'text-warning' : '',
                ]"
                class="inline-flex h-7 items-center gap-1 rounded-(--idenzy-radius-x-small) border px-2 text-xs transition-colors duration-150"
                type="button"
                @click="toggleNetwork(signal)"
              >
                <Icon :name="NETWORK_ICONS[signal]" aria-hidden="true" class="text-sm" />
                {{ NETWORK_LABELS[signal] }}
              </button>
            </li>
          </ul>
        </section>

        <!-- Only the countries this project has seen. A list of all of them would need a
             search box of its own, and a project that has never had a sign-in from Chad
             does not want Chad in its filter. -->
        <section v-if="countries.length > 0" class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Country
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <ul class="m-0 flex max-h-44 list-none flex-col overflow-y-auto p-0">
            <li v-for="country in countries" :key="country.code">
              <label
                class="flex h-7 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
              >
                <v-checkbox-btn
                  :model-value="filters.countries.includes(country.code)"
                  color="primary"
                  density="compact"
                  @update:model-value="toggleCountry(country.code)"
                />
                <span
                  aria-hidden="true"
                  class="w-5 flex-none overflow-hidden text-sm leading-none whitespace-nowrap"
                >
                  {{ countryFlag(country.code) }}
                </span>
                <span class="truncate">{{ country.name }}</span>
              </label>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Device</h3>
          <ul class="m-0 flex list-none flex-wrap gap-1 p-0">
            <li v-for="form in DEVICE_FORMS" :key="form">
              <button
                :aria-pressed="filters.forms.includes(form)"
                :class="
                  filters.forms.includes(form)
                    ? 'border-primary bg-primary/8 text-ink'
                    : 'border-line text-ink/65 hover:text-ink'
                "
                class="inline-flex h-7 items-center gap-1 rounded-(--idenzy-radius-x-small) border px-2 text-xs transition-colors duration-150"
                type="button"
                @click="toggleForm(form)"
              >
                <Icon :name="FORM_ICONS[form]" aria-hidden="true" class="text-sm" />
                {{ FORM_LABELS[form] }}
              </button>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Second factor</h3>
          <SegmentedControl
            :model-value="filters.factor"
            :options="FACTOR"
            label="Second factor"
            @update:model-value="setTristate('factor', $event)"
          />
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Device key</h3>
          <SegmentedControl
            :model-value="filters.bound"
            :options="BOUND"
            label="Device key binding"
            @update:model-value="setTristate('bound', $event)"
          />
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Last active</h3>
          <SegmentedControl
            :model-value="filters.lastActive"
            :options="WINDOWS"
            label="Last active within"
            @update:model-value="setWindow('lastActive', $event)"
          />
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Signed in</h3>
          <SegmentedControl
            :model-value="filters.started"
            :options="WINDOWS"
            label="Signed in within"
            @update:model-value="setWindow('started', $event)"
          />
        </section>
      </div>

      <div class="flex items-center justify-between border-t border-line px-3 py-2">
        <p class="m-0 text-[11px] text-ink/50">
          <template v-if="count === 0">No filters set</template>
          <template v-else>
            <span class="font-mono tabular-nums">{{ count }}</span>
            {{ count === 1 ? "filter" : "filters" }} set
          </template>
        </p>
        <button
          :disabled="count === 0"
          class="text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink disabled:text-ink/30"
          type="button"
          @click="clear"
        >
          Clear all
        </button>
      </div>
    </v-card>
  </v-menu>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}

:deep(.v-selection-control:not(.v-selection-control--dirty) .v-selection-control__input > .v-icon) {
  color: rgba(var(--v-theme-on-surface), 0.35);
}
</style>
