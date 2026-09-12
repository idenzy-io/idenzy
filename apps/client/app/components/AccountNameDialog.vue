<script setup lang="ts">
/**
 * Renames the account holder.
 *
 * The name is a label and never a credential: it is what the member list, the audit trail
 * and the drawer call you, and nothing signs in with it. Saying so under the field is what
 * stops somebody treating it as the thing an address change would be, and it is the reason
 * this dialog needs no confirmation step when `AccountEmailDialog` beside it needs two.
 *
 * It is a dialog rather than the field in the header it replaced. The field committed on
 * blur, which meant clicking anywhere wrote, an empty name silently did nothing, and there
 * was no cancel. A dialog has a submit to validate against and an exit that discards.
 */
import { ACCOUNT_NAME_ISSUE_LABELS, ACCOUNT_NAME_MAX, validateAccountName } from "~/utils/account";

const props = defineProps<{
  current: string;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [name: string];
}>();

const text = ref("");
const touched = ref(false);
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (showing) => {
  if (showing) {
    text.value = props.current;
    touched.value = false;
  }
});

const issue = computed(() => validateAccountName(text.value));
const message = computed(() =>
  touched.value && issue.value !== null ? ACCOUNT_NAME_ISSUE_LABELS[issue.value] : "",
);
const unchanged = computed(() => text.value.trim() === props.current);
const ready = computed(() => issue.value === null && !unchanged.value);

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
const titleId = useId();
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    max-width="460"
    @after-enter="field?.focus()"
  >
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Change your name</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            What this dashboard shows you as. It is not what you sign in with, and changing
            it asks nothing of your address.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label :for="id" class="text-xs font-medium text-ink">Your name</label>
          <v-text-field
            :id="id"
            ref="field"
            v-model="text"
            :error="message !== ''"
            :maxlength="ACCOUNT_NAME_MAX"
            autocomplete="name"
            hide-details
            variant="filled"
            @blur="touched = true"
          />
          <p v-if="message" class="m-0 text-[11px] leading-4 text-error">{{ message }}</p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
            Your colleagues see it in the member list, and the audit trail keeps the name
            that was current when each entry was written.
          </p>
        </div>

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
            Save name
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
