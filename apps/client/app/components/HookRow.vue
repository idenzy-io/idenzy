<script setup lang="ts">
/**
 * One hook point on `RecordTable`: what it is for, whether it is ready, how long it may take and
 * how its calls have gone, with Configure at the end (notes/hooks.md).
 *
 * Configure opens the hook's own configuration, which owns the endpoint, the deadline, the check
 * and Enable; the menu keeps the quicker edits. Below 900px the row stacks into a card with its
 * purpose and state, which is the note's mobile arrangement.
 */
import {
  failureRateWords,
  formatDuration,
  HOOK_CALLS,
  HOOK_ICONS,
  HOOK_KIND_LABELS,
  HOOK_KINDS,
  HOOK_LABELS,
  HOOK_PURPOSES,
  type HookConfig,
  type HookStats,
  readinessWords,
  tailPastDeadline,
} from "~/utils/hooks";

const props = defineProps<{
  hook: HookConfig;
  /** Null where nothing calls it, which is not the same as a hook with no traffic. */
  stats: HookStats | null;
}>();

const emit = defineEmits<{
  configure: [];
  endpoint: [];
  deadline: [];
  remove: [];
}>();

const readiness = computed(() => readinessWords(props.hook, HOOK_CALLS.running));
const rate = computed(() => failureRateWords(props.stats, HOOK_CALLS.running));
const late = computed(() => tailPastDeadline(props.stats, props.hook.deadlineMs));

const RATE_TONES = { quiet: "text-ink/55", normal: "text-ink/80", warn: "text-warning" } as const;

/** Named for what it will do: a hook with nothing set up is set up, an enabled one managed. */
const action = computed(() => {
  if (props.hook.url === null) return "Set up";
  return props.hook.enabled ? "Manage" : "Configure";
});
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary min-w-0">
      <button
        class="flex min-w-0 items-start gap-3 rounded-(--idenzy-radius-x-small) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
        @click="emit('configure')"
      >
        <span
          :class="hook.enabled ? 'bg-primary/10 text-primary' : 'bg-ink/4 text-ink/60 ring-1 ring-ink/6 ring-inset'"
          aria-hidden="true"
          class="flex size-8 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
        >
          <Icon :name="HOOK_ICONS[hook.type]" class="text-base" />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="text-xs font-medium text-ink hover:underline">{{ HOOK_LABELS[hook.type] }}</span>
            <span class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55">
              {{ HOOK_KIND_LABELS[HOOK_KINDS[hook.type]] }}
            </span>
          </span>
          <span class="text-[11px] leading-4 text-ink/55">{{ HOOK_PURPOSES[hook.type] }}</span>
        </span>
      </button>
    </span>

    <span class="record-cell record-cell--half flex flex-col items-start gap-1" data-label="Ready?">
      <StatusBadge :label="readiness.label" :tone="readiness.tone" />
      <span v-if="readiness.detail" class="text-[11px] leading-4 text-ink/50">{{ readiness.detail }}</span>
    </span>

    <span class="record-cell record-cell--half flex flex-col gap-0.5" data-label="Deadline">
      <span class="font-mono text-xs text-ink tabular-nums">{{ formatDuration(hook.deadlineMs) }}</span>
      <span
        v-if="stats && stats.p99 !== null"
        :class="late ? 'text-warning' : 'text-ink/50'"
        class="text-[11px] leading-4"
      >
        p99 {{ formatDuration(stats.p99) }}
      </span>
    </span>

    <span class="record-cell record-cell--half flex flex-col gap-0.5" data-label="Failure rate">
      <span :class="RATE_TONES[rate.tone]" class="text-xs tabular-nums">{{ rate.label }}</span>
      <span v-if="rate.detail" class="text-[11px] leading-4 text-ink/50">{{ rate.detail }}</span>
    </span>

    <span class="record-cell record-cell--action record-cell--end flex items-center justify-end gap-1">
      <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="emit('configure')">
        {{ action }}
      </v-btn>
      <v-menu :offset="4" location="bottom end">
        <template #activator="{ props: activator }">
          <button
            v-bind="activator"
            :aria-label="`More for ${HOOK_LABELS[hook.type]}`"
            class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
          </button>
        </template>
        <v-list density="compact" min-width="220" nav>
          <v-list-item
            :title="hook.url ? 'Change endpoint' : 'Set endpoint'"
            prepend-icon="material-symbols:link"
            @click="emit('endpoint')"
          />
          <v-list-item
            :subtitle="`Now ${formatDuration(hook.deadlineMs)}`"
            prepend-icon="material-symbols:timer-outline"
            title="Change deadline"
            @click="emit('deadline')"
          />
          <template v-if="hook.url">
            <v-divider class="my-1" />
            <v-list-item
              class="hook-row__danger"
              prepend-icon="material-symbols:link-off"
              title="Remove endpoint"
              @click="emit('remove')"
            />
          </template>
        </v-list>
      </v-menu>
    </span>
  </li>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.hook-row__danger,
.v-list--nav .v-list-item.hook-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
