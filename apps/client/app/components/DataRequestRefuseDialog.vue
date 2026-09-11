<script setup lang="ts">
/**
 * Refuses a request, which closes it, and records why and how the person was told. The old
 * Refuse button changed a badge and nothing else; a refusal is a decision a regulator can
 * ask to see, so it is not recorded without its grounds, the reasoning in writing, the day
 * they were told, and what the message to them had to say (notes/data-requests.md P1).
 *
 * The grounds start unchosen. A preselected ground is a ground nobody gave.
 */
import type { Refusal, RefusalInput } from "~/stores/data-requests";
import {
  type DataSubjectRequest,
  dateInput,
  fromInputs,
  kindInfo,
  REFUSAL_GROUND_INFO,
  REFUSAL_GROUNDS,
  RESPONSE_CHANNELS,
  RULE_INFO,
  refusalIssues,
} from "~/utils/data-requests";

const props = defineProps<{
  request: DataSubjectRequest;
  /** Who the request is about, as the queue names them. */
  subject: string;
  now: Date;
  /** Writes it, and resolves to null or the sentence saying why it was refused. */
  submit: (input: RefusalInput) => Promise<Refusal>;
}>();

const open = defineModel<boolean>({ required: true });

const { smAndUp } = useDisplay();
const titleId = `${useId()}-title`;

const GROUND_OPTIONS = REFUSAL_GROUNDS.map((id) => ({
  value: id,
  label: REFUSAL_GROUND_INFO[id].label,
  note: REFUSAL_GROUND_INFO[id].note,
}));

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "product", label: "In product" },
  { value: "post", label: "Letter" },
  { value: "other", label: "Other" },
];

const ground = ref<string | null>(null);
const reasoning = ref("");
const channel = ref("email");
const toldOn = ref(dateInput(props.now));
const acknowledged = ref(false);

const touched = ref(false);
const busy = ref(false);
const failure = ref("");

const chosenGround = computed(() => REFUSAL_GROUNDS.find((id) => id === ground.value) ?? null);
const toldAt = computed(() => fromInputs(toldOn.value));

const issues = computed(() =>
  refusalIssues(
    {
      ground: chosenGround.value,
      reasoning: reasoning.value,
      toldAt: toldAt.value,
      acknowledged: acknowledged.value,
    },
    props.request.receivedAt,
    props.now,
  ),
);

const shown = computed(() => (touched.value ? issues.value : {}));

async function submit() {
  touched.value = true;
  failure.value = "";
  const how = RESPONSE_CHANNELS.find((entry) => entry === channel.value);
  const on = chosenGround.value;
  const at = toldAt.value;
  if (Object.keys(issues.value).length > 0 || how === undefined || on === null || at === null) {
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    const refusal = await props.submit({
      ground: on,
      reasoning: reasoning.value,
      channel: how,
      toldAt: at,
    });
    if (refusal === null) open.value = false;
    else failure.value = refusal;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!smAndUp"
    :max-width="smAndUp ? 540 : undefined"
    :persistent="busy"
    scrollable
    width="100%"
  >
    <v-card border flat>
      <form
        :class="smAndUp ? 'max-h-[88vh]' : 'h-full'"
        class="flex flex-col"
        novalidate
        @submit.prevent="submit"
      >
        <header class="flex flex-none flex-col gap-1 border-b border-line px-5 py-4">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Refuse this request</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            {{ kindInfo(request.kind).label }} request from
            <span class="font-medium text-ink/80">{{ subject }}</span>. Refusing closes it, so
            the grounds and how they were told go on the record with it.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <div class="flex flex-col gap-2">
            <span class="text-xs font-medium text-ink">Grounds</span>
            <ChoiceList
              v-model="ground"
              :disabled="busy"
              :error="shown.ground !== undefined"
              :options="GROUND_OPTIONS"
              label="Grounds for refusing"
            />
            <p v-if="shown.ground" class="m-0 text-[11px] leading-4 text-error">{{ shown.ground }}</p>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-medium text-ink" for="dsr-refuse-reasoning">Reasoning</label>
            <v-textarea
              id="dsr-refuse-reasoning"
              v-model="reasoning"
              :disabled="busy"
              :error="shown.reasoning !== undefined"
              auto-grow
              hide-details
              placeholder="Why these grounds apply to this request."
              rows="3"
              variant="filled"
            />
            <p
              :class="shown.reasoning ? 'text-error' : 'text-ink/50'"
              class="m-0 text-[11px] leading-4"
            >
              {{ shown.reasoning ?? "Specific to this request, not to requests like it." }}
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <span class="text-xs font-medium text-ink">How they were told</span>
            <SegmentedControl
              v-model="channel"
              :disabled="busy"
              :options="CHANNEL_OPTIONS"
              label="How they were told"
              stretch
            />
            <label class="mt-1 text-xs font-medium text-ink" for="dsr-refuse-date">On</label>
            <v-text-field
              id="dsr-refuse-date"
              v-model="toldOn"
              :disabled="busy"
              :error="shown.toldAt !== undefined"
              hide-details
              type="date"
              variant="filled"
            />
            <p v-if="shown.toldAt" class="m-0 text-[11px] leading-4 text-error">{{ shown.toldAt }}</p>
          </div>

          <div class="flex flex-col gap-1">
            <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
              <v-checkbox-btn
                v-model="acknowledged"
                :disabled="busy"
                class="-mt-1.5 -ml-1.5"
                color="primary"
                density="compact"
              />
              <span class="pt-px">{{ RULE_INFO[request.rule].refusalNotice }}</span>
            </label>
            <p v-if="shown.notice" class="m-0 pl-7 text-[11px] leading-4 text-error">
              {{ shown.notice }}
            </p>
          </div>

          <p v-if="failure" class="m-0 text-[11px] leading-4 text-error" role="alert">
            {{ failure }}
          </p>
        </div>

        <footer class="flex flex-none items-center justify-end gap-2 border-t border-line px-5 py-3">
          <v-btn
            :disabled="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Keep it open
          </v-btn>
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Refuse request
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
