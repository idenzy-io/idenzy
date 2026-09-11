<script setup lang="ts">
/**
 * How long we wait for one hook, as a bounded duration with its unit beside it and the
 * endpoint's own latency beside that (notes/hooks.md, "Deadline edit").
 *
 * The figure that matters is the tail and not the median: a deadline under the p99 is a decision
 * to fail about one call in a hundred. Where nothing has been measured the dialog says so rather
 * than inventing a number to set it against. What the value costs a request in the worst case is
 * a before and an after. Mounted only while open and closed by the page once the write lands.
 */
import {
  addedTo,
  BUDGET_WARNING_MS,
  DEADLINE_MAX_MS,
  DEADLINE_MIN_MS,
  deadlineIssue,
  deadlineOutcome,
  formatDuration,
  HOOK_CALLS,
  HOOK_FIGURE_DAYS,
  HOOK_LABELS,
  type HookConfig,
  type HookStats,
  PATH_WORDS,
  pathOf,
  tailPastDeadline,
} from "~/utils/hooks";

const props = defineProps<{
  hook: HookConfig;
  hooks: readonly HookConfig[];
  stats: HookStats | null;
  projectName: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [deadlineMs: number];
}>();

const titleId = `${useId()}-title`;
const fieldId = `${useId()}-value`;
const helpId = `${useId()}-help`;
const field = useTemplateRef<{ focus: () => void }>("field");
const running = HOOK_CALLS.running;

const text = ref(String(props.hook.deadlineMs));
const issue = computed(() => deadlineIssue(text.value));
const value = computed(() =>
  issue.value === "" ? Number(text.value.trim()) : props.hook.deadlineMs,
);
const late = computed(() => tailPastDeadline(props.stats, value.value));

/** The worst case on the hook's own path, now and with the typed value. */
const budget = computed(() => {
  const path = pathOf(props.hook.type);
  if (path === null) return null;
  return {
    words: PATH_WORDS[path],
    before: addedTo(path, props.hooks),
    after: addedTo(path, props.hooks, {
      type: props.hook.type,
      deadlineMs: value.value,
      enabled: true,
    }),
  };
});

function confirm() {
  if (issue.value !== "" || props.busy) return;
  emit("confirm", value.value);
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="500" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            Change deadline for {{ HOOK_LABELS[hook.type] }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ projectName }}</span>. How long we wait for
            your answer before the call is abandoned. Now {{ formatDuration(hook.deadlineMs) }}.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label :for="fieldId" class="text-xs font-medium text-ink">Wait at most</label>
          <v-text-field
            :id="fieldId"
            ref="field"
            v-model="text"
            :aria-describedby="helpId"
            :error="issue !== ''"
            :max="DEADLINE_MAX_MS"
            :min="DEADLINE_MIN_MS"
            autocomplete="off"
            class="font-mono"
            hide-details
            step="100"
            suffix="ms"
            type="number"
            variant="filled"
          />
          <p :id="helpId" :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{
              issue ||
              `${formatDuration(value)}. Between ${formatDuration(DEADLINE_MIN_MS)} and ${formatDuration(DEADLINE_MAX_MS)}.`
            }}
          </p>
        </div>

        <div
          class="flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 p-3 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
        >
          <p v-if="stats && stats.p50 !== null && stats.p99 !== null" class="m-0">
            Over the last {{ HOOK_FIGURE_DAYS }} days your endpoint answered in
            <span class="font-mono text-ink">{{ formatDuration(stats.p50) }}</span> at the median
            and <span :class="late ? 'text-warning' : 'text-ink'" class="font-mono">{{ formatDuration(stats.p99) }}</span>
            at p99.
            <template v-if="late">
              This is under the p99, so about one call in a hundred would be cut off, and each
              fails its request.
            </template>
          </p>
          <p v-else class="m-0">
            {{ running ? "Nothing has called it yet" : "Not measured: nothing calls it yet" }}, so
            there is no latency to set it against. Set it above your endpoint's slowest normal
            answer, not its typical one.
          </p>

          <p v-if="budget && hook.enabled" class="m-0">
            A {{ budget.words }} waits on hooks for at most
            <span class="font-mono text-ink">{{ formatDuration(budget.before) }}</span> →
            <span :class="budget.after > BUDGET_WARNING_MS ? 'text-warning' : 'text-ink'" class="font-mono">
              {{ formatDuration(budget.after) }}</span>.
          </p>
          <p v-else-if="budget" class="m-0">
            Once it is enabled, a {{ budget.words }} waits on hooks for at most
            <span :class="budget.after > BUDGET_WARNING_MS ? 'text-warning' : 'text-ink'" class="font-mono">
              {{ formatDuration(budget.after) }}</span>.
          </p>
          <p v-else class="m-0">Off the sign-in path: it delays a message, never a sign-in.</p>

          <p class="m-0 font-medium text-ink">{{ deadlineOutcome(hook.type, value) }}</p>
        </div>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :loading="busy" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Save deadline
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
