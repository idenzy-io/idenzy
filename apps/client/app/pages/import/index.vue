<script setup lang="ts">
/**
 * Bringing users over from somewhere else: the wizard that runs an import, the history
 * of the ones that ran, and the figures that say how the migration is going.
 *
 * The wizard is four steps. The source is chosen first because it decides how the file
 * is read and how its passwords are treated; the file is read in the browser and its
 * columns mapped to our fields, with the guess from `inferMapping` filled in; and the
 * review step says exactly what the import would do before it does it, because the
 * numbers that matter are the ones the operator has not thought of: the rows with no
 * address, the duplicates, the hashes we cannot verify. A dry run is the same job with
 * nothing written, and it sits beside the real one rather than behind a flag.
 *
 * The history under it is the panel's list shape and nothing else: the section's name
 * above a plain card, the controls that narrow it along the top, the table under them,
 * exactly as the users and sessions screens are laid out. There is no strip of totals
 * over it, because the figures that would go in one are the migration's and they are
 * already in the sidebar; the same number twice on one screen is the tell this panel
 * was rewritten to get rid of.
 *
 * The figures on the side are the migration's: users imported, and how many of the
 * passwords that came with them have been upgraded since, which is the count of legacy
 * hashes still in the database going down (@idenzy/crypto's verify-only hashers).
 *
 * The catalogue of sources is reference content, so it is a table under the history
 * rather than a hand-written list of links in the sidebar, folded away until somebody
 * is choosing where their users are coming from.
 *
 * The data is the store's placeholder until the management API client exists. The
 * file, the parsing and the analysis are real and stay in the browser.
 */

