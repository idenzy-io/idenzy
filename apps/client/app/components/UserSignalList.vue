<script setup lang="ts">
/**
 * What the detectors recorded about one account, and what was decided about it.
 *
 * The same `RecordTable` the sessions above it use, with the last three tracks the same
 * width in the same order, so the two lists share a right edge and read as one register
 * rather than as two tables somebody laid out on different days.
 *
 * A row opens into what the signal means, because a kind is a name for a pattern and the
 * name alone does not tell an operator whether to act. `KIND_NOTES` is what the security
 * centre says about the same detector, so the two cannot come to explain it differently.
 */
import type { RecordColumn, RecordTab } from "~/components/RecordTable.vue";
import {
  type DetectorCoverage,
  KIND_LABELS,
  KIND_NOTES,
  kindOf,
  SEVERITY_LABELS,
  type SecuritySignal,
  SIGNAL_STATE_LABELS,
  severityOf,
  watchingCount,
} from "~/utils/security";
import { formatDate, formatDateTime, relativeTime } from "~/utils/time";

const props = defineProps<{
  signals: readonly SecuritySignal[];
  now: Date;
  /** Every detector and whether it was looking, for the case where nothing was seen. */
  coverage: readonly DetectorCoverage[];
}>();

const watching = computed(() => watchingCount(props.coverage));
const unwatched = computed(() => props.coverage.filter((entry) => entry.state === "off"));

/**
 * "New country", "New country and SMS pumping", "A, B and C". The first name keeps its
 * capital because it opens the sentence; a comma before the last one reads as a fourth
 * item that is not there.
 */
const unwatchedNames = computed(() => {
  const names = unwatched.value.map((entry, index) =>
    index === 0 ? entry.label : entry.label.toLowerCase(),
  );
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
});

const COLUMNS: readonly RecordColumn[] = [
  { key: "finding", label: "Finding and evidence", width: "minmax(0, 1fr)" },
  { key: "seen", label: "Last seen", width: "132px" },
  { key: "state", label: "State", width: "104px" },
  { key: "chevron", label: "", width: "36px", align: "end" },
];

const tab = ref("all");

const open = computed(() => props.signals.filter((signal) => signal.state === "open").length);

const tabs = computed<RecordTab[]>(() => [
  { key: "all", label: "All signals", count: props.signals.length },
  { key: "open", label: "Open", count: open.value },
  { key: "decided", label: "Decided", count: props.signals.length - open.value },
]);

const shown = computed(() =>
  [...props.signals]
    .filter(
      (signal) =>
        tab.value === "all" ||
        (tab.value === "open" ? signal.state === "open" : signal.state !== "open"),
    )
    .sort((a, b) => b.seenAt.localeCompare(a.seenAt)),
);

/* Severity is the one thing on the row that is a judgement, so it is the one thing in
   colour. Everything else is ink. */
const TONES = {
  act: "signal-list__severity--act",
  review: "signal-list__severity--review",
  record: "signal-list__severity--record",
} as const;
</script>

