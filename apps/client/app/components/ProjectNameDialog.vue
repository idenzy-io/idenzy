<script setup lang="ts">
/**
 * Renames the project.
 *
 * One field, and the sentence under it is the whole reason the dialog says anything at all:
 * people assume this name is what their users see, and it is not. We render no page a user
 * could read it on, so it is a label for the switcher and the breadcrumb and nothing else.
 * Saying that here rather than in a guide is what stops somebody naming their project after
 * their product and then wondering why the authenticator still says something else.
 */
import {
  NAME_NOTE,
  PROJECT_NAME_ISSUE_LABELS,
  PROJECT_NAME_MAX_LENGTH,
  validateProjectName,
} from "~/utils/project-settings";

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

const issue = computed(() => validateProjectName(text.value));
const message = computed(() =>
  touched.value && issue.value !== null ? PROJECT_NAME_ISSUE_LABELS[issue.value] : "",
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
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Rename this project</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">{{ NAME_NOTE }}</p>
        </header>

        <div class="flex flex-col gap-1">
          <label :for="id" class="text-xs font-medium text-ink">Project name</label>
          <v-text-field
            :id="id"
            ref="field"
            v-model="text"
            :error="message !== ''"
            :maxlength="PROJECT_NAME_MAX_LENGTH"
            autocomplete="off"
            hide-details
            variant="outlined"
            @blur="touched = true"
          />
          <p v-if="message" class="m-0 text-[11px] leading-4 text-error">{{ message }}</p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
            Nothing about the project's id, keys or domains changes with it.
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
