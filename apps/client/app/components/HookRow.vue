<script setup lang="ts">
/**
 * One hook: what it is, where it runs, where we call, and the switch that puts it in the
 * request path.
 *
 * The four lines under the name are the four a support question is about. What kind of
 * thing it is, because a gate and an override fail in different words. Where in the request
 * it runs, because that is what decides whether it can still stop anything. What we call,
 * because a hook pointed at a stale host is the commonest way one of these breaks. And how
 * the calls have been going, because a deadline set above the wrong percentile is invisible
 * until the day it is not.
 *
 * The switch is disabled without an endpoint, rather than hidden or quietly ineffective. A
 * hook switched on with nowhere to call would show as live and refuse nobody, and somebody
 * would spend an afternoon on why their gate lets everyone through.
 *
 * `p99` sits next to the deadline on purpose. It is the comparison that matters and the one
 * nobody makes: a deadline under the tail is not a timeout setting, it is a decision to fail
 * that share of sign-ins.
 */
import type { HookStats } from "~/stores/hooks";
import {
  formatDuration,
  HOOK_ICONS,
  HOOK_KIND_LABELS,
  HOOK_KINDS,
  HOOK_LABELS,
  HOOK_NOTES,
  HOOK_STAGES,
  HOOK_STATE_LABELS,
  type HookConfig,
  hookStateOf,
} from "~/utils/hooks";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  hook: HookConfig;
  /** Null where the hook is not live, which is not the same as a hook with no traffic. */
  stats: HookStats | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  toggle: [value: boolean];
  configure: [];
  deadline: [];
  remove: [];
}>();

const now = useNow({ interval: 60_000 });

const state = computed(() => hookStateOf(props.hook));
const live = computed(() => state.value === "live");
const kind = computed(() => HOOK_KINDS[props.hook.type]);

/** The tail is over the deadline, so some share of calls is being cut off deliberately. */
const tailOverDeadline = computed(
  () => props.stats?.p99 !== null && (props.stats?.p99 ?? 0) > props.hook.deadlineMs,
);
</script>

<template>
  <div class="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4">
    <span
      :class="live ? 'bg-primary/10 text-primary' : 'bg-ink/6 text-ink/60'"
      aria-hidden="true"
      class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
    >
      <Icon :name="HOOK_ICONS[hook.type]" class="text-lg" />
    </span>

    <div class="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="text-sm font-medium text-ink">{{ HOOK_LABELS[hook.type] }}</span>
        <span
          class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
        >
          {{ HOOK_KIND_LABELS[kind] }}
        </span>
        <StatusBadge
          :label="HOOK_STATE_LABELS[state]"
          :tone="state === 'live' ? 'success' : state === 'off' ? 'neutral' : 'warning'"
        />
      </div>

      <p class="m-0 text-xs leading-5 text-ink/60">{{ HOOK_NOTES[hook.type] }}</p>

      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
        <span class="flex min-w-0 items-center gap-1.5">
          <Icon
            aria-hidden="true"
            class="flex-none text-xs"
            name="material-symbols:alt-route"
          />
          {{ HOOK_STAGES[hook.type] }}
        </span>
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span v-if="hook.url" class="flex min-w-0 items-center gap-1.5 text-ink/70">
          <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:link" />
          <span class="truncate font-mono">{{ hook.url }}</span>
        </span>
        <span v-else class="flex items-center gap-1.5 text-warning">
          <Icon
            aria-hidden="true"
            class="flex-none text-xs"
            name="material-symbols:link-off"
          />
          No endpoint set
        </span>

        <span class="flex items-center gap-1.5 text-ink/55">
          <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:timer-outline" />
          <span :class="tailOverDeadline ? 'text-warning' : ''" class="font-mono tabular-nums">
            {{ formatDuration(hook.deadlineMs) }}
          </span>
          deadline
        </span>

        <template v-if="stats">
          <span class="flex items-center gap-1.5 text-ink/55">
            <span class="font-mono tabular-nums text-ink/75">
              {{ stats.calls.toLocaleString("en") }}
            </span>
            calls
          </span>
          <span v-if="stats.p99 !== null" class="flex items-center gap-1.5 text-ink/55">
            <span
              :class="tailOverDeadline ? 'text-warning' : 'text-ink/75'"
              class="font-mono tabular-nums"
            >
              {{ formatDuration(stats.p99) }}
            </span>
            p99
          </span>
          <span v-if="stats.failed > 0" class="flex items-center gap-1.5 text-error">
            <Icon
              aria-hidden="true"
              class="flex-none text-xs"
              name="material-symbols:error-outline"
            />
            <span class="font-mono tabular-nums">{{ stats.failed }}</span>
            failed
          </span>
        </template>
        <span v-else-if="hook.lastCalledAt" class="text-ink/45">
          Last called {{ relativeTimeWords(hook.lastCalledAt, now) }}
        </span>
      </div>
    </div>

    <div class="flex flex-none items-center gap-1">
      <v-tooltip
        :disabled="hook.url !== null"
        location="top"
        max-width="240"
        text="Name an endpoint first. A hook switched on with nowhere to call would read as live and refuse nobody."
      >
        <template #activator="{ props: tip }">
          <span v-bind="tip">
            <v-switch
              :aria-label="HOOK_LABELS[hook.type]"
              :disabled="busy || hook.url === null"
              :loading="busy"
              :model-value="hook.enabled"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="emit('toggle', $event === true)"
            />
          </span>
        </template>
      </v-tooltip>

      <v-menu :offset="4" location="bottom end">
        <template #activator="{ props: activator }">
          <button
            v-bind="activator"
            :aria-label="`Actions for ${HOOK_LABELS[hook.type]}`"
            class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
          </button>
        </template>

        <v-list density="compact" min-width="232" nav>
          <v-list-item
            :subtitle="hook.url ? 'Change where we call' : 'Name where we call'"
            :title="hook.url ? 'Change endpoint' : 'Set endpoint'"
            prepend-icon="material-symbols:link"
            @click="emit('configure')"
          />
          <v-list-item
            :subtitle="`Currently ${formatDuration(hook.deadlineMs)}`"
            prepend-icon="material-symbols:timer-outline"
            title="Change the deadline"
            @click="emit('deadline')"
          />
          <template v-if="hook.url">
            <v-divider class="my-1" />
            <v-list-item
              class="hook-row__danger"
              prepend-icon="material-symbols:link-off"
              subtitle="Takes it out of the path"
              title="Remove endpoint"
              @click="emit('remove')"
            />
          </template>
        </v-list>
      </v-menu>
    </div>
  </div>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.hook-row__danger,
.v-list--nav .v-list-item.hook-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
