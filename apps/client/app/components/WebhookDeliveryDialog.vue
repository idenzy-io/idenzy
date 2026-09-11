<script setup lang="ts">
/**
 * One delivery in full: the stable delivery ID, every attempt with what it got back, the
 * request as it left with personal data masked, an excerpt of the last answer, and when the
 * next try is (notes/webhooks.md P1). A full-height sheet below `lg`.
 *
 * Retry delivery sits at the bottom with its semantics beside it, the delivery ID above it,
 * because retrying and sending a test event are different acts: this one sends the same
 * delivery again with the same ID. It is unavailable while delivery is not running, and says
 * so rather than pretending to run.
 */
import { formatDateTime } from "~/utils/time";
import {
  isSuccessStatus,
  latestAttempt,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  RETRY_SEMANTICS,
  redactPayload,
  requestHeaders,
  responseExcerpt,
  WEBHOOK_DELIVERY,
  type WebhookDelivery,
} from "~/utils/webhooks";

const props = defineProps<{
  delivery: WebhookDelivery;
  endpointUrl: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  retry: [];
}>();

const { lgAndUp } = useDisplay();
const titleId = `${useId()}-title`;

const last = computed(() => latestAttempt(props.delivery));
const headers = computed(() => (last.value ? requestHeaders(props.delivery, last.value) : []));
const payload = computed(() => redactPayload(props.delivery.payload));
const excerpt = computed(() => responseExcerpt(last.value?.response ?? ""));

/* A delivered one has nothing to retry, and a retry is only defined once delivery runs. */
const canRetry = computed(() => WEBHOOK_DELIVERY.running && props.delivery.outcome !== "delivered");

function answer(status: number | null, error: string | null): string {
  return status === null ? (error ?? "No answer") : `HTTP ${status}`;
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 720 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
  >
    <v-card border flat>
      <div :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'" class="flex flex-col">
        <header class="flex flex-none items-start justify-between gap-4 border-b border-line p-5">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 :id="titleId" class="m-0 font-mono text-base font-medium break-all text-ink">
              {{ delivery.event }}
            </h2>
            <p class="m-0 font-mono text-[11px] break-all text-ink/55">{{ endpointUrl }}</p>
          </div>
          <StatusBadge :label="OUTCOME_LABELS[delivery.outcome]" :tone="OUTCOME_TONES[delivery.outcome]" />
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          <section class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Attempts</h3>
            <ol class="m-0 flex list-none flex-col divide-y divide-line rounded-(--idenzy-radius-small) p-0 ring-1 ring-ink/6 ring-inset">
              <li
                v-for="attempt in delivery.attempts"
                :key="attempt.n"
                class="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-xs"
              >
                <span class="font-mono text-ink/50 tabular-nums">#{{ attempt.n }}</span>
                <span class="text-ink/75">{{ formatDateTime(attempt.at) }}</span>
                <span class="flex items-center gap-3 font-mono text-[11px]">
                  <span :class="isSuccessStatus(attempt.status) ? 'text-success' : 'text-error'">
                    {{ answer(attempt.status, attempt.error) }}
                  </span>
                  <span class="text-ink/50 tabular-nums">{{ (attempt.durationMs / 1000).toFixed(2) }}s</span>
                </span>
              </li>
            </ol>
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              <template v-if="delivery.nextRetryAt">
                Next try {{ formatDateTime(delivery.nextRetryAt) }}.
              </template>
              <template v-else-if="delivery.outcome === 'failed'">
                No tries left: the schedule is spent.
              </template>
              <template v-else>No further tries.</template>
            </p>
          </section>

          <section class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Request</h3>
            <dl class="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11px]">
              <template v-for="header in headers" :key="header.name">
                <dt class="truncate font-mono text-ink/55">{{ header.name }}</dt>
                <dd class="m-0 truncate font-mono text-ink">{{ header.value }}</dd>
              </template>
            </dl>
            <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
              <CodeBlock :code="payload" lang="json" />
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              Addresses, phone numbers and IPs are masked here; the endpoint got them whole.
            </p>
          </section>

          <section class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">
              Answer to attempt {{ last?.n ?? 1 }}
            </h3>
            <pre
              v-if="excerpt.text"
              class="m-0 overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink/80 ring-1 ring-ink/6 ring-inset"
            >{{ excerpt.text }}</pre>
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              <template v-if="!excerpt.text">Nothing came back: {{ last?.error ?? "no answer" }}.</template>
              <template v-else-if="excerpt.truncated">The first 512 characters of what came back.</template>
              <template v-else>What came back, whole.</template>
            </p>
          </section>
        </div>

        <footer class="flex flex-none flex-col gap-3 border-t border-line p-4">
          <div class="flex flex-col gap-1">
            <span class="text-[11px] leading-4 text-ink/55">Delivery ID, the same on every attempt</span>
            <CopyField :value="delivery.id" dense label="Copy the delivery ID" />
          </div>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            {{ RETRY_SEMANTICS }}
            <template v-if="!WEBHOOK_DELIVERY.running"> Unavailable while delivery is not running.</template>
          </p>
          <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>
          <div class="flex items-center justify-end gap-2">
            <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
              Close
            </v-btn>
            <v-btn
              :disabled="!canRetry"
              :loading="busy"
              class="text-xs font-medium"
              color="primary"
              prepend-icon="material-symbols:refresh"
              size="small"
              variant="flat"
              @click="emit('retry')"
            >
              Retry delivery
            </v-btn>
          </div>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
