<script setup lang="ts">
/**
 * Running an import, in the dialog the "New import" button opens. Four steps: the
 * source first, because it decides how the file is read and how its passwords are
 * treated; the file, read in the browser and its columns mapped to our fields with the
 * guess from `inferMapping` filled in; and a review that says exactly what the import
 * would do before it does it, because the numbers that matter are the ones the operator
 * has not thought of. A dry run is the same job with nothing written, and it sits beside
 * the real one rather than behind a flag.
 *
 * A dialog rather than a card on the page, and a wide one: the source cards, the mapping
 * table and the review figures are all several columns of their own, and a wizard that
 * has to be scrolled past to reach the history is in the way of the screen it belongs to.
 *
 * The fields here stay underlined while the panel's other dialogs are filled: this is a
 * form somebody works through rather than one setting they came to change.
 *
 * The file, the parsing and the analysis are real and never leave the browser. What the
 * run does is the store's placeholder until the management API client exists.
 */
import type { ImportFile } from "~/components/ImportDropzone.vue";
import type { Step } from "~/components/Steps.vue";
import {
  analyse,
  detectSource,
  EMPTY_FIREBASE_HASH_CONFIG,
  type FirebaseHashConfig,
  firebaseHashConfigComplete,
  HASH_LABELS,
  type HashKind,
  type ImportSource,
  ISSUE_LABELS,
  type Issue,
  inferMapping,
  type Mapping,
  sourceInfo,
} from "~/utils/import";

const open = defineModel<boolean>({ required: true });

const projects = useProjectStore();
const store = useImportsStore();

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

/* Every opening is a new import. A dialog that came back holding the last file would
   run it again on the click somebody meant for a fresh one. */
function begin() {
  step.value = "source";
  source.value = null;
  file.value = null;
  firebase.value = { ...EMPTY_FIREBASE_HASH_CONFIG };
  mapping.value = {};
  options.value = { duplicates: "skip", verifyAll: false, dryRun: false };
  runningId.value = null;
}

watch(open, (opened) => {
  if (opened) begin();
});

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
</script>

<template>
  <!-- Full width to the cap rather than the content's own width: the source cards,
       the mapping table and the review figures each want a row of their own, and a
       dialog that shrank to fit the narrowest step would rewrap on every one. -->
  <v-dialog v-model="open" max-width="1040" scrollable width="100%">
    <v-card border flat>
      <div class="flex max-h-[86vh] flex-col">
        <!-- The steps are the dialog's title: what this is, and how far through it the
             reader is, in one line. -->
        <header class="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
          <Steps v-if="!job" :current="step" :steps="STEPS" @select="jump" />
          <h2 v-else class="m-0 truncate text-sm font-medium text-ink">
            {{ job.dryRun ? "Dry run" : "Import" }} · {{ job.fileName }}
          </h2>
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            <!-- Cancel is only honest while nothing has been written. Once a job exists
                 the run goes on without this dialog, and the history has it. -->
            {{ job ? "Close" : "Cancel" }}
          </v-btn>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-line p-5">
          <template v-if="job">
            <ImportRunCard :job="job">
              <template v-if="job.status === 'done'" #actions>
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:add"
                  size="small"
                  variant="text"
                  @click="begin"
                >
                  Import another
                </v-btn>
                <v-btn
                  v-if="!job.dryRun"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  to="/users"
                  variant="text"
                >
                  View users
                </v-btn>
                <v-btn
                  v-else
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="text"
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
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm text-warning"
                  name="material-symbols:warning-outline"
                />
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

              <!-- Held to a readable measure: a flex column stretches its children, so a
                   segmented control and a checkbox's own text would otherwise run the
                   dialog's full width. -->
              <section class="flex max-w-2xl flex-col gap-3">
                <h4 class="m-0 text-xs font-medium text-ink">Options</h4>
                <div class="flex flex-col gap-2">
                  <div class="flex flex-col items-start gap-1.5">
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
                  <label class="mt-1 flex max-w-2xl cursor-pointer items-start gap-2 text-xs text-ink">
                    <v-checkbox-btn
                      v-model="options.verifyAll"
                      class="-mt-1.5 -ml-1.5 flex-none"
                      color="primary"
                      density="compact"
                    />
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
                  class="flex flex-col gap-1 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5"
                >
                  <dt class="text-[11px] text-ink/55">{{ figure.label }}</dt>
                  <dd
                    :class="figure.tone || 'text-ink'"
                    class="m-0 font-mono text-lg leading-none font-medium tabular-nums"
                  >
                    {{ figure.value.toLocaleString("en") }}
                  </dd>
                </div>
              </dl>

              <div class="grid gap-4 sm:grid-cols-2">
                <section class="flex flex-col gap-2">
                  <h4 class="m-0 text-xs font-medium text-ink">Passwords</h4>
                  <ul v-if="kept.length > 0" class="m-0 flex list-none flex-col gap-1 p-0 text-xs">
                    <li v-for="entry in kept" :key="entry.label" class="flex items-center gap-2">
                      <Icon
                        aria-hidden="true"
                        class="text-sm text-success"
                        name="material-symbols:check-circle-outline"
                      />
                      <span class="font-mono tabular-nums text-ink">{{ entry.count.toLocaleString("en") }}</span>
                      <span class="text-ink/70">{{ entry.label }}, verified as they are and upgraded on first sign-in</span>
                    </li>
                    <li v-if="analysis.passwordsDropped > 0" class="flex items-center gap-2">
                      <Icon
                        aria-hidden="true"
                        class="text-sm text-warning"
                        name="material-symbols:key-off-outline"
                      />
                      <span class="font-mono tabular-nums text-ink">{{ analysis.passwordsDropped.toLocaleString("en") }}</span>
                      <span class="text-ink/70">in a format we cannot verify. These accounts set a new password.</span>
                    </li>
                    <li v-if="analysis.withoutPassword > 0" class="flex items-center gap-2">
                      <Icon
                        aria-hidden="true"
                        class="text-sm text-ink/40"
                        name="material-symbols:mail-outline"
                      />
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

              <label class="flex max-w-2xl cursor-pointer items-start gap-2 text-xs text-ink">
                <v-checkbox-btn
                  v-model="options.dryRun"
                  class="-mt-1.5 -ml-1.5 flex-none"
                  color="primary"
                  density="compact"
                />
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
            <v-btn
              v-if="step === 'review'"
              :disabled="!ready.review"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:play-arrow"
              size="small"
              variant="text"
              @click="run(options.dryRun)"
            >
              {{ options.dryRun ? "Run the dry run" : "Run the import" }}
            </v-btn>
            <v-btn
              v-else
              :disabled="!ready[step]"
              append-icon="material-symbols:chevron-right"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="next"
            >
              Continue
            </v-btn>
          </div>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
