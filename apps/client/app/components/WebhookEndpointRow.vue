<script setup lang="ts">
/**
 * One endpoint on `RecordTable`: where it is, what it is set to, how its deliveries are going
 * and when it was last called, with Manage at the end (notes/webhooks.md).
 *
 * Manage selects the endpoint, and its detail below the list owns Edit and Send test event;
 * the menu keeps the less frequent acts, pausing and removing. Below 900px the row stacks into
 * a card of its own, which is the note's mobile arrangement.
 */
import { relativeTimeWords } from "~/utils/time";
import {
  type EndpointHealth,
  endpointState,
  healthWords,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const props = defineProps<{
  endpoint: WebhookEndpoint;
  health: EndpointHealth;
  selected: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  manage: [];
  edit: [];
  pause: [];
  resume: [];
  remove: [];
}>();

const now = useNow({ interval: 30_000 });

const state = computed(() => endpointState(props.endpoint));
const health = computed(() => healthWords(props.health));

const last = computed(() => {
  const found = props.health.last;
  if (found === null) return null;
  const { attempt } = found;
  return {
    when: relativeTimeWords(attempt.at, now.value),
    result: attempt.status === null ? (attempt.error ?? "No answer") : `HTTP ${attempt.status}`,
  };
});
</script>

<template>
  <li :aria-current="selected || undefined" :class="selected ? 'bg-ink/3' : ''" class="record-row">
    <span class="record-cell record-cell--primary min-w-0">
      <button
        class="flex min-w-0 flex-col gap-0.5 rounded-(--idenzy-radius-x-small) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
        @click="emit('manage')"
      >
        <span class="font-mono text-xs break-all text-ink hover:underline">{{ endpoint.url }}</span>
        <span v-if="endpoint.description" class="truncate text-[11px] leading-4 text-ink/50">
          {{ endpoint.description }}
        </span>
      </button>
    </span>

    <span class="record-cell record-cell--half flex flex-col items-start gap-1" data-label="Enabled state">
      <StatusBadge :label="state.label" :tone="state.tone" />
      <span v-if="state.detail" class="text-[11px] leading-4 text-ink/50">{{ state.detail }}</span>
    </span>

    <span class="record-cell record-cell--half flex flex-col" data-label="Delivery health">
      <span :class="health.tone === 'neutral' ? 'text-ink/55' : 'text-ink/80'" class="text-xs">
        {{ health.label }}
      </span>
    </span>

    <span class="record-cell record-cell--half flex flex-col gap-0.5" data-label="Last attempt">
      <template v-if="last">
        <span class="text-xs text-ink/80">{{ last.when }}</span>
        <span class="text-[11px] leading-4 text-ink/50">{{ last.result }}</span>
      </template>
      <span v-else class="text-xs text-ink/45">None</span>
    </span>

    <span class="record-cell record-cell--action record-cell--end flex items-center justify-end gap-1">
      <v-btn
        :loading="busy"
        class="text-xs font-medium"
        color="neutral"
        size="small"
        variant="text"
        @click="emit('manage')"
      >
        Manage
      </v-btn>
      <v-menu :offset="4" location="bottom end">
        <template #activator="{ props: activator }">
          <button
            v-bind="activator"
            :aria-label="`More for ${endpoint.url}`"
            class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
          </button>
        </template>
        <v-list density="compact" min-width="220" nav>
          <v-list-item prepend-icon="material-symbols:tune" title="Edit URL and events" @click="emit('edit')" />
          <v-list-item
            v-if="endpoint.enabled"
            prepend-icon="material-symbols:pause-circle-outline"
            subtitle="Keeps the URL, events and secret"
            title="Pause"
            @click="emit('pause')"
          />
          <v-list-item
            v-else
            prepend-icon="material-symbols:play-circle-outline"
            subtitle="Replays nothing from the pause"
            title="Resume"
            @click="emit('resume')"
          />
          <v-divider class="my-1" />
          <v-list-item
            class="webhook-row__danger"
            prepend-icon="material-symbols:link-off"
            title="Remove endpoint"
            @click="emit('remove')"
          />
        </v-list>
      </v-menu>
    </span>
  </li>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.webhook-row__danger,
.v-list--nav .v-list-item.webhook-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
