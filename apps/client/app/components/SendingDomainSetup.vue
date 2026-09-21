<script setup lang="ts">
/**
 * One domain's setup: the four steps, the records it is waiting on, and the two actions
 * that move it along (notes/email-domains.md).
 *
 * The body of `SendingDomainRecordsDialog`, capped on a desktop and a full-height sheet
 * below `lg`, the way the revocation setup opens. It holds no layout of its own for the
 * two shapes: the header, the steps and the footer are `flex-none` and the records scroll
 * between them, so the same component fills a phone and sits inside a cap.
 *
 * The records are one table and not four groups. A group per kind repeated a heading, a
 * paragraph and a column strip five times over five records, and what a reader is doing
 * here is working down a list in a console: what each record is for belongs on its own
 * row, at the length a row can carry, with the paragraph behind the glyph beside it.
 *
 * The name a console wants is a choice above the table rather than a caveat under every
 * row. Most consoles append the zone themselves, and a fully qualified name pasted into
 * one of those becomes `token._domainkey.acme.com.acme.com`: the record exists, the check
 * never finds it, and nothing in either console says why. Both forms are correct, in
 * different consoles, so the reader picks one and the column and its copy button agree.
 *
 * `Check records` is the action until every required record resolves and `Send from this`
 * is the action afterwards. They are never both primary: verifying a domain and sending
 * from it are two decisions, and the whole screen is built so the first cannot become the
 * second by accident.
 */
import type { RecordColumn } from "~/components/RecordTable.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import {
  CHECK_EVERY_MINUTES,
  isSetupComplete,
  missingRecords,
  type NameForm,
  RECORD_TTL,
  recordFinding,
  recordKindInfo,
  recordName,
  recordProgress,
  relativeHost,
  SETUP_STEPS,
  type SendingDomain,
  sendingState,
  setupStage,
  verificationState,
} from "~/utils/sending-domains";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  domain: SendingDomain;
  busy: boolean;
  /** Names the dialog for a screen reader, so the heading here is the accessible one. */
  titleId: string;
}>();

const emit = defineEmits<{
  check: [];
  use: [];
  remove: [];
  close: [];
}>();

const now = useNow({ interval: 30_000 });

const verification = computed(() => verificationState(props.domain));
const sending = computed(() => sendingState(props.domain));
const progress = computed(() => recordProgress(props.domain));
const outstanding = computed(() => missingRecords(props.domain));
const stage = computed(() => setupStage(props.domain));
const stageNumber = computed(() => SETUP_STEPS.findIndex((step) => step.id === stage.value) + 1);
const stageLabel = computed(() => SETUP_STEPS.find((step) => step.id === stage.value)?.label ?? "");
const complete = computed(() => isSetupComplete(props.domain));

/*
 * The records, as a console asks for them.
 */

const COLUMNS: readonly RecordColumn[] = [
  { key: "record", label: "Record", width: "142px" },
  { key: "type", label: "Type", width: "78px" },
  { key: "name", label: "Name", width: "minmax(0, 1.15fr)" },
  { key: "value", label: "Value", width: "minmax(0, 1fr)" },
  { key: "status", label: "Status", width: "132px", align: "end" },
];

const NAME_FORMS: readonly SegmentedOption[] = [
  { value: "full", label: "Full", title: "The fully qualified name" },
  { value: "relative", label: "Relative", title: "The name without the zone" },
];

/* Full by default: a console that does not append the zone refuses a relative name
   outright, which is the failure somebody notices, and the other one is silent. */
const nameForm = ref("full");

/* The control's model is a string, as every segmented control's is. Narrowed once here
   rather than cast at each of the three places that read it. */
const form = computed<NameForm>(() => (nameForm.value === "relative" ? "relative" : "full"));

const rows = computed(() =>
  props.domain.records.map((record) => ({
    record,
    kind: recordKindInfo(record.kind),
    name: recordName(record, props.domain.domain, form.value),
    finding: recordFinding(record),
  })),
);

/** The name the relative form would ask for, as an example under the control. */
const sample = computed(() => {
  const first = props.domain.records[0];
  return first === undefined ? "" : relativeHost(first.host, props.domain.domain);
});

