<script setup lang="ts">
/**
 * Registers one route a clicked magic link may land on. The server compares the whole
 * string and normalises nothing, so what is written here is what the customer's code
 * has to send, byte for byte; the checks refuse what could never work and change
 * nothing else.
 */
import { REDIRECT_ISSUE_LABELS, validateRedirectUri } from "~/utils/otp";

const props = defineProps<{
  redirectUris: readonly string[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** The URI trimmed and otherwise as typed. */
  confirm: [uri: string];
}>();

const uri = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (value) uri.value = "";
});

const issue = computed(() => {
  const text = uri.value.trim();
  if (text === "") return "";
  const found = validateRedirectUri(text);
  if (found !== null) return REDIRECT_ISSUE_LABELS[found];
  if (props.redirectUris.includes(text)) return "Already on the list.";
  return "";
});

const ready = computed(() => uri.value.trim() !== "" && issue.value === "");

function confirm() {
  if (!ready.value) return;
  emit("confirm", uri.value.trim());
  /* Cleared before the fade, or the list it just joined reports it as already there. */
  uri.value = "";
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Add a redirect URI</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A route of yours that a clicked link lands on, carrying the single-use code in
            its query. Compared exactly with what your code sends when it starts a link.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="redirect-uri-next">Redirect URI</label>
          <v-text-field
            id="redirect-uri-next"
            ref="field"
            v-model="uri"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="https://app.example.com/auth/link"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px]">
            {{ issue || "The whole URL, path included. No wildcards: this list is all that stands between our redirect and somebody else's." }}
          </p>
        </div>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :disabled="!ready" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Add redirect URI
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
