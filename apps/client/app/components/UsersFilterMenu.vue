<script setup lang="ts">
/**
 * The Filter button and the menu behind it: every way of narrowing the users list that
 * is not a status tab or a search term, those two being controls of their own on the
 * toolbar. The button carries a count of the filters that are set, so a list that looks
 * short is never a mystery, and the menu clears them all in one place.
 *
 * Each filter writes a fresh `UserFilters` rather than mutating the one it was given,
 * so the page's computed list sees one change per click and the store of filters can
 * be a plain ref.
 */
import type { TimeWindow, Tristate } from "~/utils/filters";
import {
  activeFilterCount,
  METHOD_LABELS,
  SIGN_IN_METHODS,
  type SignInMethod,
  type UserFilters,
} from "~/utils/users";
import type { SegmentedOption } from "./SegmentedControl.vue";

const filters = defineModel<UserFilters>({ required: true });

const count = computed(() => activeFilterCount(filters.value));

const VERIFIED: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "Verified" },
  { value: "no", label: "Unverified" },
];

const MFA: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "yes", label: "On" },
  { value: "no", label: "Off" },
];

const WINDOWS: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

const SIGN_IN_WINDOWS: readonly SegmentedOption[] = [
  ...WINDOWS,
  { value: "never", label: "Never" },
];

const TRISTATES: readonly Tristate[] = ["any", "yes", "no"];
const TIME_WINDOWS: readonly TimeWindow[] = ["any", "24h", "7d", "30d", "90d"];

function isTristate(value: string): value is Tristate {
  return (TRISTATES as readonly string[]).includes(value);
}

function isWindow(value: string): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

function patch(change: Partial<UserFilters>) {
  filters.value = { ...filters.value, ...change };
}

/* The segmented controls hand back strings; each is narrowed before it is stored. */
function setTristate(key: "emailVerified" | "mfa", value: string) {
  if (isTristate(value)) patch({ [key]: value });
}

function setCreated(value: string) {
  if (isWindow(value)) patch({ created: value });
}

function setLastSignIn(value: string) {
  if (value === "never" || isWindow(value)) patch({ lastSignIn: value });
}

function toggleMethod(method: SignInMethod) {
  const methods = filters.value.methods.includes(method)
    ? filters.value.methods.filter((entry) => entry !== method)
    : [...filters.value.methods, method];
  patch({ methods });
}

function clear() {
  patch({ emailVerified: "any", mfa: "any", methods: [], created: "any", lastSignIn: "any" });
}
</script>

<template>
  <v-menu :close-on-content-click="false" :offset="6" location="bottom end">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        class="text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:filter-list"
        size="small"
        variant="outlined"
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

    <v-card class="w-[22rem]" flat>
      <div class="flex flex-col gap-4 px-3 pt-3 pb-3">
        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Email</h3>
          <SegmentedControl
            :model-value="filters.emailVerified"
            :options="VERIFIED"
            label="Email verification"
            @update:model-value="setTristate('emailVerified', $event)"
          />
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Multi-factor</h3>
          <SegmentedControl
            :model-value="filters.mfa"
            :options="MFA"
            label="Multi-factor"
            @update:model-value="setTristate('mfa', $event)"
          />
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Sign-in methods
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <ul class="m-0 grid list-none grid-cols-2 gap-x-2 p-0">
            <li v-for="method in SIGN_IN_METHODS" :key="method">
              <label
                class="flex h-7 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
              >
                <v-checkbox-btn
                  :model-value="filters.methods.includes(method)"
                  color="primary"
                  density="compact"
                  @update:model-value="toggleMethod(method)"
                />
                {{ METHOD_LABELS[method] }}
              </label>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Created</h3>
          <SegmentedControl
            :model-value="filters.created"
            :options="WINDOWS"
            label="Created within"
            @update:model-value="setCreated"
          />
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Last sign-in</h3>
          <SegmentedControl
            :model-value="filters.lastSignIn"
            :options="SIGN_IN_WINDOWS"
            label="Last sign-in within"
            @update:model-value="setLastSignIn"
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
