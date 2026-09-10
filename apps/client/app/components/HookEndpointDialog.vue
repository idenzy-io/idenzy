<script setup lang="ts">
/**
 * Names where we call for one hook, and says what will arrive when we do.
 *
 * The sample sits under the field rather than in a guide, because the question somebody has
 * while typing a URL is what that URL is about to receive, and a dialog that made them go
 * and find out is one they will leave and not come back to.
 *
 * No duplicate check, unlike the webhook dialog. Pointing all five hooks at one route is the
 * shape we would recommend anyway: the body carries its own type and the header names it, so
 * one handler and a switch beats five endpoints that drift apart.
 *
 * The refusal for a loopback address is the webhooks' own, reused with its wording, because
 * it is the same fact: we call from our network, and an address on somebody's laptop is one
 * nothing of ours can reach.
 */
import {
  formatDuration,
  HOOK_KINDS,
  HOOK_LABELS,
  HOOK_RETURNS,
  HOOK_SIGNATURE_HEADER,
  HOOK_TIMESTAMP_HEADER,
  HOOK_TYPE_HEADER,
  type HookKind,
  type HookType,
  sampleHookPayload,
} from "~/utils/hooks";
import { ENDPOINT_ISSUE_LABELS, validateEndpointUrl } from "~/utils/webhooks";

const props = defineProps<{
  type: HookType | null;
  /** What is stored now, so the field opens on it rather than empty. */
  current: string | null;
  deadlineMs: number;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [url: string];
}>();

const text = ref("");
const touched = ref(false);
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (showing) => {
  if (showing) {
    text.value = props.current ?? "";
    touched.value = false;
  }
});

const issue = computed(() => {
  const value = text.value.trim();
  if (value === "") return null;
  return validateEndpointUrl(value, []);
});

const message = computed(() =>
  touched.value && issue.value !== null ? ENDPOINT_ISSUE_LABELS[issue.value] : "",
);

const ready = computed(() => text.value.trim() !== "" && issue.value === null);

/** What a failure means here, which is not the same sentence for all three shapes. */
const CONSEQUENCE: Record<HookKind, string> = {
  gate: "The sign-in is refused. A gate that could be got past by being slow would not be a gate, so a deadline or an unreachable host reads as a no.",
  transform:
    "The token is not issued and the sign-in fails. There is no half-built token to fall back on: a claim your own code branches on is one where absent and false read the same.",
  override:
    "The message is not sent, and we do not send it for you. An override you switched on is a statement that your system is the one sending, and quietly sending it ourselves would be sending mail you believe you took over.",
};

const kind = computed<HookKind>(() => (props.type === null ? "gate" : HOOK_KINDS[props.type]));

function confirm() {
  touched.value = true;
  if (!ready.value) return;
  emit("confirm", text.value.trim());
}

/* Closes on the write landing rather than on the click. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);

const id = useId();
</script>

<template>
  <v-dialog v-model="open" max-width="560" @after-enter="field?.focus()">
    <v-card v-if="type" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">
            {{ current ? "Change" : "Set" }} the {{ HOOK_LABELS[type].toLowerCase() }} endpoint
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            An https URL of yours that we call, and wait
            {{ formatDuration(deadlineMs) }} for. One route can serve every hook: the body
            says which, and so does the
            <span class="font-mono text-ink/75">{{ HOOK_TYPE_HEADER }}</span> header.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label :for="id" class="text-xs font-medium text-ink">Endpoint URL</label>
          <v-text-field
            :id="id"
            ref="field"
            v-model="text"
            :error="message !== ''"
            autocapitalize="off"
            autocomplete="off"
            class="font-mono"
            density="compact"
            hide-details
            placeholder="https://api.example.com/idenzy/hooks"
            spellcheck="false"
            variant="outlined"
            @blur="touched = true"
          />
          <p v-if="message" class="m-0 text-[11px] leading-4 text-error">{{ message }}</p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
            Signed with your webhook secret, so the verification you already wrote covers this
            too.
          </p>
        </div>

        <SamplePanel
          :meta="`POST · ${formatDuration(deadlineMs)} deadline`"
          note="What arrives, and what a 200 has to carry back."
          title="The call"
        >
          <div class="flex flex-col gap-1">
            <SampleLine icon="material-symbols:north-east" mono>
              {{ HOOK_TYPE_HEADER }}: {{ type }}
            </SampleLine>
            <SampleLine icon="material-symbols:lock-outline" mono>
              {{ HOOK_SIGNATURE_HEADER }}, {{ HOOK_TIMESTAMP_HEADER }}
            </SampleLine>
            <SampleLine icon="material-symbols:data-object" mono>
              {{ sampleHookPayload(type) }}
            </SampleLine>
            <SampleLine icon="material-symbols:south-west" mono>
              {{ HOOK_RETURNS[type] }}
            </SampleLine>
          </div>
        </SamplePanel>

        <p
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/30 bg-warning/6 px-3 py-2.5 text-[11px] leading-4 text-ink/80"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-warning"
            name="material-symbols:warning-outline"
          />
          <span>
            <span class="font-medium text-ink">If this call fails, so does the request.</span>
            {{ CONSEQUENCE[kind] }}
          </span>
        </p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            {{ current ? "Save endpoint" : "Set endpoint" }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