const checkedAgo = computed(() => {
  const at = props.domain.checkedAt;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

/**
 * What is outstanding, named as the table names it. `CNAME, MX, TXT` is the DNS type and
 * not the thing to go and look at: three of the five records are CNAMEs, so a reader
 * counting them against the list finds two answers for one word.
 */
const waitingOn = computed(() =>
  [...new Set(outstanding.value.map((record) => recordKindInfo(record.kind).label))].join(", "),
);

/** What to do now, in one line, keyed off the step rather than off the badge. */
const guidance = computed(() => {
  switch (stage.value) {
    case "publish":
      return outstanding.value.length === progress.value.required
        ? "Add the records below at your DNS provider. Nothing sends from this domain until every required one resolves."
        : `${outstanding.value.length} required record${outstanding.value.length === 1 ? "" : "s"} still to publish. The ones already found need no further attention.`;
    case "verify":
      return "Every required record is published. The check confirms it on its own within a few minutes, or ask it now.";
    default:
      return props.domain.inUse
        ? "Verified and carrying this project's From line. Nothing further to do here."
        : "Verified. Moving the From line to it is a separate decision, and it changes the address every user sees.";
  }
});

const STATUS_MARKS: Record<string, { icon: string; tone: string }> = {
  found: { icon: "material-symbols:check-circle-outline", tone: "text-success" },
  missing: { icon: "material-symbols:error-outline", tone: "text-warning" },
  pending: { icon: "material-symbols:pending-outline", tone: "text-ink/40" },
};
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- The domain, and both of its states. Neither one alone: a reader who saw only
         "Verified" would have no way to tell whether their mail already comes from it. -->
    <header
      class="flex flex-none flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="flex min-w-0 flex-col gap-2">
        <h2 :id="titleId" class="m-0 font-mono text-sm break-all text-ink">
          {{ domain.domain }}
        </h2>
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :label="verification.label" :tone="verification.tone" />
          <StatusBadge :label="sending.label" :tone="sending.tone" />
          <StatusBadge v-if="complete" label="Complete" tone="success" />
        </div>
      </div>

      <div class="flex flex-none items-center gap-2">
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:link-off"
          size="small"
          variant="text"
          @click="emit('remove')"
        >
          Remove
        </v-btn>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="emit('close')"
        >
          Close
        </v-btn>
      </div>
    </header>

    <!-- Four steps, and the one being read is the one with work in it. Below `sm` the
         strip is the step in words: four labels and their rails are wider than a phone,
         and a step strip that scrolls sideways has stopped saying where you are. -->
    <div class="flex flex-none flex-col gap-2 border-b border-line px-4 py-3">
      <span class="text-xs font-medium text-ink sm:hidden">
        Step {{ stageNumber }} of {{ SETUP_STEPS.length }} &middot; {{ stageLabel }}
      </span>
      <Steps :current="stage" :steps="SETUP_STEPS" class="hidden sm:flex" />
      <p class="m-0 text-xs leading-5 text-ink/65">{{ guidance }}</p>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h3 class="m-0 text-xs font-medium text-ink">DNS records</h3>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            At the provider that answers for
            <span class="font-mono text-ink/75">{{ domain.domain }}</span
            >. TTL {{ RECORD_TTL }}, or whatever your console defaults to.
          </p>
        </div>
        <SegmentedControl v-model="nameForm" :options="NAME_FORMS" label="Name to paste" />
      </div>

      <!-- Said once, above the column, instead of on all five rows. Both forms are
           correct and which one is correct is a fact about the reader's console. -->
      <p class="m-0 text-[11px] leading-4 text-ink/50">
        <template v-if="form === 'relative'">
          Names without the zone, for a console that adds
          <span class="font-mono text-ink/70">{{ domain.domain }}</span> to whatever you type.
          Most do.
        </template>
        <template v-else>
          Fully qualified names. If your console adds
          <span class="font-mono text-ink/70">{{ domain.domain }}</span> for you, switch to
          Relative and paste <span class="font-mono text-ink/70">{{ sample }}</span> instead:
          otherwise the record is published under the domain twice, and the check never finds
          it.
        </template>
      </p>

      <RecordTable :columns="COLUMNS" framed label="DNS records">
        <li v-for="row in rows" :key="row.record.id" class="record-row">
          <span class="record-cell record-cell--primary flex min-w-0 flex-col gap-1">
            <span class="flex min-w-0 items-center gap-1.5">
              <Icon
                :name="row.kind.icon"
                aria-hidden="true"
                class="flex-none text-sm text-ink/60"
              />
              <span class="truncate text-xs font-medium text-ink">{{ row.kind.label }}</span>
              <v-tooltip :text="row.kind.note" location="top" max-width="320">
                <template #activator="{ props: tip }">
                  <button
                    v-bind="tip"
                    :aria-label="`What ${row.kind.label} is for`"
                    class="inline-flex flex-none text-ink/35 transition-colors duration-150 hover:text-ink/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    type="button"
                  >
                    <Icon
                      aria-hidden="true"
                      class="text-xs"
                      name="material-symbols:info-outline"
                    />
                  </button>
                </template>
              </v-tooltip>
            </span>
            <span
              :class="row.kind.required ? 'text-ink/50' : 'text-primary'"
              class="text-[10px] leading-4 font-medium"
            >
              {{ row.kind.required ? "Required" : "Recommended" }}
            </span>
          </span>

          <span class="record-cell record-cell--half flex flex-col gap-0.5" data-label="Type">
            <span class="font-mono text-[11px] text-ink/80">{{ row.record.type }}</span>
            <span
              v-if="row.record.priority !== undefined"
              class="font-mono text-[10px] leading-4 text-ink/45"
            >
              pri {{ row.record.priority }}
            </span>
          </span>

          <span class="record-cell" data-label="Name">
            <CopyField
              :label="`Copy the name for the ${row.kind.label} record`"
              :value="row.name"
              dense
              wrap
            />
          </span>

          <span class="record-cell" data-label="Value">
            <CopyField
              :label="`Copy the value for the ${row.kind.label} record`"
              :value="row.record.value"
              dense
              wrap
            />
          </span>

          <span
            class="record-cell record-cell--action record-cell--end flex flex-col items-end gap-0.5"
            data-label="Status"
          >
            <span
              :class="STATUS_MARKS[row.record.status]?.tone"
              class="flex items-center gap-1.5 text-[11px] whitespace-nowrap"
            >
              <Icon
                :name="STATUS_MARKS[row.record.status]?.icon ?? 'material-symbols:pending-outline'"
                aria-hidden="true"
                class="flex-none text-sm"
              />
              {{ row.finding.label }}
            </span>
            <!-- Only where the answer is not the one every other row is giving: five
                 copies of "not looked for yet" is a column of noise. -->
            <span
              v-if="row.record.status === 'missing'"
              class="text-[10px] leading-4 text-ink/50"
            >
              {{ row.finding.detail }}
            </span>
          </span>
        </li>
      </RecordTable>
    </div>

    <!-- What the last check found and when, beside the two actions. Below `lg` the
         buttons stack full width under it, which is where a thumb is. -->
    <footer
      class="flex flex-none flex-col gap-3 border-t border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div class="flex min-w-0 flex-col gap-0.5">
        <p class="m-0 text-[11px] leading-4 text-ink/60">
          <span class="font-mono tabular-nums">{{ progress.found }}/{{ progress.required }}</span>
          required records found.
          <template v-if="waitingOn">Waiting on {{ waitingOn }}.</template>
        </p>
        <p class="m-0 text-[11px] leading-4 text-ink/45">
          <template v-if="checkedAgo">
            Checked {{ checkedAgo }} ({{ formatDateTime(domain.checkedAt ?? "") }}), and again
            about every {{ CHECK_EVERY_MINUTES }} minutes on its own.
          </template>
          <template v-else>
            Not checked yet. The first look runs within a few minutes of adding the domain.
          </template>
        </p>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-none">
        <v-btn
          :color="stage === 'select' ? 'neutral' : 'primary'"
          :loading="busy"
          :variant="stage === 'select' ? 'outlined' : 'flat'"
          class="text-xs font-medium"
          prepend-icon="material-symbols:refresh"
          size="small"
          @click="emit('check')"
        >
          Check records
        </v-btn>
        <v-btn
          v-if="!domain.inUse"
          :disabled="stage !== 'select'"
          class="text-xs font-medium"
          color="primary"
          prepend-icon="material-symbols:outgoing-mail"
          size="small"
          variant="flat"
          @click="emit('use')"
        >
          Send from this
        </v-btn>
      </div>
    </footer>
  </div>
</template>
