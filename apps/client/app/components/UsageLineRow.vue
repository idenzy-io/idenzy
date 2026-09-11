<script setup lang="ts">
/**
 * One line of the bill on `RecordTable`: what it is, how much in its billed unit, at what
 * rate, what Idenzy charges and who bills it.
 *
 * The charge is the row's action cell, so below 900px it keeps the top line beside the
 * line's name and the rest stack under it with their labels. That is the note's mobile
 * arrangement, rather than five pricing columns squeezed into one row.
 *
 * A charge of nothing carries its reason under it. Inside the allowance, nothing sent,
 * billed by your own vendor and not metered all read "$0.00" otherwise, and the third is
 * the one that arrives later as somebody else's invoice.
 */
import { formatCents } from "~/utils/billing";
import { type BillLine, quantityWords } from "~/utils/usage";

const props = defineProps<{
  line: BillLine;
  /** The month-end estimate in cents, on an open period. */
  projectedCents?: number | null;
  /** "Sep 30", for the estimate's words. */
  projectedBy?: string;
}>();

/* The vendor's bill and a missing meter outrank the estimate: both say something the
   figure does not, and neither changes by the end of the month. */
const note = computed(() => {
  const { line, projectedCents } = props;
  if (line.state === "vendor" || line.state === "unmetered") return line.note;
  if (projectedCents !== undefined && projectedCents !== null && projectedCents !== line.cents) {
    return `${formatCents(projectedCents)} by ${props.projectedBy ?? "month-end"}`;
  }
  return line.note;
});
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary flex min-w-0 flex-col gap-0.5">
      <span class="text-xs font-medium text-ink">{{ line.label }}</span>
      <span class="text-[11px] leading-4 break-words text-ink/50">{{ line.detail }}</span>
    </span>

    <span class="record-cell flex flex-col" data-label="Quantity">
      <span
        :class="line.quantity === null ? 'text-ink/55' : 'font-mono text-ink tabular-nums'"
        class="text-xs"
      >
        {{ quantityWords(line) }}
      </span>
    </span>

    <span class="record-cell flex flex-col text-xs text-ink/70" data-label="Unit rate">
      {{ line.rate }}
    </span>

    <span
      class="record-cell record-cell--action flex flex-col items-end gap-0.5 justify-self-end text-right"
    >
      <span v-if="line.cents === null" class="text-xs text-ink/55">Not billed</span>
      <span
        v-else
        :class="line.cents === 0 ? 'text-ink/55' : 'text-ink'"
        class="font-mono text-xs tabular-nums"
      >
        {{ formatCents(line.cents) }}
      </span>
      <span v-if="note" class="text-[11px] leading-4 text-ink/50">{{ note }}</span>
    </span>

    <span class="record-cell record-cell--half flex flex-col" data-label="Billing owner">
      <span
        :class="
          line.state === 'vendor'
            ? 'font-medium text-ink'
            : line.state === 'unmetered'
              ? 'text-ink/45'
              : 'text-ink/70'
        "
        class="text-xs"
      >
        {{ line.owner }}
      </span>
    </span>
  </li>
</template>
