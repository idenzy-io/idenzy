<script setup lang="ts">
/**
 * One of the two budgets a template is held to, as a bar: what is used of the kilobyte,
 * and the figure beside it. Amber from four fifths, because a template that fits today
 * and grows with the next profile field is the one that fails on a Friday; red past the
 * cap, which is where the server would refuse.
 */
const props = withDefaults(
  defineProps<{
    label: string;
    used: number;
    max: number;
    /** What is being measured, for the reader who asks why there are two. */
    note?: string;
  }>(),
  { note: "" },
);

const share = computed(() => Math.min(100, Math.round((props.used / props.max) * 100)));
const tone = computed(() => {
  if (props.used > props.max) return "error";
  if (props.used >= props.max * 0.8) return "warning";
  return "ok";
});

const BAR: Record<"ok" | "warning" | "error", string> = {
  ok: "bg-primary",
  warning: "bg-warning",
  error: "bg-error",
};

const FIGURE: Record<"ok" | "warning" | "error", string> = {
  ok: "text-ink",
  warning: "text-warning",
  error: "text-error",
};
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1.5">
    <div class="flex items-baseline justify-between gap-3">
      <span class="text-xs font-medium text-ink">{{ label }}</span>
      <span :class="FIGURE[tone]" class="font-mono text-[11px] tabular-nums">
        {{ used.toLocaleString("en") }}
        <span class="text-ink/45">/ {{ max.toLocaleString("en") }} bytes</span>
      </span>
    </div>
    <span
      :aria-label="`${label}: ${used} of ${max} bytes`"
      :aria-valuemax="max"
      :aria-valuenow="Math.min(used, max)"
      aria-valuemin="0"
      class="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8"
      role="progressbar"
    >
      <span
        :class="BAR[tone]"
        :style="{ width: `${share}%` }"
        class="block h-full rounded-full transition-[width] duration-200"
      />
    </span>
    <p v-if="note" class="m-0 text-[11px] leading-4 text-ink/50">{{ note }}</p>
  </div>
</template>
