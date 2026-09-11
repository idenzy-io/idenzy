<script setup lang="ts">
/**
 * The review before a hook goes in the path: what will be called, how long a request can wait,
 * what the check found, and what a failure does, then Enable (notes/hooks.md P1).
 *
 * The check is the configuration's, run just now; the dialog says it is no promise about
 * tomorrow and points at the figures that are. Mounted only while open, closed by the page once
 * the write lands.
 */
import {
  addedTo,
  BUDGET_WARNING_MS,
  failureLine,
  formatDuration,
  HOOK_KINDS,
  HOOK_LABELS,
  type HookConfig,
  type HookSecret,
  KIND_NOUNS,
  NEXT_REQUEST,
  PATH_WORDS,
  pathOf,
} from "~/utils/hooks";
import { formatDate, formatDateTime } from "~/utils/time";

const props = defineProps<{
  hook: HookConfig;
  hooks: readonly HookConfig[];
  secret: HookSecret | null;
  projectName: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-title`;
const noun = computed(() => KIND_NOUNS[HOOK_KINDS[props.hook.type]]);

const budget = computed(() => {
  const path = pathOf(props.hook.type);
  if (path === null) return null;
  return {
    words: PATH_WORDS[path],
    before: addedTo(path, props.hooks),
    after: addedTo(path, props.hooks, { type: props.hook.type, enabled: true }),
  };
});

/** Passed, or passed with the warning a reader should see before enabling. */
const checked = computed(() => {
  const check = props.hook.check;
  if (check === null) return "Not validated";
  const warning = check.findings.find((finding) => finding.verdict === "warn");
  const when = formatDateTime(check.at);
  return warning ? `${when}, with a warning: ${warning.detail}` : `${when}, every check passed`;
});

function confirm() {
  if (!props.busy) emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="560">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            Enable {{ HOOK_LABELS[hook.type] }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ projectName }}</span>, from the next
            {{ NEXT_REQUEST[hook.type] }}.
          </p>
        </header>

        <dl class="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs leading-5">
          <dt class="text-ink/55">Endpoint</dt>
          <dd class="m-0 font-mono break-all text-ink">{{ hook.url }}</dd>
          <dt class="text-ink/55">Deadline</dt>
          <dd class="m-0 font-mono text-ink">{{ formatDuration(hook.deadlineMs) }}</dd>
          <dt class="text-ink/55">Validated</dt>
          <dd class="m-0 text-ink">{{ checked }}</dd>
          <dt class="text-ink/55">Signed with</dt>
          <dd class="m-0 text-ink">
            {{ secret ? `The hook secret made ${formatDate(secret.createdAt)}` : "No hook secret" }}
          </dd>
          <template v-if="budget">
            <dt class="text-ink/55">Worst case</dt>
            <dd class="m-0 text-ink">
              A {{ budget.words }} waits on hooks for at most
              <span class="font-mono">{{ formatDuration(budget.before) }}</span> →
              <span :class="budget.after > BUDGET_WARNING_MS ? 'text-warning' : ''" class="font-mono">
                {{ formatDuration(budget.after) }}</span>
            </dd>
          </template>
        </dl>

        <p
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 text-xs leading-5 text-ink/80 ring-1 ring-ink/6 ring-inset"
        >
          <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-warning" name="material-symbols:warning-outline" />
          <span>{{ failureLine(hook.type) }}</span>
        </p>

        <p class="m-0 text-[11px] leading-4 text-ink/55">
          A check says the endpoint answered just now, not that it will tomorrow. Failed and Timed
          out on this page count every call that did not.
        </p>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :loading="busy" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Enable {{ noun }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
