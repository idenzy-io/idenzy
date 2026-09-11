<script setup lang="ts">
/**
 * A job as it runs and as it ended: the bar, the six figures, and the rows that were
 * refused with the reason for each. The figures climb with the bar, so the operator
 * watches rows land rather than a bar that fills and then a number that appears. A
 * dry run says so in the heading and in the past tense of "would", because a rehearsal
 * that read like the real thing is one that gets run twice.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  IMPORT_OUTCOME_LABELS,
  type ImportJob,
  type ImportOutcome,
  importOutcome,
  sourceInfo,
} from "~/utils/import";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  job: ImportJob;
}>();

/* The label is the history table's; only the colour is this card's. */
const TONES: Record<ImportOutcome, BadgeTone> = {
  queued: "neutral",
  running: "warning",
  done: "success",
  failed: "error",
  "dry-run": "neutral",
};

const status = computed(() => {
  const outcome = importOutcome(props.job);
  return { label: IMPORT_OUTCOME_LABELS[outcome], tone: TONES[outcome] };
});

const percent = computed(() => Math.round(props.job.progress * 100));
const verb = computed(() => (props.job.dryRun ? "would be" : "were"));

const figures = computed(() => [
  { label: "Rows read", value: props.job.rows, tone: "" },
  {
    label: `${props.job.dryRun ? "Would import" : "Imported"}`,
    value: props.job.imported,
    tone: "text-success",
  },
  { label: "Skipped", value: props.job.skipped, tone: props.job.skipped > 0 ? "text-warning" : "" },
  { label: "Failed", value: props.job.failed, tone: props.job.failed > 0 ? "text-error" : "" },
  { label: "Passwords kept", value: props.job.passwordsKept, tone: "" },
  {
    label: "Passwords dropped",
    value: props.job.passwordsDropped,
    tone: props.job.passwordsDropped > 0 ? "text-warning" : "",
  },
]);

const SHOWN_ERRORS = 5;

function report() {
  const lines = [
    "line,email,reason",
    ...props.job.errors.map((error) =>
      [error.line, error.email ?? "", error.reason]
        .map((value) => {
          const text = String(value);
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${props.job.fileName.replace(/\.[^.]+$/, "")}-errors.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3">
      <span class="flex size-9 flex-none items-center justify-center text-ink">
        <Icon
          :class="[
            sourceInfo(job.source).monochrome ? '[.v-theme--dark_&]:invert' : '',
            sourceInfo(job.source).tint ?? '',
          ]"
          :name="sourceInfo(job.source).icon"
          aria-hidden="true"
          class="text-[28px]"
        />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p class="m-0 flex items-center gap-2 text-sm font-medium text-ink">
          <span class="truncate">{{ job.fileName }}</span>
          <StatusBadge :label="status.label" :tone="status.tone" />
        </p>
        <p class="m-0 text-xs text-ink/55">
          {{ sourceInfo(job.source).label }} · started
          <span class="font-mono tabular-nums">{{ formatDateTime(job.startedAt) }}</span>
          by {{ job.startedBy }}
        </p>
      </div>
      <span class="font-mono text-sm tabular-nums text-ink">{{ percent }}%</span>
    </div>

    <div
      :aria-valuenow="percent"
      aria-label="Progress"
      aria-valuemax="100"
      aria-valuemin="0"
      class="h-1.5 overflow-hidden rounded-full bg-ink/8"
      role="progressbar"
    >
      <div
        :class="job.status === 'done' ? 'bg-success' : 'bg-primary'"
        :style="{ width: `${percent}%` }"
        class="h-full rounded-full transition-[width] duration-150 ease-out"
      />
    </div>

    <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div
        v-for="figure in figures"
        :key="figure.label"
        class="flex flex-col gap-1 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5"
      >
        <dt class="text-[11px] text-ink/55">{{ figure.label }}</dt>
        <dd :class="figure.tone || 'text-ink'" class="m-0 font-mono text-lg leading-none font-medium tabular-nums">
          {{ figure.value.toLocaleString("en") }}
        </dd>
      </div>
    </dl>

    <p v-if="job.status === 'done' && job.passwordsKept > 0" class="m-0 text-xs text-ink/60">
      <span class="font-mono tabular-nums text-ink">{{ job.passwordsKept.toLocaleString("en") }}</span>
      {{ job.passwordsKept === 1 ? "password" : "passwords" }} {{ verb }} kept in their original
      format. Each is verified with the legacy algorithm on its next sign-in and rehashed with
      Argon2id then, so nobody is asked to reset.
    </p>

    <div v-if="job.errors.length > 0 && job.status === 'done'" class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <h3 class="m-0 text-xs font-medium text-ink">
          Rows not imported
          <span class="font-mono font-normal text-ink/50">· {{ job.errors.length }}</span>
        </h3>
        <button
          class="inline-flex items-center gap-1 text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink"
          type="button"
          @click="report"
        >
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:download" />
          Download the report
        </button>
      </div>
      <ul class="m-0 list-none divide-y divide-line overflow-hidden rounded-(--idenzy-radius-small) border border-line p-0 text-xs">
        <li
          v-for="error in job.errors.slice(0, SHOWN_ERRORS)"
          :key="error.line"
          class="flex items-center gap-3 px-3 py-2"
        >
          <span class="font-mono text-[11px] tabular-nums text-ink/50">line {{ error.line }}</span>
          <span class="truncate font-mono text-[11px] text-ink/80">{{ error.email ?? "–" }}</span>
          <span class="ml-auto text-ink/60">{{ error.reason }}</span>
        </li>
        <li v-if="job.errors.length > SHOWN_ERRORS" class="px-3 py-2 text-[11px] text-ink/50">
          And {{ job.errors.length - SHOWN_ERRORS }} more in the report.
        </li>
      </ul>
    </div>

    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
