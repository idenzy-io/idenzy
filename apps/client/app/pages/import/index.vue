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
 * The figures on the side are the migration's: users imported, and how many of the
 * passwords that came with them have been upgraded since, which is the count of legacy
 * hashes still in the database going down (@idenzy/crypto's verify-only hashers).
 *
 * The data is the store's placeholder until the management API client exists. The
 * file, the parsing and the analysis are real and stay in the browser.
 */

import type { ImportFile } from "~/components/ImportDropzone.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { Step } from "~/components/Steps.vue";
import type { ImportJob, ImportStatus } from "~/stores/imports";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  analyse,
  detectSource,
  EMPTY_FIREBASE_HASH_CONFIG,
  type FirebaseHashConfig,
  FORMAT_LABELS,
  firebaseHashConfigComplete,
  HASH_LABELS,
  type HashKind,
  type ImportSource,
  ISSUE_LABELS,
  type Issue,
  inferMapping,
  type Mapping,
  SOURCES,
  sourceInfo,
} from "~/utils/import";
import { formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useImportsStore();
const now = useNow({ interval: 30_000 });

const jobs = computed(() => store.forProject(projects.current.id));
const metrics = computed(() => store.metrics(projects.current.id, now.value));

const GUIDES_URL = "https://idenzy.dev/docs/migrate";

/*
 * The wizard.
 */
type StepId = "source" | "file" | "fields" | "review";

const STEPS: readonly Step[] = [
  { id: "source", label: "Source" },
  { id: "file", label: "File" },
  { id: "fields", label: "Fields" },
  { id: "review", label: "Review and run" },
];

const STEP_TITLES: Record<StepId, string> = {
  source: "Where are the users coming from?",
  file: "Drop the export",
  fields: "Which column is which",
  review: "What the import will do",
};

const open = ref(false);
const step = ref<StepId>("source");
const source = ref<ImportSource | null>(null);
const file = ref<ImportFile | null>(null);
const firebase = ref<FirebaseHashConfig>({ ...EMPTY_FIREBASE_HASH_CONFIG });
const mapping = ref<Mapping>({});
const options = ref({ duplicates: "skip" as "skip" | "update", verifyAll: false, dryRun: false });
const runningId = ref<string | null>(null);

/* The segmented control hands back a string; it is narrowed before it is stored. */
const duplicates = computed({
  get: () => options.value.duplicates,
  set: (value: string) => {
    if (value === "skip" || value === "update") options.value.duplicates = value;
  },
});

function isStep(value: string): value is StepId {
  return STEPS.some((entry) => entry.id === value);
}

function begin() {
  open.value = true;
  step.value = "source";
  source.value = null;
  file.value = null;
  firebase.value = { ...EMPTY_FIREBASE_HASH_CONFIG };
  mapping.value = {};
  options.value = { duplicates: "skip", verifyAll: false, dryRun: false };
  runningId.value = null;
}

function close() {
  open.value = false;
  runningId.value = null;
}

/* A new file resets the mapping to the guess, and says so if it looks like another
   source's export: the wrong source reads passwords under the wrong hash. */
watch(file, (chosen) => {
  mapping.value = chosen ? inferMapping(chosen.keys) : {};
});

const detected = computed(() => (file.value ? detectSource(file.value.records) : null));
const mismatch = computed(
  () => detected.value !== null && source.value !== "file" && detected.value !== source.value,
);

const accepted = computed(() =>
  source.value ? sourceInfo(source.value).formats : (["json", "ndjson", "csv"] as const),
);

const analysis = computed(() =>
  file.value ? analyse(file.value.records, mapping.value, source.value) : null,
);

const ready = computed<Record<StepId, boolean>>(() => ({
  source: source.value !== null,
  file:
    file.value !== null &&
    (source.value !== "firebase" || firebaseHashConfigComplete(firebase.value)),
  fields: mapping.value.email !== undefined || mapping.value.phone !== undefined,
  review: (analysis.value?.importable ?? 0) > 0,
}));

const order: readonly StepId[] = ["source", "file", "fields", "review"];

function next() {
  const at = order.indexOf(step.value);
  const following = order[at + 1];
  if (following && ready.value[step.value]) step.value = following;
}

function back() {
  const at = order.indexOf(step.value);
  const previous = order[at - 1];
  if (previous) step.value = previous;
}

function jump(id: string) {
  if (isStep(id)) step.value = id;
}

const job = computed(() => store.jobs.find((entry) => entry.id === runningId.value) ?? null);

function run(dryRun: boolean) {
  if (!file.value || !source.value || !analysis.value) return;
  const started = store.start({
    projectId: projects.current.id,
    source: source.value,
    fileName: file.value.name,
    format: file.value.format,
    dryRun,
    analysis: analysis.value,
    startedBy: "hasan@example.com",
  });
  runningId.value = started.id;
}

/* The review step's figures, in the order an operator reads them: what goes in, what
   does not, and what happens to passwords. */
const review = computed(() => {
  const found = analysis.value;
  if (!found) return [];
  return [
    { label: "Rows in the file", value: found.total, tone: "" },
    {
      label: options.value.dryRun ? "Would import" : "Will import",
      value: found.importable,
      tone: "text-success",
    },
    {
      label: "Refused",
      value: found.total - found.importable,
      tone: found.total - found.importable > 0 ? "text-error" : "",
    },
    { label: "Verified emails", value: found.verifiedEmails, tone: "" },
    { label: "Passwords kept", value: found.passwordsKeptTotal, tone: "" },
    {
      label: "Passwords dropped",
      value: found.passwordsDropped,
      tone: found.passwordsDropped > 0 ? "text-warning" : "",
    },
  ];
});

const kept = computed(() =>
  Object.entries(analysis.value?.passwordsKept ?? {}).map(([kind, count]) => ({
    label: HASH_LABELS[kind as HashKind], // the keys are the HashKinds the analysis counted
    count: count ?? 0,
  })),
);

const issues = computed(() =>
  Object.entries(analysis.value?.issues ?? {}).map(([issue, count]) => ({
    label: ISSUE_LABELS[issue as Issue], // likewise, the issues the analysis counted
    count: count ?? 0,
  })),
);

/*
 * The history.
 */
const STATUS: Record<ImportStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "warning" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "error" },
};

