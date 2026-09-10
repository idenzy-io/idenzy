<script setup lang="ts">
/**
 * One sending domain in the list: the name, where its verification stands, and what can
 * be done with it.
 *
 * The row says found-of-required rather than a status word alone, because those are two
 * different facts and a provider will call an identity verified while the bounce route
 * is still missing. The shared domain is a row like the others so a reader can see what
 * they are sending from without knowing whether they ever added one, and it carries no
 * actions at all: it cannot be removed, and it is already what a project falls back to.
 */
import {
  DOMAIN_STATUS_LABELS,
  isReadyToSend,
  recordProgress,
  type SendingDomain,
} from "~/utils/sending-domains";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  domain: SendingDomain;
  busy: boolean;
}>();

const emit = defineEmits<{
  records: [];
  use: [];
  remove: [];
}>();

const now = useNow({ interval: 30_000 });

const progress = computed(() => recordProgress(props.domain));
const ready = computed(() => isReadyToSend(props.domain));

const tone = computed(() => {
  if (props.domain.status === "failed") return "error" as const;
  return ready.value ? ("success" as const) : ("warning" as const);
});

const checkedAgo = computed(() => {
  const at = props.domain.checkedAt;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
    <span
      :class="domain.inUse ? 'border-primary/40 bg-primary/8 text-primary' : 'border-line bg-canvas text-ink/70'"
      class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border"
    >
      <Icon
        :name="domain.shared ? 'material-symbols:cloud-outline' : 'material-symbols:language'"
        aria-hidden="true"
        class="text-lg"
      />
    </span>

    <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="truncate font-mono text-sm text-ink">{{ domain.domain }}</span>
        <span
          v-if="domain.inUse"
          class="rounded-full border border-primary/40 bg-primary/8 px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-primary"
        >
          Sending from this
        </span>
        <StatusBadge
          v-if="domain.shared"
          label="Ours"
          tone="neutral"
        />
        <StatusBadge v-else :label="DOMAIN_STATUS_LABELS[domain.status]" :tone="tone" />
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
        <template v-if="domain.shared">
          <span class="flex items-center gap-1.5">
            <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:verified-user-outline" />
            SPF, DKIM and DMARC are ours and already published
          </span>
          <span class="flex items-center gap-1.5">
            <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:groups-outline" />
            Reputation shared with every project on it
          </span>
        </template>
        <template v-else>
          <span class="flex items-center gap-1.5">
            <Icon
              :class="ready ? 'text-success' : ''"
              :name="ready ? 'material-symbols:check-circle-outline' : 'material-symbols:pending-outline'"
              aria-hidden="true"
              class="flex-none text-xs"
            />
            <span class="font-mono tabular-nums">{{ progress.found }}/{{ progress.required }}</span>
            records found
          </span>
          <span class="flex min-w-0 items-center gap-1.5">
            <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:u-turn-left" />
            <span class="truncate font-mono">{{ domain.mailFrom }}</span>
          </span>
          <span v-if="checkedAgo" class="flex items-center gap-1.5">
            <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:schedule-outline" />
            Checked {{ checkedAgo }}
          </span>
        </template>
      </div>
    </div>

    <div class="ml-auto flex flex-none items-center gap-2">
      <v-btn
        v-if="!domain.shared && !ready"
        :loading="busy"
        class="text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:dns-outline"
        size="small"
        variant="outlined"
        @click="emit('records')"
      >
        Records
      </v-btn>

      <v-btn
        v-if="!domain.inUse && ready"
        :loading="busy"
        class="text-xs font-medium"
        color="primary"
        size="small"
        variant="tonal"
        @click="emit('use')"
      >
        Send from this
      </v-btn>

      <v-menu v-if="!domain.shared" :offset="4" location="bottom end">
        <template #activator="{ props: activator }">
          <button
            v-bind="activator"
            :aria-label="`Actions for ${domain.domain}`"
            class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
          </button>
        </template>

        <v-list density="compact" min-width="220" nav>
          <v-list-item
            prepend-icon="material-symbols:dns-outline"
            title="DNS records"
            @click="emit('records')"
          />
          <v-divider class="my-1" />
          <v-list-item
            class="sending-domain-row__danger"
            prepend-icon="material-symbols:link-off"
            title="Remove from project"
            @click="emit('remove')"
          />
        </v-list>
      </v-menu>
    </div>
  </div>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.sending-domain-row__danger,
.v-list--nav .v-list-item.sending-domain-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
