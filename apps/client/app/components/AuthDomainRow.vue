<script setup lang="ts">
/**
 * One auth domain in the list: the hostname, the two things that have to be true about
 * it, when they were last looked at, and the way in.
 *
 * DNS and the certificate are two columns and never one status. They fail separately and
 * they are fixed by two different records, so a row that collapsed them would leave a
 * customer with "waiting on DNS" and no way to tell which half is missing. The records
 * themselves are in the setup dialog, which is where somebody working with a DNS console
 * open actually reads them.
 *
 * A row on `RecordTable`, so the track widths live in the table's own columns and the
 * stacked arrangement below 900px comes from `data-label` rather than a second grid kept
 * in step by hand.
 */
import {
  AUTH_DOMAIN_STATUS_LABELS,
  AUTH_DOMAIN_STATUS_TONES,
  type AuthDomain,
  certificateIssued,
  dnsFound,
} from "~/utils/auth-domains";
import { relativeTime } from "~/utils/time";

const props = defineProps<{
  domain: AuthDomain;
  now: Date;
  busy: boolean;
}>();

const emit = defineEmits<{
  open: [];
  remove: [];
}>();

const resolves = computed(() => dnsFound(props.domain));
const certificate = computed(() => certificateIssued(props.domain));

/** Set up while something is missing, Manage once nothing is: one control, two jobs. */
const openLabel = computed(() =>
  resolves.value && certificate.value && props.domain.status === "verified" ? "Manage" : "Set up",
);
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary flex min-w-0 items-center gap-3">
      <span
        :class="
          domain.status === 'verified'
            ? 'border-primary/40 bg-primary/8 text-primary'
            : 'border-line bg-ink/4 text-ink/70'
        "
        class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border"
      >
        <Icon aria-hidden="true" class="text-sm" name="material-symbols:language" />
      </span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="font-mono text-xs break-all text-ink">{{ domain.domain }}</span>
        <span class="text-[11px] leading-4 break-words text-ink/50">
          <template v-if="domain.status === 'verified'">Answering for this project</template>
          <template v-else>
            Refused as an unknown project until both records are found
          </template>
        </span>
      </span>
    </span>

    <span class="record-cell record-cell--half flex flex-col items-start gap-1" data-label="DNS">
      <StatusBadge
        :label="resolves ? 'Found' : 'Not found'"
        :tone="resolves ? 'success' : 'warning'"
      />
      <span class="text-[10px] leading-4 text-ink/45">CNAME</span>
    </span>

    <span
      class="record-cell record-cell--half flex flex-col items-start gap-1"
      data-label="Certificate"
    >
      <StatusBadge
        :label="certificate ? 'Issued' : 'Waiting'"
        :tone="certificate ? 'success' : 'warning'"
      />
      <span class="text-[10px] leading-4 text-ink/45">
        {{ AUTH_DOMAIN_STATUS_LABELS[domain.status] }}
      </span>
    </span>

    <span class="record-cell record-cell--half text-[11px] text-ink/60" data-label="Last checked">
      <template v-if="domain.checkedAt">{{ relativeTime(domain.checkedAt, now) }}</template>
      <template v-else>Not yet</template>
    </span>

    <span
      class="record-cell record-cell--action record-cell--end flex flex-none items-center justify-end gap-1"
    >
      <v-btn
        :loading="busy"
        class="text-xs font-medium text-ink/70"
        color="neutral"
        size="small"
        variant="text"
        @click="emit('open')"
      >
        {{ openLabel }}
      </v-btn>

      <v-menu :offset="4" location="bottom end">
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
            @click="emit('open')"
          />
          <v-divider class="my-1" />
          <v-list-item
            class="auth-domain-row__danger"
            prepend-icon="material-symbols:delete-outline"
            title="Remove domain"
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
.v-list--nav .v-list-item.auth-domain-row__danger,
.v-list--nav .v-list-item.auth-domain-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
