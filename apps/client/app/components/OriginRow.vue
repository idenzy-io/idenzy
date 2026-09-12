<script setup lang="ts">
/**
 * One allowed origin: the exact string, how it got here, what we have observed of it, and
 * the one action on the row.
 *
 * The origin is never truncated. It is compared as one exact string, so a cut one reads
 * as a different value from the one that is actually stored, and this is the column
 * somebody is checking against their own address bar.
 *
 * `Last observed use` is a column with nothing in it, and it says so rather than being
 * left out: the question is the first one an operator asks of a list like this, and an
 * absent column reads as an answer nobody thought to give.
 */
import {
  type AllowedOrigin,
  ORIGIN_SOURCE_FROM,
  ORIGIN_SOURCES,
  ORIGIN_TELEMETRY,
} from "~/utils/origins";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  entry: AllowedOrigin;
  now: Date;
  busy: boolean;
}>();

const emit = defineEmits<{
  remove: [];
}>();

const added = computed(() => {
  const at = new Date(props.entry.addedAt);
  return relativeTimeWords(props.entry.addedAt, props.now < at ? at : props.now);
});

const source = computed(() =>
  props.entry.source === null ? null : ORIGIN_SOURCES[props.entry.source],
);
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary flex min-w-0 items-center gap-3">
      <span
        class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-ink/4 text-ink/70"
      >
        <Icon
          :name="source?.icon ?? 'material-symbols:language'"
          aria-hidden="true"
          class="text-sm"
        />
      </span>
      <span class="font-mono text-xs break-all text-ink">{{ entry.origin }}</span>
    </span>

    <span
      class="record-cell record-cell--half flex flex-col gap-0.5"
      data-label="Added from"
    >
      <!-- "Not recorded" and not "Typed in": `project_origins` has no column for how a row
           got here, so the only row that can say is one accepted from a suggestion in this
           session. Claiming a row was typed in because we cannot remember otherwise would be
           inventing the answer. -->
      <span class="text-[11px] leading-4 text-ink/70">
        {{ entry.source === null ? "Not recorded" : ORIGIN_SOURCE_FROM[entry.source] }}
      </span>
      <v-tooltip :text="formatDateTime(entry.addedAt)" location="top">
        <template #activator="{ props: tip }">
          <span v-bind="tip" class="w-fit text-[10px] leading-4 text-ink/45">{{ added }}</span>
        </template>
      </v-tooltip>
    </span>

    <!-- A column with nothing in it, saying so. Nothing records the Origin on a request
         yet, and a blank cell would read as "never used". -->
    <span
      class="record-cell record-cell--half text-[11px] text-ink/45"
      data-label="Last observed use"
    >
      <template v-if="ORIGIN_TELEMETRY">—</template>
      <template v-else>Not recorded</template>
    </span>

    <span class="record-cell record-cell--action record-cell--end flex flex-none justify-end">
      <v-btn
        :loading="busy"
        class="text-xs font-medium text-ink/70"
        color="neutral"
        size="small"
        variant="text"
        @click="emit('remove')"
      >
        Remove
      </v-btn>
    </span>
  </li>
</template>
