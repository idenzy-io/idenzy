<script setup lang="ts">
/**
 * Records who asked and how anybody knows it is them. Two outcomes: their account is found
 * and the reader says how they confirmed it, or no account on the project holds them, in
 * which case nothing is held, there is nothing to export or erase, and the request needs
 * only an answer.
 *
 * This is the gate on everything after it. Nothing is exported, erased or corrected for a
 * request whose subject has not been through here, which is why the request puts this
 * record above the work rather than beside it (notes/data-requests.md).
 */
import type { Refusal, VerifyInput } from "~/stores/data-requests";
import {
  type DataSubjectRequest,
  kindInfo,
  VERIFICATION_INFO,
  VERIFICATION_METHODS,
  type VerificationMethod,
} from "~/utils/data-requests";
import { formatDate } from "~/utils/time";
import type { ProjectUser } from "~/utils/users";

const props = defineProps<{
  request: DataSubjectRequest;
  users: readonly ProjectUser[];
  /** Writes it, and resolves to null or the sentence saying why it was refused. */
  submit: (input: VerifyInput) => Promise<Refusal>;
}>();

const open = defineModel<boolean>({ required: true });

const { smAndUp } = useDisplay();
const titleId = `${useId()}-title`;

const MODES = [
  { value: "account", label: "Their account" },
  { value: "none", label: "No account holds them" },
];

const mode = ref("account");
const selected = ref<string | null>(props.request.subjectUserId);
/* Starts on what they gave, which is usually what to search for. */
const query = ref(props.request.claimedIdentity ?? "");
const method = ref<string | null>(null);
const note = ref("");

const touched = ref(false);
const busy = ref(false);
const failure = ref("");

const METHOD_OPTIONS = VERIFICATION_METHODS.map((id) => ({
  value: id,
  label: VERIFICATION_INFO[id].label,
  note: VERIFICATION_INFO[id].note,
}));

const chosenMethod = computed<VerificationMethod | null>(
  () => VERIFICATION_METHODS.find((id) => id === method.value) ?? null,
);

const NEXT_STEP = {
  export: "preparing the export",
  erasure: "reviewing the erasure",
  correction: "making the correction",
} as const;

const issues = computed(() => {
  const list: { account?: string; method?: string; note?: string } = {};
  const blank = note.value.trim() === "";
  if (mode.value === "account") {
    if (selected.value === null) list.account = "Pick their account, or say no account holds them.";
    if (chosenMethod.value === null) list.method = "Say how you confirmed it is them.";
    else if (chosenMethod.value === "other" && blank) {
      list.note = "Say how, for whoever reviews this later.";
    }
  } else if (blank) {
    list.note = "Say what you searched for, for whoever reviews this later.";
  }
  return list;
});

const shown = computed(() => (touched.value ? issues.value : {}));

async function submit() {
  touched.value = true;
  failure.value = "";
  if (Object.keys(issues.value).length > 0 || busy.value) return;
  const input: VerifyInput | null =
    mode.value === "none"
      ? { outcome: "no_account", note: note.value }
      : selected.value !== null && chosenMethod.value !== null
        ? {
            outcome: "account",
            userId: selected.value,
            method: chosenMethod.value,
            note: note.value,
          }
        : null;
  if (input === null) return;
  busy.value = true;
  try {
    const refusal = await props.submit(input);
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
    :max-width="smAndUp ? 520 : undefined"
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
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Verify who asked</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            {{ kindInfo(request.kind).label }} request, received
            {{ formatDate(request.receivedAt) }}.
            <template v-if="request.claimedIdentity">
              They gave
              <span class="font-mono text-[11px] text-ink/80">{{ request.claimedIdentity }}</span>.
            </template>
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <div class="flex flex-col gap-2">
            <span class="text-xs font-medium text-ink">Whose account</span>
            <SegmentedControl
              v-model="mode"
              :disabled="busy"
              :options="MODES"
              label="Whose account"
              stretch
            />
            <template v-if="mode === 'account'">
              <DataRequestSubjectSearch
                v-model="selected"
                v-model:query="query"
                :disabled="busy"
                :error="shown.account !== undefined"
                :users="users"
                input-id="dsr-verify-subject"
                no-match-label="No account holds them"
                @no-match="mode = 'none'"
              />
              <p v-if="shown.account" class="m-0 text-[11px] leading-4 text-error">
                {{ shown.account }}
              </p>
            </template>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
              Nothing is held about them, so there is nothing to export, erase or correct. The
              request then needs only an answer telling them so.
            </p>
          </div>

          <div v-if="mode === 'account'" class="flex flex-col gap-2">
            <span class="text-xs font-medium text-ink">How you know it is them</span>
            <ChoiceList
              v-model="method"
              :disabled="busy"
              :error="shown.method !== undefined"
              :options="METHOD_OPTIONS"
              label="How you know it is them"
            />
            <p v-if="shown.method" class="m-0 text-[11px] leading-4 text-error">
              {{ shown.method }}
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-medium text-ink" for="dsr-verify-note">
              Note
              <span
                v-if="mode === 'account' && chosenMethod !== 'other'"
                class="font-normal text-ink/45"
              >
                · optional
              </span>
            </label>
            <v-textarea
              id="dsr-verify-note"
              v-model="note"
              :disabled="busy"
              :error="shown.note !== undefined"
              auto-grow
              hide-details
              :placeholder="
                mode === 'account'
                  ? 'What you checked, in a sentence.'
                  : 'The addresses and names you searched for.'
              "
              rows="2"
              variant="filled"
            />
            <p
              :class="shown.note ? 'text-error' : 'text-ink/50'"
              class="m-0 text-[11px] leading-4"
            >
              {{ shown.note ?? "Kept with the request, and written to the audit log against your name." }}
            </p>
          </div>

          <p v-if="failure" class="m-0 text-[11px] leading-4 text-error" role="alert">
            {{ failure }}
          </p>
        </div>

        <footer class="flex flex-none flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <p class="m-0 mr-auto text-[11px] leading-4 text-ink/50">
            {{
              mode === "account"
                ? `Nothing runs yet. Next is ${NEXT_STEP[kindInfo(request.kind).work]}.`
                : "Next is recording the answer."
            }}
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
            {{ mode === "account" ? "Record verification" : "Record no account" }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