function statusOf(entry: ImportJob) {
  return entry.dryRun && entry.status === "done"
    ? { label: "Dry run", tone: "neutral" as BadgeTone }
    : STATUS[entry.status];
}

const COLUMNS: readonly DataTableColumn<ImportJob>[] = [
  { key: "job", title: "Import", fixed: true, minWidth: 260, value: (entry) => entry.fileName },
  { key: "startedAt", title: "Started", mono: true, width: 120 },
  { key: "startedBy", title: "By", width: 190 },
  { key: "rows", title: "Rows", align: "end", mono: true, width: 88 },
  { key: "imported", title: "Imported", align: "end", mono: true, width: 96 },
  { key: "skipped", title: "Skipped", align: "end", mono: true, width: 88 },
  { key: "failed", title: "Failed", align: "end", mono: true, width: 88 },
  { key: "passwordsKept", title: "Passwords kept", align: "end", mono: true, width: 128 },
  {
    key: "status",
    title: "Status",
    width: 112,
    skeleton: "pill",
    value: (entry) => statusOf(entry).label,
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

const guides = SOURCES.map((entry) => ({
  icon: entry.icon,
  monochrome: entry.monochrome,
  tint: entry.tint ?? "",
  title: entry.id === "file" ? "The file format" : `Migrating from ${entry.label}`,
  detail: entry.id === "file" ? "Columns, hash formats, and the CSV and JSON shapes." : entry.how,
  href: entry.guide,
}));
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:upload-file-outline" title="Import users">
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
          variant="outlined"
        >
          Migration guides
        </v-btn>
        <FancyButton @click="begin">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          New import
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <!-- The wizard, or the empty state in its place, or nothing when there is a
             history and no import underway: the history is then the page. -->
        <LayerCard v-if="open" :padded="false">
          <template #header>
            <Steps :current="step" :steps="STEPS" @select="jump" />
          </template>
          <template #actions>
            <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="close">
              {{ job?.status === "done" ? "Close" : "Cancel" }}
            </v-btn>
          </template>

          <div class="flex flex-col gap-5 p-5">
            <template v-if="job">
              <ImportRunCard :job="job">
                <template v-if="job.status === 'done'" #actions>
                  <FancyButton @click="begin">
                    <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                    Import another
                  </FancyButton>
                  <v-btn
                    v-if="!job.dryRun"
                    class="text-xs font-medium"
                    color="neutral"
                    size="small"
                    to="/users"
                    variant="outlined"
                  >
                    View users
                  </v-btn>
                  <v-btn
                    v-else
                    class="text-xs font-medium"
                    color="neutral"
                    size="small"
                    variant="outlined"
                    @click="run(false)"
                  >
                    Run it for real
                  </v-btn>
                </template>
              </ImportRunCard>
            </template>

            <template v-else>
              <header class="flex flex-col gap-1">
                <h3 class="m-0 text-base font-semibold tracking-tight text-ink">
                  {{ STEP_TITLES[step] }}
                </h3>
                <p v-if="step === 'source'" class="m-0 text-xs text-ink/60">
                  The source decides how the file is read and how its passwords are treated,
                  so it comes first.
                </p>
                <p v-else-if="step === 'file'" class="m-0 text-xs text-ink/60">
                  {{ source ? sourceInfo(source).how : "" }}
                </p>
                <p v-else-if="step === 'fields'" class="m-0 text-xs text-ink/60">
                  The guess is filled in from the column names. Check the first value beside
                  each one; a wrong column here is a wrong password for everyone.
                </p>
                <p v-else class="m-0 text-xs text-ink/60">
                  Nothing has been sent yet. A dry run checks every row and writes nothing.
                </p>
              </header>

              <ImportSourceGrid v-if="step === 'source'" v-model="source" />

              <template v-else-if="step === 'file'">
                <ImportDropzone v-model="file" :accept="accepted" />

                <div
                  v-if="mismatch && detected"
                  class="flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-3 py-2.5 text-xs text-ink"
                  role="status"
                >
                  <Icon aria-hidden="true" class="mt-px flex-none text-sm text-warning" name="material-symbols:warning-outline" />
                  <span class="flex-1">
                    This file looks like a {{ sourceInfo(detected).label }} export, and you chose
                    {{ source ? sourceInfo(source).label : "another source" }}. The source decides
                    how passwords are read.
                  </span>
                  <button
                    class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                    type="button"
                    @click="source = detected"
                  >
                    Use {{ sourceInfo(detected).label }}
                  </button>
                </div>

                <section v-if="source === 'firebase'" class="flex flex-col gap-1">
                  <h4 class="m-0 text-xs font-medium text-ink">Password hash parameters</h4>
                  <p class="m-0 mb-2 text-[11px] text-ink/50">
                    From the Firebase console, under Authentication, Users, then "Password hash
                    parameters". They belong to the project and the export leaves them out;
                    without them no scrypt hash can be verified.
                  </p>
                  <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    <div class="flex flex-col gap-2 sm:col-span-2">
                      <label class="text-xs font-medium opacity-70" for="fb-signer">Signer key</label>
                      <v-text-field
                        id="fb-signer"
                        v-model="firebase.signerKey"
                        autocomplete="off"
                        class="font-mono"
                        hide-details
                        placeholder="base64"
                        variant="underlined"
                      />
                    </div>
                    <div class="flex flex-col gap-2">
                      <label class="text-xs font-medium opacity-70" for="fb-separator">Salt separator</label>
                      <v-text-field
                        id="fb-separator"
                        v-model="firebase.saltSeparator"
                        autocomplete="off"
                        class="font-mono"
                        hide-details
                        variant="underlined"
                      />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                      <div class="flex flex-col gap-2">
                        <label class="text-xs font-medium opacity-70" for="fb-rounds">Rounds</label>
                        <v-text-field
                          id="fb-rounds"
                          v-model.number="firebase.rounds"
                          class="font-mono"
                          hide-details
                          type="number"
                          variant="underlined"
                        />
                      </div>
                      <div class="flex flex-col gap-2">
                        <label class="text-xs font-medium opacity-70" for="fb-mem">Memory cost</label>
                        <v-text-field
                          id="fb-mem"
                          v-model.number="firebase.memoryCost"
                          class="font-mono"
                          hide-details
                          type="number"
                          variant="underlined"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </template>

              <template v-else-if="step === 'fields' && file">
                <ImportMappingTable v-model="mapping" :keys="file.keys" :records="file.records" />

                <section class="flex flex-col gap-3">
                  <h4 class="m-0 text-xs font-medium text-ink">Options</h4>
                  <div class="flex flex-col gap-2">
                    <div class="flex flex-col gap-1.5">
                      <span class="text-xs text-ink/70">When an email already exists on this project</span>
                      <SegmentedControl
                        v-model="duplicates"
                        :options="[
                          { value: 'skip', label: 'Skip the row' },
                          { value: 'update', label: 'Update the account' },
                        ]"
                        label="Existing accounts"
                      />
                    </div>
                    <label class="mt-1 flex cursor-pointer items-start gap-2 text-xs text-ink">
                      <v-checkbox-btn v-model="options.verifyAll" class="-mt-1.5 -ml-1.5" color="primary" density="compact" />
                      <span class="flex flex-col gap-0.5 pt-px">
                        Treat every email as verified
                        <span class="text-[11px] text-ink/50">
                          Only if the source verified them and the column says nothing. A
                          verified address is what other sign-ins can be linked on.
                        </span>
                      </span>
                    </label>
                  </div>
                </section>
              </template>

              <template v-else-if="step === 'review' && analysis">
                <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div
                    v-for="figure in review"
                    :key="figure.label"
                    class="flex flex-col gap-1 rounded-(--idenzy-radius-small) border border-line bg-canvas px-3 py-2.5"
                  >
                    <dt class="text-[11px] text-ink/55">{{ figure.label }}</dt>
                    <dd :class="figure.tone || 'text-ink'" class="m-0 font-mono text-lg leading-none font-medium tabular-nums">
                      {{ figure.value.toLocaleString("en") }}
                    </dd>
                  </div>
                </dl>

                <div class="grid gap-4 sm:grid-cols-2">
                  <section class="flex flex-col gap-2">
                    <h4 class="m-0 text-xs font-medium text-ink">Passwords</h4>
                    <ul v-if="kept.length > 0" class="m-0 flex list-none flex-col gap-1 p-0 text-xs">
                      <li v-for="entry in kept" :key="entry.label" class="flex items-center gap-2">
                        <Icon aria-hidden="true" class="text-sm text-success" name="material-symbols:check-circle-outline" />
                        <span class="font-mono tabular-nums text-ink">{{ entry.count.toLocaleString("en") }}</span>
                        <span class="text-ink/70">{{ entry.label }}, verified as they are and upgraded on first sign-in</span>
                      </li>
                      <li v-if="analysis.passwordsDropped > 0" class="flex items-center gap-2">
                        <Icon aria-hidden="true" class="text-sm text-warning" name="material-symbols:key-off-outline" />
                        <span class="font-mono tabular-nums text-ink">{{ analysis.passwordsDropped.toLocaleString("en") }}</span>
                        <span class="text-ink/70">in a format we cannot verify. These accounts set a new password.</span>
                      </li>
                      <li v-if="analysis.withoutPassword > 0" class="flex items-center gap-2">
                        <Icon aria-hidden="true" class="text-sm text-ink/40" name="material-symbols:mail-outline" />
                        <span class="font-mono tabular-nums text-ink">{{ analysis.withoutPassword.toLocaleString("en") }}</span>
                        <span class="text-ink/70">without a password, who sign in by a code.</span>
                      </li>
                    </ul>
                    <p v-else class="m-0 text-xs text-ink/60">
                      No password hashes in this file. Every account signs in by a code to its
                      address, or sets a password on first visit.
                    </p>
                  </section>

                  <section class="flex flex-col gap-2">
                    <h4 class="m-0 text-xs font-medium text-ink">Rows with a problem</h4>
                    <ul v-if="issues.length > 0" class="m-0 flex list-none flex-col gap-1 p-0 text-xs">
                      <li v-for="entry in issues" :key="entry.label" class="flex items-center gap-2">
                        <span class="font-mono tabular-nums text-ink">{{ entry.count.toLocaleString("en") }}</span>
                        <span class="text-ink/70">{{ entry.label }}</span>
                      </li>
                    </ul>
                    <p v-else class="m-0 text-xs text-ink/60">Every row has an address and reads cleanly.</p>
                    <p class="m-0 text-[11px] text-ink/50">
                      A refused row is listed in the report after the run, with its line number,
                      so the file can be fixed and sent again.
                    </p>
                  </section>
                </div>

                <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
                  <v-checkbox-btn v-model="options.dryRun" class="-mt-1.5 -ml-1.5" color="primary" density="compact" />
                  <span class="flex flex-col gap-0.5 pt-px">
                    Dry run
                    <span class="text-[11px] text-ink/50">
                      Checks every row against the project and writes nothing. The report is the
                      same one the real run would give.
                    </span>
                  </span>
                </label>
              </template>
            </template>
          </div>

          <footer
            v-if="!job"
            class="flex items-center justify-between gap-3 border-t border-line px-5 py-3"
          >
            <v-btn
              :disabled="step === 'source'"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:chevron-left"
              size="small"
              variant="text"
              @click="back"
            >
              Back
            </v-btn>
            <div class="flex items-center gap-2">
              <span v-if="step === 'review' && analysis" class="text-[11px] text-ink/50">
                Recorded in the audit log with who ran it and when.
              </span>
              <FancyButton
                v-if="step === 'review'"
                :disabled="!ready.review"
                @click="run(options.dryRun)"
              >
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:play-arrow" />
                {{ options.dryRun ? "Run the dry run" : "Run the import" }}
              </FancyButton>
              <FancyButton v-else :disabled="!ready[step]" @click="next">
                Continue
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
              </FancyButton>
            </div>
          </footer>
        </LayerCard>

        <LayerCard v-else-if="!store.loading && jobs.length === 0" :padded="false">
          <EmptyState
            description="Bring your users over from Firebase, Supabase, Auth0, Clerk, Cognito or a file of your own. Where the source exports password hashes they come too, and nobody is asked to reset."
            icon="material-symbols:upload-file-outline"
            title="No imports yet"
          >
            <template #actions>
              <FancyButton @click="begin">
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                Start an import
              </FancyButton>
              <v-btn
                :href="GUIDES_URL"
                class="text-xs font-medium"
                color="neutral"
                rel="noopener"
                size="small"
                target="_blank"
                variant="outlined"
              >
                Read the guides
              </v-btn>
            </template>
          </EmptyState>
        </LayerCard>

        <LayerCard
          v-if="store.loading || jobs.length > 0"
          :padded="false"
          description="Every run on this project, dry runs included."
          title="Past imports"
        >
          <DataTable
            v-model:column-state="columnState"
            v-model:items-per-page="pageSize"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :columns="COLUMNS"
            :items="jobs"
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
              <span :class="item.failed > 0 ? 'text-error' : 'text-ink/35'" class="font-mono tabular-nums">
                {{ item.failed }}
              </span>
            </template>
            <template #cell.skipped="{ item }">
              <span :class="item.skipped > 0 ? 'text-ink' : 'text-ink/35'" class="font-mono tabular-nums">
                {{ item.skipped }}
              </span>
            </template>
            <template #cell.passwordsKept="{ item }">
              <span class="font-mono tabular-nums text-ink">{{ item.passwordsKept.toLocaleString("en") }}</span>
              <span v-if="item.passwordsDropped > 0" class="font-mono text-[11px] tabular-nums text-warning">
                · {{ item.passwordsDropped }} dropped
              </span>
            </template>
            <template #cell.status="{ item }">
              <StatusBadge :label="statusOf(item).label" :tone="statusOf(item).tone" />
            </template>
          </DataTable>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Migration</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="3" :series="metrics.daily" :value="metrics.usersImported" label="Users imported" />
          <UsageTile :seed="5" :value="metrics.imports" info="Runs that wrote users. Dry runs are not counted." label="Imports run" />
          <UsageTile :seed="7" :value="metrics.passwordsUpgraded" info="Imported password hashes rehashed to Argon2id at a sign-in. The legacy hash is gone once this happens." label="Hashes upgraded" />
          <UsageTile :seed="11" :value="metrics.awaitingUpgrade" info="Imported accounts still on their original hash, because they have not signed in since." label="Awaiting sign-in" />
        </div>

        <LayerCard :padded="false" title="Guides">
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li v-for="guide in guides" :key="guide.href">
              <a
                :href="guide.href"
                class="flex items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
                rel="noopener"
                target="_blank"
              >
                <Icon
                  :class="[guide.monochrome ? '[.v-theme--dark_&]:invert' : '', guide.tint]"
                  :name="guide.icon"
                  aria-hidden="true"
                  class="mt-px flex-none text-xl text-ink"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="font-medium text-ink">{{ guide.title }}</span>
                  <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
                </span>
              </a>
            </li>
          </ul>
          <div class="border-t border-line p-2">
            <v-btn
              :href="GUIDES_URL"
              block
              class="text-xs font-medium"
              color="neutral"
              rel="noopener"
              size="small"
              target="_blank"
              variant="outlined"
            >
              All guides
            </v-btn>
          </div>
        </LayerCard>
      </aside>
    </div>
  </div>
</template>
