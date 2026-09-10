<script setup lang="ts">
/**
 * Renames what an authenticator app files the account under. It is the customer's
 * product name and nothing of ours, and changing it costs nothing: an app keeps the name
 * it was enrolled with, and the new one is what the next enrolment shows.
 */
import { ISSUER_ISSUE_LABELS, validateIssuer } from "~/utils/mfa";

const props = defineProps<{
  /** The name set on the project, or null while it follows the project's own. */
  current: string | null;
  /** The project's name, which is what null shows. */
  fallback: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** The name trimmed, or null to follow the project's name again. */
  confirm: [issuer: string | null];
}>();

const name = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (value) name.value = props.current ?? props.fallback;
});

const issue = computed(() => {
  const found = validateIssuer(name.value);
  if (found !== null) return ISSUER_ISSUE_LABELS[found];
  if (name.value.trim() === (props.current ?? props.fallback)) {
    return "That is the name the project has now.";
  }
  return "";
});

const invalid = computed(() => validateIssuer(name.value) !== null);
const ready = computed(() => issue.value === "");

function confirm() {
  if (!ready.value) return;
  emit("confirm", name.value.trim());
  open.value = false;
}

function useProjectName() {
  emit("confirm", null);
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="440" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Rename the issuer</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            What the authenticator app shows beside the account. Apps already enrolled
            keep the name they were enrolled with.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="totp-issuer-next">Issuer</label>
          <v-text-field
            id="totp-issuer-next"
            ref="field"
            v-model="name"
            :error="invalid"
            :placeholder="fallback"
            autocomplete="off"
            hide-details
            variant="filled"
          />
          <p :class="invalid ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px]">
            {{ invalid ? issue : "Short, and the product's: it sits beside the address in a list of every app the person has." }}
          </p>
        </div>

        <footer class="flex items-center justify-between gap-2">
          <v-btn
            v-if="current !== null"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="useProjectName"
          >
            Use the project's name
          </v-btn>
          <span v-else />
          <span class="flex items-center gap-2">
            <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
              Cancel
            </v-btn>
            <v-btn :disabled="!ready" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
              Rename
            </v-btn>
          </span>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