<template>
  <!--
    Nothing recorded, drawn the way every other empty list on the panel is: a mark, what is
    missing, and a sentence. The coverage is now that sentence rather than a column of its
    own, because the reader needs the measurement ("six were looking") and not the roll call
    of the six. A detector somebody switched off is still named in full: an operator reading
    "no signals" on an account whose new-country rule is off has been told the opposite of
    the truth.
  -->
  <div v-if="signals.length === 0" class="flex flex-col items-center gap-1 px-4 py-14 text-center">
    <Icon aria-hidden="true" class="mb-1 text-2xl text-ink/25" name="material-symbols:radar" />
    <p class="m-0 text-sm font-medium text-ink">Nothing recorded on this account</p>
    <p class="m-0 max-w-md text-xs leading-5 text-ink/55">
      <span class="font-mono tabular-nums text-ink/80">{{ watching }}</span> of
      <span class="font-mono tabular-nums text-ink/80">{{ coverage.length }}</span> detectors
      are looking at every sign-in on this project, and none of them has seen anything here.
      That is a measurement, not a gap in the record.
    </p>
    <p
      v-if="unwatched.length > 0"
      class="m-0 mt-2 flex max-w-md items-start gap-1.5 text-left text-xs leading-5 text-warning"
    >
      <Icon aria-hidden="true" class="mt-0.5 shrink-0 text-sm" name="material-symbols:warning-outline" />
      <span>
        {{ unwatchedNames }} {{ unwatched.length === 1 ? "is" : "are" }} switched off on this
        project, so nothing here can be read as a clean record of
        {{ unwatched.length === 1 ? "it" : "them" }}.
      </span>
    </p>
  </div>

  <RecordTable v-else v-model:tab="tab" :columns="COLUMNS" :tabs="tabs" label="Security signals">
    <li v-for="signal in shown" :key="signal.id">
      <details class="signal-list__entry">
        <summary class="record-row">
          <span class="record-cell record-cell--primary signal-list__finding">
            <span class="signal-list__title">
              <span :class="TONES[severityOf(signal.evidence)]" class="signal-list__severity">
                <span aria-hidden="true" />
                {{ SEVERITY_LABELS[severityOf(signal.evidence)] }}
              </span>
              <span class="signal-list__kind">{{ KIND_LABELS[kindOf(signal)] }}</span>
            </span>
            <EvidenceLine :evidence="signal.evidence" />
          </span>

          <span class="record-cell record-cell--half signal-list__seen" data-label="Last seen">
            <time :datetime="signal.seenAt" :title="formatDateTime(signal.seenAt)">
              {{ relativeTime(signal.seenAt, now) }}
            </time>
            <span>{{ formatDate(signal.seenAt) }}</span>
          </span>

          <span class="record-cell record-cell--half" data-label="State">
            <StatusBadge
              :label="SIGNAL_STATE_LABELS[signal.state]"
              :tone="signal.state === 'open' ? 'warning' : 'neutral'"
            />
          </span>

          <span class="record-cell record-cell--action record-cell--end">
            <Icon
              aria-hidden="true"
              class="signal-list__chevron"
              name="material-symbols:keyboard-arrow-down"
            />
          </span>
        </summary>

        <div class="signal-list__context">
          <div>
            <h3>What this detector looks for</h3>
            <p>{{ KIND_NOTES[kindOf(signal)] }}</p>
          </div>
          <dl>
            <dt>Recorded at</dt>
            <dd>{{ formatDateTime(signal.seenAt) }}</dd>
          </dl>
        </div>
      </details>
    </li>

    <template #empty>
      <p v-if="shown.length === 0" class="signal-list__empty" role="status">
        {{ tab === "open" ? "Nothing is open on this account." : "Nothing has been decided yet." }}
        <button type="button" @click="tab = 'all'">Show all signals</button>
      </p>
    </template>
  </RecordTable>
</template>

<style scoped>
.signal-list__entry summary {
  list-style: none;
  cursor: pointer;
}

.signal-list__entry summary::-webkit-details-marker {
  display: none;
}

.signal-list__entry summary:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.signal-list__finding {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.signal-list__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
}

.signal-list__kind {
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}

/* The severity reads before the name, so it sits first and carries the only colour on
   the row. A dot and a word, never a pill. */
.signal-list__severity {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 16px;
}

.signal-list__severity > span {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  background: currentcolor;
}

.signal-list__severity--act {
  color: rgb(var(--v-theme-error));
}

.signal-list__severity--review {
  color: rgb(var(--v-theme-warning));
}

.signal-list__severity--record {
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.signal-list__seen {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-variant-numeric: tabular-nums;
}

.signal-list__seen time {
  font-style: normal;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.signal-list__seen > span {
  font-size: 11px;
  line-height: 16px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.signal-list__chevron {
  font-size: 16px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  transition: transform 150ms;
}

.signal-list__entry[open] .signal-list__chevron {
  transform: rotate(180deg);
}

/* The open half is indented to the finding column and set on the row's own ground: a
   tinted box inside a row inside a list is one edge too many. */
.signal-list__context {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 172px;
  gap: 24px;
  margin: 0 12px 20px;
  padding-top: 16px;
  border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.09);
}

.signal-list__context h3,
.signal-list__context dt {
  margin: 0 0 6px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.signal-list__context p,
.signal-list__context dd {
  margin: 0;
  max-width: 76ch;
  font-size: 12px;
  line-height: 20px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.signal-list__context dl {
  margin: 0;
}

.signal-list__context dd {
  font-variant-numeric: tabular-nums;
}

.signal-list__empty {
  padding: 28px 12px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.signal-list__empty button {
  margin-left: 6px;
  color: rgb(var(--v-theme-primary));
}

.signal-list__empty button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .signal-list__context {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    margin-inline: 0;
  }
}
</style>
