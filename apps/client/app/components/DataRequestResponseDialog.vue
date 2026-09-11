<script setup lang="ts">
/**
 * Records the answer the person was sent: how, on which day, and what it said. That day is
 * the one the obligation was met on, so it is asked for rather than taken from the clock.
 * Recording it does not close the request; Close request does, from the request, once this
 * is on it.
 */
import type { Refusal, ResponseInput } from "~/stores/data-requests";
import {
  type DataSubjectRequest,
  dateInput,
  dateIssue,
  fromInputs,
  kindInfo,
  RESPONSE_CHANNELS,
} from "~/utils/data-requests";

const props = defineProps<{
  request: DataSubjectRequest;
  now: Date;
  /** Writes it, and resolves to null or the sentence saying why it was refused. */
  submit: (input: ResponseInput) => Promise<Refusal>;
}>();

const open = defineModel<boolean>({ required: true });

const titleId = `${useId()}-title`;

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "product", label: "In product" },
  { value: "post", label: "Letter" },
  { value: "other", label: "Other" },
];

const PLACEHOLDERS = {
  export: "A link to the bundle, sent to the address on the account.",
  erasure: "Confirmed their personal data was erased.",
  correction: "Confirmed the correction was made.",
} as const;

const channel = ref("email");
const sentOn = ref(dateInput(props.now));
const summary = ref("");
const touched = ref(false);
const busy = ref(false);
const failure = ref("");

const placeholder = computed(() =>
  props.request.verification?.outcome === "no_account"
    ? "Told them no account on this project holds them, so nothing is held."
    : PLACEHOLDERS[kindInfo(props.request.kind).work],
);

const sentAt = computed(() => fromInputs(sentOn.value));

const issues = computed(() => {
  const list: { sentAt?: string; summary?: string } = {};
  const day = dateIssue(sentAt.value, props.request.receivedAt, props.now);
  if (day !== null) list.sentAt = day;
  if (summary.value.trim() === "") list.summary = "Say what was sent.";
  return list;
});

const shown = computed(() => (touched.value ? issues.value : {}));

async function submit() {
  touched.value = true;
  failure.value = "";
  const at = sentAt.value;
  const how = RESPONSE_CHANNELS.find((entry) => entry === channel.value);
  if (Object.keys(issues.value).length > 0 || at === null || how === undefined || busy.value) {
    return;
  }
  busy.value = true;
  try {
    const refusal = await props.submit({ channel: how, sentAt: at, summary: summary.value });
    if (refusal === null) open.value = false;
    else failure.value = refusal;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" :persistent="busy" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" novalidate @submit.prevent="submit">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Record the answer</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            What the person was sent, and when. The day they were told is the day the request
            was met.
          </p>
        </header>

        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink">How they were told</span>
          <SegmentedControl
            v-model="channel"
            :disabled="busy"
            :options="CHANNEL_OPTIONS"
            label="How they were told"
            stretch
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-ink" for="dsr-response-date">Sent on</label>
          <v-text-field
            id="dsr-response-date"
            v-model="sentOn"
            :disabled="busy"
            :error="shown.sentAt !== undefined"
            hide-details
            type="date"
            variant="filled"
          />
          <p v-if="shown.sentAt" class="m-0 text-[11px] leading-4 text-error">{{ shown.sentAt }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs font-medium text-ink" for="dsr-response-summary">What was sent</label>
          <v-textarea
            id="dsr-response-summary"
            v-model="summary"
            :disabled="busy"
            :error="shown.summary !== undefined"
            :placeholder="placeholder"
            auto-grow
            hide-details
            rows="3"
            variant="filled"
          />
          <p
            :class="shown.summary ? 'text-error' : 'text-ink/50'"
            class="m-0 text-[11px] leading-4"
          >
            {{ shown.summary ?? "In a sentence. It stays with the request as the record of the answer." }}
          </p>
        </div>

        <p v-if="failure" class="m-0 text-[11px] leading-4 text-error" role="alert">
          {{ failure }}
        </p>

        <footer class="flex flex-wrap items-center gap-2">
          <p class="m-0 mr-auto text-[11px] leading-4 text-ink/50">
            The request stays open until you close it.
          </p>
          <v-btn
            :disabled="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Record answer
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
