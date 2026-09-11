<script setup lang="ts">
/**
 * One sending domain in the list: the name, where its DNS stands, whether it is the
 * sender, when it was last looked at, and the way in.
 *
 * Verification and sending are two columns and never one badge. A provider will call an
 * identity verified while the bounce route is missing, and a verified domain that is not
 * the sender is a finished setup rather than a working one; collapsing either pair is how
 * a reader comes to believe their mail already carries their own name.
 *
 * The shared domain is a row like the others, so somebody who has never added a domain
 * can still see what they send from. It carries no destructive action: it cannot be
 * removed, and it is what every project falls back to.
 *
 * A row on `RecordTable`, so the track widths live in the table's own columns and the
 * stacked arrangement below 900px comes from `data-label` rather than from a second grid
 * kept in step by hand. The list and the record table in the setup dialog are then the
 * same table.
 */
import {
  recordProgress,
  type SendingDomain,
  sendingState,
  verificationState,
} from "~/utils/sending-domains";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  domain: SendingDomain;
  busy: boolean;
}>();

const emit = defineEmits<{
  open: [];
  remove: [];
}>();

const now = useNow({ interval: 30_000 });

const verification = computed(() => verificationState(props.domain));
const sending = computed(() => sendingState(props.domain));
const progress = computed(() => recordProgress(props.domain));

/** Set up or Manage: one control saying which of the two things it is for. */
const openLabel = computed(() => (sending.value.label === "Cannot send yet" ? "Set up" : "Manage"));

const checkedAgo = computed(() => {
  const at = props.domain.checkedAt;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary flex min-w-0 items-center gap-3">
      <span
        :class="
          domain.inUse
            ? 'border-primary/40 bg-primary/8 text-primary'
            : 'border-line bg-ink/4 text-ink/70'
        "
        class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border"
      >
        <Icon
          :name="domain.shared ? 'material-symbols:cloud-outline' : 'material-symbols:language'"
          aria-hidden="true"
          class="text-sm"
        />
      </span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="font-mono text-xs break-all text-ink">{{ domain.domain }}</span>
        <span class="text-[11px] leading-4 break-words text-ink/50">
          {{ domain.shared ? "Ours, and always here" : domain.mailFrom }}
        </span>
      </span>
    </span>

    <span
      class="record-cell record-cell--half flex flex-col items-start gap-1"
      data-label="Verification"
    >
      <StatusBadge :label="verification.label" :tone="verification.tone" />
      <span v-if="!domain.shared" class="text-[10px] leading-4 text-ink/45">
        <span class="font-mono tabular-nums">{{ progress.found }}/{{ progress.required }}</span>
        records
      </span>
    </span>

    <span class="record-cell record-cell--half flex flex-col items-start" data-label="Sending">
      <StatusBadge :label="sending.label" :tone="sending.tone" />
    </span>

    <span class="record-cell record-cell--half text-[11px] text-ink/60" data-label="Last check">
      <template v-if="domain.shared">Ours to keep</template>
      <template v-else-if="checkedAgo">{{ checkedAgo }}</template>
      <template v-else>Not yet</template>
    </span>

    <span
      class="record-cell record-cell--action record-cell--end flex flex-none items-center justify-end gap-1"
    >
      <template v-if="!domain.shared">
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
              class="sending-domain-row__danger"
              prepend-icon="material-symbols:link-off"
              title="Remove from project"
              @click="emit('remove')"
            />
          </v-list>
        </v-menu>
      </template>
    </span>
  </li>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.sending-domain-row__danger,
.v-list--nav .v-list-item.sending-domain-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
