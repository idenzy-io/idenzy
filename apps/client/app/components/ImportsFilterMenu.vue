<script setup lang="ts">
/**
 * The Filter button and the menu behind it: every way of narrowing the import history
 * that is not a tab or a search term, those two being controls of their own on the
 * toolbar. The button carries a count of the filters that are set, so a list that looks
 * short is never a mystery, and the menu clears them all in one place.
 *
 * Each filter writes a fresh `ImportFilters` rather than mutating the one it was given,
 * so the page's computed list sees one change per click.
 */
import type { TimeWindow } from "~/utils/filters";
import {
  IMPORT_OUTCOME_LABELS,
  IMPORT_OUTCOMES,
  type ImportFilters,
  type ImportOutcome,
  type ImportSource,
  importFilterCount,
  SOURCES,
} from "~/utils/import";
import type { SegmentedOption } from "./SegmentedControl.vue";

const filters = defineModel<ImportFilters>({ required: true });

const count = computed(() => importFilterCount(filters.value));

const WINDOWS: readonly SegmentedOption[] = [
  { value: "any", label: "Any" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

const TIME_WINDOWS: readonly TimeWindow[] = ["any", "24h", "7d", "30d", "90d"];

function isWindow(value: string): value is TimeWindow {
  return (TIME_WINDOWS as readonly string[]).includes(value);
}

function patch(change: Partial<ImportFilters>) {
  filters.value = { ...filters.value, ...change };
}

function setStarted(value: string) {
  if (isWindow(value)) patch({ started: value });
}

function toggleSource(source: ImportSource) {
  const sources = filters.value.sources.includes(source)
    ? filters.value.sources.filter((entry) => entry !== source)
    : [...filters.value.sources, source];
  patch({ sources });
}

function toggleOutcome(outcome: ImportOutcome) {
  const outcomes = filters.value.outcomes.includes(outcome)
    ? filters.value.outcomes.filter((entry) => entry !== outcome)
    : [...filters.value.outcomes, outcome];
  patch({ outcomes });
}

function clear() {
  patch({ sources: [], outcomes: [], started: "any" });
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

    <v-card class="w-[22rem]" flat>
      <div class="flex flex-col gap-4 px-3 pt-3 pb-3">
        <!-- The marks are not one width, so the glyph sits in a box of its own and every
             name starts at the same x. A flex row and not a grid: Vuetify's selection
             control carries `grid-area: control` for the grid inside `v-input`, and in a
             grid of ours that names no such line it lands in a column of its own making. -->
        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Source
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <!-- One column: two of them cut "Firebase Authentication" in half, and a name
               a reader has to guess at is not a filter. -->
          <ul class="m-0 flex list-none flex-col p-0">
            <li v-for="entry in SOURCES" :key="entry.id">
              <label
                class="flex h-7 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
              >
                <v-checkbox-btn
                  :model-value="filters.sources.includes(entry.id)"
                  color="primary"
                  density="compact"
                  @update:model-value="toggleSource(entry.id)"
                />
                <span class="flex h-4 w-5 flex-none items-center justify-center">
                  <Icon
                    :class="[
                      entry.monochrome ? '[.v-theme--dark_&]:invert' : '',
                      entry.tint ?? '',
                    ]"
                    :name="entry.icon"
                    aria-hidden="true"
                    class="text-sm"
                  />
                </span>
                <span class="truncate">{{ entry.label }}</span>
              </label>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">
            Outcome
            <span class="font-normal text-ink/45">· any of</span>
          </h3>
          <ul class="m-0 grid list-none grid-cols-2 gap-x-2 p-0">
            <li v-for="outcome in IMPORT_OUTCOMES" :key="outcome">
              <label
                class="flex h-7 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
              >
                <v-checkbox-btn
                  :model-value="filters.outcomes.includes(outcome)"
                  color="primary"
                  density="compact"
                  @update:model-value="toggleOutcome(outcome)"
                />
                {{ IMPORT_OUTCOME_LABELS[outcome] }}
              </label>
            </li>
          </ul>
        </section>

        <section class="flex flex-col gap-1.5">
          <h3 class="m-0 text-xs font-medium text-ink/70">Started</h3>
          <SegmentedControl
            :model-value="filters.started"
            :options="WINDOWS"
            label="Started within"
            @update:model-value="setStarted"
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
