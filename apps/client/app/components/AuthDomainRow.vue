<script setup lang="ts">
/**
 * One auth domain: the hostname, where it has got to, and the two records that get it
 * there.
 *
 * The records are always visible rather than folded behind the status, because the only
 * reason to open this screen while a domain is pending is to copy them, and a fold would
 * put a click in front of the one thing the visit is for. Each carries its own status, so
 * "waiting on DNS" says which half is missing instead of leaving a customer to guess.
 *
 * A record's value is shown exactly as it arrived on the row. Nothing here builds one: a
 * computed token would be a plausible value that does not exist, pasted into DNS and
 * waited on for a check that can never pass.
 */
import {
  AUTH_DOMAIN_STATUS_LABELS,
  AUTH_DOMAIN_STATUS_TONES,
  AUTH_RECORD_INFO,
  type AuthDomain,
  RECORD_STATUS_LABELS,
  siteOf,
} from "~/utils/auth-domains";
import { formatDateTime, relativeTime } from "~/utils/time";

defineProps<{
  domain: AuthDomain;
  now: Date;
  busy: boolean;
}>();

const emit = defineEmits<{
  recheck: [];
  remove: [];
}>();

const { copy } = useClipboard();

const copied = ref("");

async function copyValue(text: string, what: string) {
  await copy(text);
  copied.value = what;
  setTimeout(() => {
    if (copied.value === what) copied.value = "";
  }, 1400);
}

const RECORD_TONE: Record<string, string> = {
  found: "bg-success",
  pending: "bg-warning",
  missing: "bg-error",
};
</script>

<template>
  <div class="flex flex-col">
    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3.5">
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="truncate font-mono text-sm text-ink">{{ domain.domain }}</span>
          <StatusBadge
            :label="AUTH_DOMAIN_STATUS_LABELS[domain.status]"
            :tone="AUTH_DOMAIN_STATUS_TONES[domain.status]"
          />
        </div>
        <p class="m-0 text-[11px] leading-4 text-ink/55">
          <template v-if="domain.status === 'verified'">
            Cookie mode works for your pages under
            <span class="font-mono text-ink/75">{{ siteOf(domain.domain) }}</span
            >. Point your SDK's API base at this host.
          </template>
          <template v-else>
            Publish both records below. Until a check sees them this host answers nothing,
            and a request to it is refused as an unknown project rather than as pending.
          </template>
        </p>
      </div>

      <div class="flex flex-none items-center gap-1">
        <v-btn
          :disabled="busy"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:refresh"
          size="small"
          variant="text"
          @click="emit('recheck')"
        >
          Check now
        </v-btn>
        <v-tooltip location="top" text="Remove this domain">
          <template #activator="{ props: tip }">
            <button
              v-bind="tip"
              :disabled="busy"
              aria-label="Remove this domain"
              class="inline-flex size-8 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/50 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40"
              type="button"
              @click="emit('remove')"
            >
              <Icon aria-hidden="true" class="text-base" name="material-symbols:delete-outline" />
            </button>
          </template>
        </v-tooltip>
      </div>
    </div>

    <ul class="m-0 list-none divide-y divide-line border-t border-line p-0">
      <li v-for="record in domain.records" :key="record.kind" class="flex flex-col gap-2 px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span class="flex items-center gap-2">
            <span
              :class="RECORD_TONE[record.status]"
              aria-hidden="true"
              class="size-1.5 flex-none rounded-full"
            />
            <span class="text-xs font-medium text-ink">
              {{ AUTH_RECORD_INFO[record.kind].label }}
            </span>
            <span
              class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/55"
            >
              {{ AUTH_RECORD_INFO[record.kind].type }}
            </span>
          </span>
          <span class="text-[11px] text-ink/55">{{ RECORD_STATUS_LABELS[record.status] }}</span>
        </div>

        <div class="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[10px] leading-4 text-ink/45">Name</span>
            <button
              class="group/n inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) text-left font-mono text-[11px] text-ink/80 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :title="`Copy ${record.name}`"
              type="button"
              @click="copyValue(record.name, `${record.kind}-name`)"
            >
              <span class="truncate">{{ record.name }}</span>
              <Icon
                :class="
                  copied === `${record.kind}-name`
                    ? 'text-success opacity-100'
                    : 'opacity-0 group-hover/n:opacity-60'
                "
                :name="
                  copied === `${record.kind}-name`
                    ? 'material-symbols:check'
                    : 'material-symbols:content-copy-outline'
                "
                aria-hidden="true"
                class="flex-none text-xs transition-opacity duration-150"
              />
            </button>
          </div>
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[10px] leading-4 text-ink/45">Points at</span>
            <button
              class="group/v inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) text-left font-mono text-[11px] text-ink/80 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :title="`Copy ${record.value}`"
              type="button"
              @click="copyValue(record.value, `${record.kind}-value`)"
            >
              <span class="truncate">{{ record.value }}</span>
              <Icon
                :class="
                  copied === `${record.kind}-value`
                    ? 'text-success opacity-100'
                    : 'opacity-0 group-hover/v:opacity-60'
                "
                :name="
                  copied === `${record.kind}-value`
                    ? 'material-symbols:check'
                    : 'material-symbols:content-copy-outline'
                "
                aria-hidden="true"
                class="flex-none text-xs transition-opacity duration-150"
              />
            </button>
          </div>
        </div>

        <p class="m-0 text-[11px] leading-4 text-ink/55">
          {{ AUTH_RECORD_INFO[record.kind].purpose }}
        </p>
      </li>
    </ul>

    <p
      v-if="domain.checkedAt"
      class="m-0 border-t border-line px-4 py-2 text-[11px] leading-4 text-ink/50"
    >
      <v-tooltip :text="formatDateTime(domain.checkedAt)" location="top">
        <template #activator="{ props: tip }">
          <span v-bind="tip">Last checked {{ relativeTime(domain.checkedAt, now) }}</span>
        </template>
      </v-tooltip>
    </p>
  </div>
</template>
