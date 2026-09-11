<script setup lang="ts">
/**
 * Adds one origin. A scheme, a host and an optional port, and the refusals say which of
 * the four rules the typed value broke rather than that it was invalid.
 *
 * The value is echoed back as it will be stored, because an origin is compared as an
 * exact string: a trailing slash, a capital letter or a path the customer did not mean to
 * paste all produce a list entry that never matches the header a browser sends, and the
 * failure looks identical to not having added it at all.
 */
import { ALLOWED_ORIGIN_ISSUE_LABELS, validateAllowedOrigin } from "~/utils/origins";
/* The syntax of an origin is one fact and lives in one place; see the note in
   `~/utils/origins` about why the rules that make one allowed do not. */
import { normaliseOrigin } from "~/utils/passkeys";

const props = defineProps<{
  /** What the project already allows, so a duplicate is refused before the call. */
  existing: readonly string[];
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [origin: string];
}>();

const typed = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (value) typed.value = "";
});

const issue = computed(() => {
  if (typed.value.trim() === "") return "";
  const found = validateAllowedOrigin(typed.value, props.existing);
  return found === null ? "" : ALLOWED_ORIGIN_ISSUE_LABELS[found];
});

const ready = computed(() => typed.value.trim() !== "" && issue.value === "");
const stored = computed(() => (ready.value ? normaliseOrigin(typed.value) : ""));
const changed = computed(() => ready.value && stored.value !== typed.value.trim());

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", stored.value);
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Allow an origin</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            A page here may read a credentialed response from the auth API. It is not a
            redirect target and not a passkey origin: those are their own lists, and adding
            one there does not add it here.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="origin-value">Origin</label>
          <v-text-field
            id="origin-value"
            ref="field"
            v-model="typed"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="https://app.example.com"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ issue || "Scheme, host and port. No path, no trailing slash, no wildcard." }}
          </p>
        </div>

        <p
          v-if="changed"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:content-cut"
          />
          <span>
            Stored as <span class="font-mono text-ink">{{ stored }}</span
            >. An origin is compared as an exact string, so what a browser sends is the
            scheme, the host and the port and nothing else.
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
            Allow it
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