import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  countImportsByKind,
  EMPTY_IMPORT_FILTERS,
  FORMAT_LABELS,
  filterImports,
  IMPORT_KIND_LABELS,
  IMPORT_OUTCOME_LABELS,
  type ImportFilters,
  type ImportJob,
  type ImportKind,
  type ImportOutcome,
  type ImportSource,
  importFilterCount,
  importOutcome,
  SOURCES,
  sourceInfo,
} from "~/utils/import";
import { formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useImportsStore();
const now = useNow({ interval: 30_000 });

const jobs = computed(() => store.forProject(projects.current.id));
const metrics = computed(() => store.metrics(projects.current.id, now.value));

const GUIDES_URL = "https://idenzy.io/docs/migrate";

/* The wizard is a dialog, so the page holds only whether it is up. */
const wizardOpen = ref(false);

/*
 * The history: the same four controls the users and sessions lists carry, over the same
 * card. The tabs are the one cut that puts every job in exactly one place, a rehearsal
 * or a real run, so a job that is still going belongs to the tab it will still be in
 * when it finishes. Everything else that narrows the list is behind the Filter button,
 * and what a job ended as is a badge in the table rather than a tab of its own.
 */
const filters = ref<ImportFilters>({ ...EMPTY_IMPORT_FILTERS });

const filtered = computed(() => filterImports(jobs.value, filters.value, now.value));
const kindCounts = computed(() => countImportsByKind(jobs.value));

const KIND_TABS: readonly ("all" | ImportKind)[] = ["all", "import", "dry-run"];

function isKindTab(value: string): value is "all" | ImportKind {
  return (KIND_TABS as readonly string[]).includes(value);
}

const kindOptions = computed<SegmentedOption[]>(() =>
  KIND_TABS.map((tab) => ({
    value: tab,
    label: `${tab === "all" ? "All" : IMPORT_KIND_LABELS[tab]} · ${kindCounts.value[tab]}`,
  })),
);

const kindTab = computed({
  get: () => filters.value.kind,
  set: (value: string) => {
    if (isKindTab(value)) filters.value = { ...filters.value, kind: value };
  },
});

/* `clearable` hands back null, which the filter reads as nothing typed. */
const query = computed({
  get: () => filters.value.query,
  set: (value: string | null) => {
    filters.value = { ...filters.value, query: value ?? "" };
  },
});

const narrowed = computed(
  () =>
    filters.value.kind !== "all" ||
    filters.value.query.trim() !== "" ||
    importFilterCount(filters.value) > 0,
);

function resetFilters() {
  filters.value = { ...EMPTY_IMPORT_FILTERS };
}

/* The label is decided in `utils/import.ts`, so the run card and this table cannot
   call the same job two different things. Only the colour is the screen's. */
const OUTCOME_TONES: Record<ImportOutcome, BadgeTone> = {
  queued: "neutral",
  running: "warning",
  done: "success",
  failed: "error",
  "dry-run": "neutral",
};

function outcomeOf(entry: ImportJob) {
  const outcome = importOutcome(entry);
  return { label: IMPORT_OUTCOME_LABELS[outcome], tone: OUTCOME_TONES[outcome] };
}

/*
 * Nine columns, five of them shown. The table sits beside the migration's figures, so
 * it is the narrowest list in the panel, and a default arrangement wider than its card
 * makes every reader scroll sideways to reach the outcome. The four that are off answer
 * a second question rather than the first, and the columns menu is one click away.
 */
const COLUMNS: readonly DataTableColumn<ImportJob>[] = [
  { key: "job", title: "Import", fixed: true, minWidth: 200, value: (entry) => entry.fileName },
  { key: "startedAt", title: "Started", mono: true, width: 110 },
  { key: "startedBy", title: "By", width: 190, hidden: true },
  { key: "rows", title: "Rows", align: "end", mono: true, width: 88, hidden: true },
  { key: "imported", title: "Imported", align: "end", mono: true, width: 96 },
  { key: "skipped", title: "Skipped", align: "end", mono: true, width: 88, hidden: true },
  { key: "failed", title: "Failed", align: "end", mono: true, width: 88 },
  {
    key: "passwordsKept",
    title: "Passwords kept",
    align: "end",
    mono: true,
    width: 128,
    hidden: true,
  },
  {
    key: "status",
    title: "Outcome",
    width: 112,
    skeleton: "pill",
    value: (entry) => outcomeOf(entry).label,
  },
];

const stored = useLocalStorage<ColumnState>("idenzy.imports.columns", defaultColumnState(COLUMNS));
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});
const sortBy = ref<DataTableSort[]>([{ key: "startedAt", order: "desc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.imports.page-size", 10);

/* A narrowed list starts at its own beginning. Page two of everything is not page two
   of the dry runs. */
watch(filters, () => {
  page.value = 1;
});

/*
 * What each source exports, as the catalogue it is. The order is the one the source
 * grid uses, which is how often a migration comes from each, so the table opens on it
 * and sorts from there.
 *
 * Short cells only. A row in this panel is one line high, so the sentence about how an
 * export is obtained would be clipped rather than read; it is in the wizard's first
 * step already, in full, beside the source it belongs to. What is here is what that
 * screen cannot be scanned for: the formats, the answer about passwords, and the guide.
 */
interface SourceRow {
  id: ImportSource;
  label: string;
  icon: string;
  monochrome: boolean;
  tint: string;
  formats: string;
  hashes: string;
  guide: string;
}

const SOURCE_ROWS: readonly SourceRow[] = SOURCES.map((entry) => ({
  id: entry.id,
  label: entry.label,
  icon: entry.icon,
  monochrome: entry.monochrome,
  tint: entry.tint ?? "",
  formats: entry.formats.map((format) => FORMAT_LABELS[format]).join(", "),
  hashes: entry.hashes,
  guide: entry.guide,
}));

const SOURCE_COLUMNS: readonly DataTableColumn<SourceRow>[] = [
  { key: "label", title: "Source", fixed: true, minWidth: 260 },
  { key: "formats", title: "Formats", width: 180 },
  { key: "hashes", title: "Passwords that keep working", minWidth: 240 },
];

const storedSourceColumns = useLocalStorage<ColumnState>(
  "idenzy.import-sources.columns",
  defaultColumnState(SOURCE_COLUMNS),
);
const sourceColumnState = computed<ColumnState>({
  get: () => reconcileColumnState(SOURCE_COLUMNS, storedSourceColumns.value),
  set: (value) => {
    storedSourceColumns.value = value;
  },
});
const sourceSort = ref<DataTableSort[]>([]);
const sourcesOpen = ref(false);
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Import users">
      <template #description>
        Bring your users over from Firebase, Supabase, Auth0, Clerk, Cognito or a file.
        Passwords come along wherever the source exports hashes.
      </template>
      <template #actions>
        <v-btn
          :href="GUIDES_URL"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:menu-book-outline"
          rel="noopener"
          size="small"
          target="_blank"
          variant="text"
        >
          Migration Guides
        </v-btn>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="text"
          @click="wizardOpen = true"
        >
          New Import
        </v-btn>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <!--
          The history: the section's name on the page, then the card, with the controls
          that narrow it along the top and the table under them. The same object as the
          users and sessions lists, down to the order of the controls in the strip.
        -->
        <section class="flex flex-col gap-3">
          <header class="flex min-w-0 flex-col gap-0.5">
            <h2 class="m-0 text-sm font-medium text-ink">Past imports</h2>
            <p class="m-0 text-xs text-ink/55">
              Every run on this project, dry runs included. A run is listed as it starts and
              its counts climb as rows land, and the refused rows stay in the report the run
              leaves behind.
            </p>
          </header>

          <v-card border flat>
            <div
              class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
            >
              <SegmentedControl v-model="kindTab" :options="kindOptions" label="Kind" />

              <div class="flex flex-wrap items-center gap-2">
                <SearchField
                  v-model="query"
                  label="Search imports"
                  placeholder="Search file, who ran it or ID"
                  class="w-full sm:w-72"
                />
                <ImportsFilterMenu v-model="filters" />
                <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
              </div>
            </div>

            <DataTable
              v-model:column-state="columnState"
              v-model:items-per-page="pageSize"
              v-model:page="page"
              v-model:sort-by="sortBy"
              :columns="COLUMNS"
              :items="filtered"
              :loading="store.loading"
              label="Past imports"
            >
              <template #cell.job="{ item }">
                <span class="flex min-w-0 items-center gap-2.5">
                  <span class="flex size-7 flex-none items-center justify-center text-ink">
                    <Icon
                      :class="[
                        sourceInfo(item.source).monochrome ? '[.v-theme--dark_&]:invert' : '',
                        sourceInfo(item.source).tint ?? '',
                      ]"
                      :name="sourceInfo(item.source).icon"
                      aria-hidden="true"
                      class="text-[22px]"
                    />
                  </span>
                  <span class="flex min-w-0 flex-col gap-px leading-4">
                    <span class="truncate text-xs font-medium text-ink">{{ item.fileName }}</span>
                    <span class="truncate text-[11px] text-ink/55">
                      {{ sourceInfo(item.source).label }} · {{ FORMAT_LABELS[item.format] }}
                    </span>
                  </span>
                </span>
              </template>
              <template #cell.startedAt="{ item }">
                <v-tooltip :text="formatDateTime(item.startedAt)" location="top">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                      {{ relativeTime(item.startedAt, now) }}
                    </span>
                  </template>
                </v-tooltip>
              </template>
              <template #cell.failed="{ item }">
                <span
                  :class="item.failed > 0 ? 'text-error' : 'text-ink/35'"
                  class="font-mono tabular-nums"
                >
                  {{ item.failed }}
                </span>
              </template>
              <template #cell.skipped="{ item }">
                <span
                  :class="item.skipped > 0 ? 'text-ink' : 'text-ink/35'"
                  class="font-mono tabular-nums"
                >
                  {{ item.skipped }}
                </span>
              </template>
              <template #cell.passwordsKept="{ item }">
                <span class="font-mono tabular-nums text-ink">{{ item.passwordsKept.toLocaleString("en") }}</span>
                <span
                  v-if="item.passwordsDropped > 0"
                  class="font-mono text-[11px] tabular-nums text-warning"
                >
                  · {{ item.passwordsDropped }} dropped
                </span>
              </template>
              <template #cell.status="{ item }">
                <StatusBadge :label="outcomeOf(item).label" :tone="outcomeOf(item).tone" />
              </template>

              <!-- Nothing has ever run, or nothing answers the narrowing. The first is
                   the screen's whole purpose and gets the framed state; the second is a
                   note with the way out of it. -->
              <template #empty>
                <div v-if="narrowed" class="flex flex-col items-center gap-1 px-4 py-14 text-center">
                  <Icon
                    aria-hidden="true"
                    class="mb-1 text-2xl text-ink/25"
                    name="material-symbols:search-off"
                  />
                  <p class="m-0 text-sm font-medium text-ink">No imports match</p>
                  <p class="m-0 max-w-sm text-xs text-ink/55">
                    Try another search, or clear the filters to see every run.
                  </p>
                  <v-btn
                    class="mt-2 text-xs font-medium"
                    color="neutral"
                    size="small"
                    variant="text"
                    @click="resetFilters"
                  >
                    Clear filters
                  </v-btn>
                </div>
                <EmptyState
                  v-else
                  description="Bring your users over from Firebase, Supabase, Auth0, Clerk, Cognito or a file of your own. Where the source exports password hashes they come too, and nobody is asked to reset."
                  icon="material-symbols:upload-file-outline"
                  title="No imports yet"
                >
                  <template #actions>
                    <v-btn
                      class="text-xs font-medium"
                      color="neutral"
                      prepend-icon="material-symbols:add"
                      size="small"
                      variant="text"
                      @click="wizardOpen = true"
                    >
                      Start an import
                    </v-btn>
                    <v-btn
                      :href="GUIDES_URL"
                      class="text-xs font-medium"
                      color="neutral"
                      rel="noopener"
                      size="small"
                      target="_blank"
                      variant="text"
                    >
                      Read the guides
                    </v-btn>
                  </template>
                </EmptyState>
              </template>
            </DataTable>
          </v-card>
        </section>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Migration</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="3"
            :series="metrics.daily"
            :value="metrics.usersImported"
            label="Users imported"
          />
          <UsageTile
            :seed="5"
            :value="metrics.imports"
            info="Runs that wrote users. Dry runs are not counted."
            label="Imports run"
          />
          <UsageTile
            :seed="7"
            :value="metrics.passwordsUpgraded"
            info="Imported password hashes rehashed to Argon2id at a sign-in. The legacy hash is gone once this happens."
            label="Hashes upgraded"
          />
          <UsageTile
            :seed="11"
            :value="metrics.awaitingUpgrade"
            info="Imported accounts still on their original hash, because they have not signed in since."
            label="Awaiting sign-in"
          />
        </div>
      </aside>
    </div>

    <!-- The catalogue behind the first step of the wizard, folded away: the six sources
         side by side, which the wizard's cards cannot be read as. -->
    <LayerCard
      v-model:open="sourcesOpen"
      :padded="false"
      description="Where a migration can come from, in which formats, and which of them hand over passwords that go on working. The wizard's first step says how each export is obtained."
      expandable
      title="What each source exports"
    >
      <template #actions>
        <DataTableColumnsMenu v-model="sourceColumnState" :columns="SOURCE_COLUMNS" />
      </template>

      <!-- Unpaged: the set is every source we read, and a foot saying "1-6 of 6"
           under it is a control with nothing to do. -->
      <DataTable
        v-model:column-state="sourceColumnState"
        v-model:sort-by="sourceSort"
        :columns="SOURCE_COLUMNS"
        :items="SOURCE_ROWS"
        :paged="false"
        label="Import sources"
      >
        <!-- The marks are not one width, so the glyph sits in a box of its own and every
             name starts at the same x. -->
        <template #cell.label="{ item }">
          <span class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2.5">
            <span class="flex h-4 w-5 items-center justify-center">
              <Icon
                :class="[item.monochrome ? '[.v-theme--dark_&]:invert' : '', item.tint]"
                :name="item.icon"
                aria-hidden="true"
                class="text-base"
              />
            </span>
            <span class="truncate font-medium text-ink">{{ item.label }}</span>
          </span>
        </template>

        <template #cell.formats="{ item }">
          <span class="font-mono text-ink/70">{{ item.formats }}</span>
        </template>

        <template #cell.hashes="{ item }">
          <span class="truncate text-ink/70">{{ item.hashes }}</span>
        </template>

        <template #actions="{ item }">
          <a
            :href="item.guide"
            class="inline-flex items-center gap-1 text-xs font-medium text-ink/70 no-underline transition-colors duration-150 hover:text-ink"
            rel="noopener"
            target="_blank"
          >
            Guide
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:open-in-new" />
          </a>
        </template>
      </DataTable>
    </LayerCard>

    <ImportWizardDialog v-model="wizardOpen" />
  </div>
</template>

<style scoped>
</style>
