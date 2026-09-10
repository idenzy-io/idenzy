<script setup lang="ts">
/**
 * The cell a signal is recognised by: the mark for its kind, what the kind is called, and
 * the line of evidence under it. Two lines rather than two columns, the way a person is
 * drawn in `UserIdentity`, because a reader scans for a kind and then reads the numbers.
 *
 * Only the urgent kinds tint their mark, and that is the whole of the colour here. The
 * severity column already says which is which in words, so a second colour on every row
 * would be the fourth thing on the line competing for the eye. Same judgement
 * `isNetworkConcern` makes about Tor in `sessions.ts`: a column that flags everything
 * teaches the reader to stop seeing the flag.
 */
import { KIND_ICONS, KIND_LABELS, kindOf, type SecuritySignal, severityOf } from "~/utils/security";

const props = defineProps<{
  signal: SecuritySignal;
}>();

const kind = computed(() => kindOf(props.signal));
const urgent = computed(() => severityOf(props.signal.evidence) === "act");
</script>

<template>
  <div class="flex min-w-0 items-center gap-2.5">
    <span
      :class="urgent ? 'bg-error/10 text-error' : 'bg-ink/6 text-ink/70'"
      aria-hidden="true"
      class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
    >
      <Icon :name="KIND_ICONS[kind]" class="text-base" />
    </span>

    <div class="flex min-w-0 flex-col gap-px leading-4">
      <span class="truncate text-xs font-medium text-ink">{{ KIND_LABELS[kind] }}</span>
      <EvidenceLine :evidence="signal.evidence" />
    </div>
  </div>
</template>
