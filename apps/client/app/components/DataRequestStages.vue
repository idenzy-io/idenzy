<script setup lang="ts">
/**
 * A request's five stages on one line: received, verified, the work, the answer, closed.
 * Each stop says whether it happened and on which day, so the rail reads as the request's
 * own record and not as a progress bar that fills on a timer.
 *
 * Horizontal from `sm` in five even columns, so the labels fit a dialog's width; vertical
 * below, where five labels across a phone would each be cut. A failed stop is the only one
 * in the error colour, and a skipped one is dashed rather than hidden: a refused request
 * that never reached its work should say so, not look like one with four stages.
 */
import type { Stage, StageState } from "~/utils/data-requests";
import { formatDate } from "~/utils/time";

defineProps<{
  stages: readonly Stage[];
}>();

const MARKS: Record<StageState, string> = {
  done: "border-ink/25 text-ink",
  current: "border-primary bg-primary text-on-primary",
  running: "border-primary text-primary",
  failed: "border-error text-error",
  ahead: "border-line text-ink/35",
  skipped: "border-dashed border-ink/20 text-ink/30",
};

const LABELS: Record<StageState, string> = {
  done: "text-ink",
  current: "text-ink",
  running: "text-ink",
  failed: "text-error",
  ahead: "text-ink/45",
  skipped: "text-ink/35",
};

/* What a stop without a date says instead. */
const WAITING: Record<StageState, string> = {
  done: "",
  current: "Next",
  running: "Running",
  failed: "Failed",
  ahead: "Not yet",
  skipped: "Skipped",
};
</script>

<template>
  <ol aria-label="Stages" class="m-0 grid list-none gap-3 p-0 sm:grid-cols-5 sm:gap-0">
    <li
      v-for="(stage, index) in stages"
      :key="stage.id"
      :aria-current="stage.state === 'current' ? 'step' : undefined"
      class="relative flex min-w-0 gap-3 sm:flex-col sm:gap-2 sm:pr-3"
    >
      <!-- The rail to the next stop: down the side below `sm`, across above it. -->
      <span
        v-if="index < stages.length - 1"
        aria-hidden="true"
        class="absolute top-6 -bottom-3 left-[9.5px] w-px bg-line sm:top-[9.5px] sm:right-0 sm:bottom-auto sm:left-6 sm:h-px sm:w-auto"
      />

      <span
        :class="[MARKS[stage.state], stage.state === 'current' ? '' : 'bg-surface']"
        aria-hidden="true"
        class="relative z-10 flex size-5 flex-none items-center justify-center rounded-full border"
      >
        <Icon v-if="stage.state === 'done'" class="text-xs" name="material-symbols:check" />
        <Icon v-else-if="stage.state === 'failed'" class="text-xs" name="material-symbols:close" />
        <Icon
          v-else-if="stage.state === 'running'"
          class="animate-spin text-xs"
          name="material-symbols:progress-activity"
        />
        <span v-else-if="stage.state === 'current'" class="size-1.5 rounded-full bg-on-primary" />
      </span>

      <span class="flex min-w-0 flex-col gap-0.5 pb-0.5">
        <span :class="LABELS[stage.state]" class="text-xs leading-5 font-medium">
          {{ stage.label }}
        </span>
        <span class="text-[11px] leading-4 text-ink/50">
          {{ stage.at ? formatDate(stage.at) : WAITING[stage.state] }}
        </span>
      </span>
    </li>
  </ol>
</template>
