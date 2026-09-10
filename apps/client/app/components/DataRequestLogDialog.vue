<script setup lang="ts">
/**
 * Intake. Who asked, what they asked for, and who took it down.
 *
 * The deadline is not on this form and never will be. It is statutory, computed at
 * intake, and a field offering to set it would be a field offering to move it. What the
 * dialog does show is the date it lands on, so nobody is surprised by it later.
 *
 * The subject is checked against the project's accounts before anything is logged. A
 * request is executed by a worker against a user id, so one naming somebody who was never
 * here would sit on the list looking like work and quietly do nothing.
 */
import {
  type DataSubjectRequest,
  dueFrom,
  GDPR_DUE_DAYS,
  kindInfo,
  REQUEST_KINDS,
  type RequestKind,
  SUBJECT_ISSUE_LABELS,
  validateSubject,
} from "~/utils/data-requests";
import { formatDate } from "~/utils/time";

const props = defineProps<{
  /** The accounts on this project, so a subject resolves to one before it is logged. */
  subjects: readonly { id: string; label: string }[];
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [
    draft: Pick<DataSubjectRequest, "subjectUserId" | "subjectLabel" | "kind" | "requestedBy">,
  ];
}>();

const subject = ref("");
const kind = ref<RequestKind>("access");
const by = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (!value) return;
  subject.value = "";
  kind.value = "access";
  by.value = "";
});

const matched = computed(() => {
  const text = subject.value.trim().toLowerCase();
  return (
    props.subjects.find(
      (entry) => entry.id.toLowerCase() === text || entry.label.toLowerCase() === text,
    ) ?? null
  );
});

const subjectIssue = computed(() => {
  if (subject.value.trim() === "") return "";
  const found = validateSubject(subject.value, props.subjects);
  return found === null ? "" : SUBJECT_ISSUE_LABELS[found];
});

const ready = computed(() => matched.value !== null && subjectIssue.value === "");
const due = computed(() => formatDate(dueFrom(new Date())));
const chosen = computed(() => kindInfo(kind.value));

function confirm() {
  const person = matched.value;
  if (!ready.value || person === null || props.busy) return;
  emit("confirm", {
    subjectUserId: person.id,
    subjectLabel: person.label,
    kind: kind.value,
    requestedBy: by.value.trim() === "" ? "Logged in the dashboard" : by.value.trim(),
  });
}
</script>

<template>
  <v-dialog v-model="open" max-width="500" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Log a data request</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            For a request that reached you somewhere else: a support ticket, an email, a
            form of your own. One arriving through your own account flow is logged for you.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="dsr-subject">Whose data</label>
          <v-text-field
            id="dsr-subject"
            ref="field"
            v-model="subject"
            :error="subjectIssue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="amelia.hart@example.com"
            variant="filled"
          />
          <p
            :class="subjectIssue ? 'text-error' : 'text-ink/50'"
            class="m-0 text-[11px] leading-4"
          >
            <template v-if="subjectIssue">{{ subjectIssue }}</template>
            <template v-else-if="matched">
              Matched <span class="font-mono text-ink/80">{{ matched.id }}</span
              >. The worker acts on that id, and it survives the erasure as proof it ran.
            </template>
            <template v-else>An address or a user id on this project.</template>
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">What they asked for</span>
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="entry in REQUEST_KINDS"
              :key="entry"
              :class="
                kind === entry
                  ? 'border-primary/50 bg-primary/8 text-ink'
                  : 'border-line bg-canvas text-ink/70 hover:border-ink/20'
              "
              class="flex cursor-pointer items-center gap-2 rounded-(--idenzy-radius-small) border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="kind = entry"
            >
              <Icon :name="kindInfo(entry).icon" aria-hidden="true" class="flex-none text-base" />
              <span class="flex min-w-0 flex-col">
                <span class="text-xs font-medium">{{ kindInfo(entry).label }}</span>
                <span class="font-mono text-[10px] text-ink/45">{{ kindInfo(entry).article }}</span>
              </span>
            </button>
          </div>
          <p class="m-0 text-[11px] leading-4 text-ink/55">{{ chosen.note }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="dsr-by">Who took it down</label>
          <v-text-field
            id="dsr-by"
            v-model="by"
            hide-details
            placeholder="Support ticket #5120"
            variant="filled"
          />
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            Optional. An auditor asks where a request came from before they ask what you
            did about it.
          </p>
        </div>

        <p
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:schedule-outline"
          />
          <span>
            Due <span class="font-medium text-ink">{{ due }}</span
            >, {{ GDPR_DUE_DAYS }} days from now. The deadline is statutory and computed at
            intake, so it is not a field on this form. An overdue request pages somebody.
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
            Log the request
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
