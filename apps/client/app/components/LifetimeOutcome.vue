<script lang="ts">
export type OutcomeTone = "ink" | "primary" | "warning";
</script>

<script setup lang="ts">
/**
 * One consequence of a lifetime, worked out and set beside the control that decides it:
 * the refreshes a lifetime costs, the window a revocation waits out, the time a suspended
 * account keeps working.
 *
 * Not a `Statistic`, on purpose. That one is a page-level tile with a trend, an info
 * button and a figure that shrinks to fit its own card. This is a derived number inside a
 * card, at the size of the card's own text, and it moves as a control moves rather than
 * as a period changes. A figure that answers "what happens if I pick this" and one that
 * answers "what happened last month" should not read as the same kind of thing.
 */
withDefaults(
  defineProps<{
    label: string;
    /** Already written, because the caller knows whether this is a count or a duration. */
    value: string;
    /** After the figure at the size of the label: "a month", "worst case". */
    unit?: string;
    /** The sentence under it. Every one of these needs saying, so it is not optional. */
    note: string;
    tone?: OutcomeTone;
  }>(),
  { unit: "", tone: "ink" },
);

const FIGURES: Record<OutcomeTone, string> = {
  ink: "text-ink",
  primary: "text-primary",
  warning: "text-warning",
};
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <span class="text-xs text-ink/60">{{ label }}</span>
    <p class="m-0 flex items-baseline gap-1.5">
      <span
        :class="FIGURES[tone]"
        class="font-mono text-xl leading-none font-medium tracking-tight tabular-nums"
      >
        {{ value }}
      </span>
      <span v-if="unit" class="text-xs text-ink/55">{{ unit }}</span>
    </p>
    <p class="m-0 text-[11px] leading-4 text-ink/55">{{ note }}</p>
  </div>
</template>
