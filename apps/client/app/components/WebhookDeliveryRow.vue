<script setup lang="ts">
/**
 * One delivery to the selected endpoint on `RecordTable`: its latest attempt and when, the
 * event, what the endpoint answered, how long it took, when the next try is, and the way into
 * its detail. The outcome is the table's tab, so the row does not repeat it.
 *
 * Below 900px the event, the answer and the next retry stay on the stacked row, which is what
 * the note asks a phone to keep in view.
 */
import { formatDateTime, relativeTimeWords } from "~/utils/time";
import {
  isSuccessStatus,
  latestAttempt,
  MAX_ATTEMPTS,
  type WebhookDelivery,
} from "~/utils/webhooks";

const props = defineProps<{
  delivery: WebhookDelivery;
}>();

const emit = defineEmits<{
  details: [];
}>();

const now = useNow({ interval: 30_000 });

const attempt = computed(() => latestAttempt(props.delivery));

const result = computed(() => {
  const found = attempt.value;
  if (found === null) return { text: "Not tried", good: false };
  if (found.status === null) return { text: found.error ?? "No answer", good: false };
  return { text: `HTTP ${found.status}`, good: isSuccessStatus(found.status) };
});

const nextRetry = computed(() => {
  const at = props.delivery.nextRetryAt;
  if (at) return relativeTimeWords(at, now.value);
  return props.delivery.outcome === "failed" ? "No tries left" : "None";
});
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary flex min-w-0 flex-col gap-0.5">
      <v-tooltip v-if="attempt" :text="formatDateTime(attempt.at)" location="top">
        <template #activator="{ props: tip }">
          <span v-bind="tip" class="w-fit text-xs text-ink">
            {{ relativeTimeWords(attempt.at, now) }}
          </span>
        </template>
      </v-tooltip>
      <span class="text-[11px] leading-4 text-ink/50">
        Attempt {{ delivery.attempts.length }} of {{ MAX_ATTEMPTS }}
      </span>
    </span>

    <span class="record-cell record-cell--half flex min-w-0 items-center gap-1.5" data-label="Event">
      <span class="truncate font-mono text-[11px] text-ink">{{ delivery.event }}</span>
      <Tag v-if="delivery.test" label="Test" tone="neutral" />
    </span>

    <span class="record-cell record-cell--half" data-label="HTTP result">
      <span :class="result.good ? 'text-success' : 'text-error'" class="font-mono text-[11px]">
        {{ result.text }}
      </span>
    </span>

    <span class="record-cell record-cell--half record-cell--end" data-label="Duration">
      <span class="font-mono text-[11px] text-ink/70 tabular-nums">
        {{ attempt ? `${(attempt.durationMs / 1000).toFixed(2)}s` : "–" }}
      </span>
    </span>

    <span class="record-cell record-cell--half" data-label="Next retry">
      <span class="text-xs text-ink/70">{{ nextRetry }}</span>
    </span>

    <span class="record-cell record-cell--action record-cell--end flex justify-end">
      <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="emit('details')">
        Details
      </v-btn>
    </span>
  </li>
</template>
