<script setup lang="ts">
/**
 * Makes a second project, from the switcher that lists the first.
 *
 * A name is the only answer, because a project has nothing else a customer may choose:
 * the tier is a signed agreement rather than a field (project-settings.ts), and the id,
 * the plan and the keys are the service's to mint. So the dialog spends its words on the
 * two things the switcher cannot show — which organisation is about to own this, and what
 * a new project does not come with.
 *
 * The allowance line is the one people get wrong. A project looks like the unit of
 * everything because every screen behind the drawer is scoped to one, but the wallet and
 * the free allowance are the organisation's (PROJECT.md, "the allowance and the bands are
 * the organisation's rather than each project's"), so a second project is more surface and
 * not more free volume. Somebody splitting work across projects to pay less should find
 * that out here rather than on an invoice.
 *
 * It does not close itself on `busy` falling. Creating takes an admin and the menu offers
 * the item to every role, so the ordinary failure here is a refusal rather than a network
 * fault: the dialog stays open with the name still typed, the service's sentence under the
 * field, and the caller closes it only once there is a project (notes/dialogs.md, "Saving
 * is not the same as closing").
 */
import {
  PROJECT_NAME_ISSUE_LABELS,
  PROJECT_NAME_MAX_LENGTH,
  validateProjectName,
} from "~/utils/project-settings";

const props = defineProps<{
  /** The organisation about to own it, named because it is what pays. */
  org: string;
  busy: boolean;
  /** Why the service refused. The dialog stays open with the name still in the field. */
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [name: string];
}>();

const text = ref("");
const touched = ref(false);
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (showing) => {
  if (showing) {
    text.value = "";
    touched.value = false;
  }
});

const issue = computed(() => validateProjectName(text.value));
const message = computed(() =>
  touched.value && issue.value !== null ? PROJECT_NAME_ISSUE_LABELS[issue.value] : "",
);
const ready = computed(() => issue.value === null);

function confirm() {
  touched.value = true;
  if (!ready.value || props.busy) return;
  emit("confirm", text.value.trim());
}

const id = useId();
const titleId = useId();
</script>

<template>
  <!-- `persistent` while the write is in flight: the click that dismissed it would leave a
       project created and nothing on screen saying so. -->
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :persistent="busy"
    max-width="460"
    @after-enter="field?.focus()"
  >
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Create a project</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            It belongs to <span class="font-medium text-ink">{{ org }}</span
            >, and starts empty: its own users, keys, sign-in methods and domains, none of
            them copied from the project you are in.
          </p>
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
            placeholder="Staging"
            variant="filled"
            @blur="touched = true"
          />
          <p v-if="message" class="m-0 text-[11px] leading-4 text-error">{{ message }}</p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
            A label for this dashboard. No user of yours ever reads it, and you can change
            it later in settings.
          </p>
        </div>

        <InfoNote>
          Your team and your balance stay where they are. Members are
          {{ org }}'s, and so is the free allowance — a second project draws on the same
          wallet rather than starting with one of its own.
        </InfoNote>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex items-center justify-end gap-2">
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
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Create project
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
