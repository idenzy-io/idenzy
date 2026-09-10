<script setup lang="ts">
/**
 * The cell a key row is recognised by: the mark for its kind, what the kind is called, and
 * the only part of the key that still exists in the clear under it.
 *
 * The masked value is the point of the cell rather than decoration. The table carries no
 * name column, so the prefix is a key's whole handle: it is what identifies a row in a log,
 * and it is what a reader matches against the value already sitting in their `.env`. The
 * dots after it are not hiding anything we hold, which is why they are the same width on
 * every row: what they stand for was never stored.
 *
 * A revoked key keeps its mark and loses its colour, because the row is still the answer to
 * "which key was that" long after it stopped working.
 */
import {
  isLive,
  KEY_KIND_ICONS,
  KEY_KIND_LABELS,
  maskedKey,
  type ProjectApiKey,
} from "~/utils/keys";

const props = defineProps<{
  keyRow: ProjectApiKey;
}>();

const live = computed(() => isLive(props.keyRow));
const secret = computed(() => props.keyRow.kind === "secret");
</script>

<template>
  <div class="flex min-w-0 items-center gap-2.5">
    <span
      :class="
        !live
          ? 'border border-dashed border-line text-ink/35'
          : secret
            ? 'bg-ink/8 text-ink'
            : 'bg-primary/10 text-primary'
      "
      aria-hidden="true"
      class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
    >
      <Icon :name="KEY_KIND_ICONS[keyRow.kind]" class="text-base" />
    </span>

    <div class="flex min-w-0 flex-col gap-px leading-4">
      <span :class="live ? 'text-ink' : 'text-ink/55'" class="truncate text-xs font-medium">
        {{ KEY_KIND_LABELS[keyRow.kind] }}
      </span>
      <span class="truncate font-mono text-[11px] text-ink/55">{{ maskedKey(keyRow) }}</span>
    </div>
  </div>
</template>
