<script setup lang="ts">
/**
 * Where we call for one hook, in the note's order: the hook and the project, the URL, what
 * arrives and what to answer, then what a late or failed answer does (notes/hooks.md).
 *
 * Saving never enables. A new endpoint is checked and reviewed before it goes in the path, and a
 * new URL on an enabled hook is validated first and replaces the current one only if it passes,
 * so an untested address is never what a request waits on (P1). The first endpoint on a project
 * makes its hook secret, which the page shows once after the save.
 *
 * No duplicate check: pointing all five at one route is the shape to aim for, because the body
 * and the header both say which hook it is. Mounted by the page only while open and closed by it
 * once the write lands; a full-height sheet below `lg`.
 */
import {
  ANSWER_NOTES,
  failureLine,
  formatDuration,
  HOOK_LABELS,
  HOOK_TYPE_HEADER,
  type HookSecret,
  type HookType,
  sampleRequest,
  sampleResponse,
} from "~/utils/hooks";
import { ENDPOINT_ISSUE_LABELS, normaliseEndpointUrl, validateEndpointUrl } from "~/utils/webhooks";

const props = defineProps<{
  type: HookType;
  projectName: string;
  /** What is stored now, so the field opens on it. */
  current: string | null;
  deadlineMs: number;
  /** In the path, so a new URL is validated before it replaces the one being called. */
  enabled: boolean;
  secret: HookSecret | null;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [url: string];
}>();

const { lgAndUp } = useDisplay();
const titleId = `${useId()}-title`;
const fieldId = `${useId()}-url`;
const helpId = `${useId()}-help`;

const url = ref(props.current ?? "");
const touched = ref(false);

/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

/* A blank field is only an error once somebody has left it or tried to save it. */
const issue = computed(() => {
  if (url.value.trim() === "") return touched.value ? ENDPOINT_ISSUE_LABELS.url_invalid : "";
  const found = validateEndpointUrl(url.value, []);
  return found === null ? "" : ENDPOINT_ISSUE_LABELS[found];
});

const replacing = computed(
  () =>
    props.enabled && props.current !== null && normaliseEndpointUrl(url.value) !== props.current,
);

function confirm() {
  touched.value = true;
  if (url.value.trim() === "" || issue.value !== "" || props.busy) return;
  emit("confirm", normaliseEndpointUrl(url.value));
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 600 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
    @after-enter="field?.focus()"
  >
    <v-card border flat>
      <form
        :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'"
        class="flex min-h-0 flex-col"
        @submit.prevent="confirm"
      >
        <header class="flex flex-none flex-col gap-1 border-b border-line px-5 py-4">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            {{ current ? "Change" : "Set" }} endpoint for {{ HOOK_LABELS[type] }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Where we call on <span class="font-medium text-ink">{{ projectName }}</span>, waiting
            up to {{ formatDuration(deadlineMs) }} for the answer. Saving does not enable it.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <div class="flex flex-col gap-1">
            <label :for="fieldId" class="text-xs font-medium text-ink">Endpoint URL</label>
            <v-text-field
              :id="fieldId"
              ref="field"
              v-model="url"
              :aria-describedby="helpId"
              :error="issue !== ''"
              autocapitalize="off"
              autocomplete="off"
              class="font-mono"
              hide-details
              placeholder="https://api.example.com/idenzy/hooks"
              spellcheck="false"
              variant="filled"
              @blur="touched = true"
            />
            <p :id="helpId" :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
              {{
                issue ||
                `https, on a host we can reach from our own network. One route can serve every hook: ${HOOK_TYPE_HEADER} says which.`
              }}
            </p>
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              {{
                secret
                  ? "Signed with this project's hook secret, which is not a webhook secret."
                  : "Signed with a hook secret made when you save this, and shown once then. It is not a webhook secret."
              }}
            </p>
          </div>

          <section class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-ink">What arrives</span>
            <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
              <CodeBlock :code="sampleRequest(type)" lang="json" />
            </div>
          </section>

          <section class="flex flex-col gap-1.5">
            <span class="text-xs font-medium text-ink">
              What to answer, within {{ formatDuration(deadlineMs) }}
            </span>
            <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
              <CodeBlock :code="sampleResponse(type)" lang="json" />
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/50">{{ ANSWER_NOTES[type] }}</p>
          </section>

          <p
            class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 text-xs leading-5 text-ink/80 ring-1 ring-ink/6 ring-inset"
          >
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-warning" name="material-symbols:warning-outline" />
            <span>{{ failureLine(type) }} We stop waiting at {{ formatDuration(deadlineMs) }}.</span>
          </p>

          <p v-if="replacing" class="m-0 text-[11px] leading-4 text-ink/55">
            This hook is enabled, so the new URL is validated first. It replaces
            <span class="font-mono break-all text-ink/75">{{ current }}</span> only if it passes;
            if it does not, nothing changes.
          </p>

          <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>
        </div>

        <footer class="flex flex-none items-center justify-end gap-2 border-t border-line px-5 py-3">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <!-- Never disabled: pressing it on an unfinished field is what shows the problem. -->
          <v-btn :loading="busy" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            {{ replacing ? "Validate and save" : "Save endpoint" }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
