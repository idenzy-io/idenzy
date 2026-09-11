<script setup lang="ts">
/**
 * Deletes the project, and spends most of its room on what that actually reaches.
 *
 * Two of the five effects are the reason this dialog is longer than a confirm usually is.
 * The project's wrapped data key is destroyed, so every column that went through the field
 * encryptor is unreadable from that moment in a backup as much as in the database, which
 * makes this more final than a delete normally is. And the billing record is kept
 * pseudonymously for six years because statutory financial record keeping requires it, so a
 * dialog that said "everything is gone" would be saying something untrue to the one person
 * entitled to an accurate answer.
 *
 * The counts above them are not decoration. They are the difference between deleting an
 * experiment and deleting production, and they are the thing somebody reads when the name
 * in the corner did not register.
 *
 * Typing the name is the confirmation for a reason specific to this panel: every project
 * looks identical apart from a word in the corner, and the one somebody is looking at is
 * the one they last clicked rather than the one they have in mind.
 */
import { DELETE_CONFIRM_NOTE, DELETE_EFFECTS } from "~/utils/project-settings";

const props = defineProps<{
  name: string;
  users: number;
  sessions: number;
  keys: number;
  /** False for the last project, which cannot go: the panel needs one to show. */
  allowed: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const typed = ref("");
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (showing) => {
  if (showing) typed.value = "";
});

const matches = computed(() => typed.value.trim() === props.name);
const ready = computed(() => props.allowed && matches.value);

const TONES = {
  error: "text-error",
  warning: "text-warning",
  muted: "text-ink/40",
} as const;

const counts = computed(() => [
  { label: props.users === 1 ? "user" : "users", value: props.users },
  { label: props.sessions === 1 ? "live session" : "live sessions", value: props.sessions },
  { label: props.keys === 1 ? "live key" : "live keys", value: props.keys },
]);

function confirm() {
  if (!ready.value) return;
  emit("confirm");
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
  <v-dialog v-model="open" max-width="520" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">
            Delete <span class="text-error">{{ name }}</span>
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            There is no grace period and nothing to restore from. Read the last two lines
            below before the first three: they are the ones people are surprised by.
          </p>
        </header>

        <!-- What is in it, which is the difference between an experiment and production. -->
        <div
          class="flex flex-wrap gap-x-6 gap-y-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3.5 py-3"
        >
          <span v-for="count in counts" :key="count.label" class="flex items-baseline gap-1.5">
            <span class="font-mono text-base leading-none font-medium text-ink tabular-nums">
              {{ count.value.toLocaleString("en") }}
            </span>
            <span class="text-[11px] text-ink/60">{{ count.label }}</span>
          </span>
        </div>

        <ul class="m-0 flex list-none flex-col gap-2.5 p-0 text-xs leading-5 text-ink/75">
          <li v-for="effect in DELETE_EFFECTS" :key="effect.id" class="flex items-start gap-2">
            <Icon
              :class="TONES[effect.tone]"
              :name="effect.icon"
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm"
            />
            <span>
              <span class="font-medium text-ink">{{ effect.label }}.</span>
              {{ effect.note }}
            </span>
          </li>
        </ul>

        <div v-if="allowed" class="flex flex-col gap-1">
          <label :for="id" class="text-xs font-medium text-ink">
            Type <span class="font-mono text-error">{{ name }}</span> to confirm
          </label>
          <v-text-field
            :id="id"
            ref="field"
            v-model="typed"
            autocapitalize="off"
            autocomplete="off"
            class="font-mono"
            density="compact"
            hide-details
            spellcheck="false"
            variant="outlined"
          />
          <p class="m-0 text-[11px] leading-4 text-ink/55">{{ DELETE_CONFIRM_NOTE }}</p>
        </div>

        <p
          v-else
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5 text-[11px] leading-4 text-ink/65"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-ink/40"
            name="material-symbols:info-outline"
          />
          <span>
            This is the only project on the organisation, so it cannot be deleted. Make
            another one first, or close the account instead: an organisation with no project
            has nothing for anybody to sign in to.
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
            Keep the project
          </v-btn>
          <v-btn
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Delete permanently
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
