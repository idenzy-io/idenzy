<script setup lang="ts">
/**
 * A set drawn as what it is: ten codes, the spent ones crossed off. The bar is what a
 * column of these is scanned by, and the words beside it are what is read once a row has
 * been picked out, so the pips carry no number of their own and are hidden from a screen
 * reader, which is given the count in writing instead.
 *
 * The tone comes from the state rather than from the count, so the line at which a set
 * turns amber is the project's own threshold and not a number baked in here.
 */
import type { RecoveryState } from "~/utils/recovery";
import { CODE_SET, STATE_FILL } from "~/utils/recovery";

const props = withDefaults(
  defineProps<{
    remaining: number;
    state: RecoveryState;
    /** The row's own count, in case a set ever holds another number of codes. */
    total?: number;
  }>(),
  { total: CODE_SET.codes },
);

/* The spent codes are the same colour worn thin, so the bar reads as one set part used
   rather than as two things side by side. A set spent to the last code has no filled pip
   to carry the tone, which is why the empties carry it too. */
const SPENT: Record<RecoveryState, string> = {
  healthy: "bg-success/20",
  low: "bg-warning/25",
  none: "bg-error/25",
};

const pips = computed(() =>
  Array.from({ length: props.total }, (_, index) => index < props.remaining),
);
</script>

<template>
  <span aria-hidden="true" class="inline-flex items-center gap-0.5">
    <span
      v-for="(filled, index) in pips"
      :key="index"
      :class="filled ? STATE_FILL[state] : SPENT[state]"
      class="h-2.5 w-[3px] rounded-[1px]"
    />
  </span>
</template>
