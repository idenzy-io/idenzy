<script setup lang="ts">
/**
 * Adds one origin to the relying party. An origin is scheme, host and port, matched
 * exactly, and WebAuthn allows it only on the RP ID's own domain; both are checked here
 * as the text is typed, so what is written is always one the ceremony will accept. An
 * Android app is the other kind: its signing certificate, pasted as the fingerprint
 * `keytool` prints and stored as the origin Credential Manager sends.
 */
import {
  androidOrigin,
  normaliseOrigin,
  ORIGIN_ISSUE_LABELS,
  validateOrigin,
} from "~/utils/passkeys";

const props = defineProps<{
  rpId: string;
  origins: readonly string[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** The origin normalised: lower case, no trailing slash. */
  confirm: [origin: string];
}>();

const origin = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (value) origin.value = "";
});

const issue = computed(() => {
  const text = origin.value.trim();
  if (text === "") return "";
  const found = validateOrigin(text, props.rpId);
  if (found !== null) return ORIGIN_ISSUE_LABELS[found];
  if (props.origins.includes(normaliseOrigin(text))) return "Already on the list.";
  return "";
});

const ready = computed(() => origin.value.trim() !== "" && issue.value === "");

/** What a pasted fingerprint is stored as, shown before it is. */
const app = computed(() => androidOrigin(origin.value));

function confirm() {
  if (!ready.value) return;
  emit("confirm", normaliseOrigin(origin.value));
  /* Cleared before the fade, or the list it just joined reports it as already there. */
  origin.value = "";
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="440" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Add an application URL or Android app</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A page allowed to run a ceremony. Scheme, host and port, matched exactly, on
            <span class="font-mono text-ink/80">{{ rpId }}</span> or a subdomain of it. For an
            Android app, paste its SHA-256 signing certificate fingerprint; an iOS app needs no
            entry.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="origin-next">Application URL or fingerprint</label>
          <v-text-field
            id="origin-next"
            ref="field"
            v-model="origin"
            :error="issue !== ''"
            :placeholder="`https://app.${rpId}`"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-passkey-url"
            variant="filled"
          />
          <p class="m-0 text-[11px]" :class="issue ? 'text-error' : 'text-ink/50'">
            {{
              issue ||
              (app
                ? `Stored as ${app}.`
                : "https everywhere but localhost, and no path: the ceremony sends the origin, not the page.")
            }}
          </p>
        </div>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :disabled="!ready" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Add
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
