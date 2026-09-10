<script setup lang="ts">
/**
 * The DNS a domain needs, as a console asks for it: a name, a type and a value, each
 * copyable on its own, because a record pasted with a stray space fails a check that
 * gives no reason.
 *
 * Grouped by what the records are for rather than listed flat. The three DKIM entries
 * are one decision and one explanation, and a list of six rows with six notes reads as
 * six problems. What is required and what is advice are told apart on the group, since
 * DMARC is the one nobody has to add and the one most worth adding.
 *
 * Nothing here is editable. The values come from the provider with the identity, and a
 * field the reader could change would be a field they could break.
 */
import {
  isReadyToSend,
  RECORD_KINDS,
  RECORD_STATUS_LABELS,
  recordProgress,
  type SendingDomain,
} from "~/utils/sending-domains";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  domain: SendingDomain | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  check: [];
}>();

const now = useNow({ interval: 30_000 });

/** The kinds this domain actually carries, in the order the records were handed over. */
const groups = computed(() => {
  const domain = props.domain;
  if (domain === null) return [];
  return RECORD_KINDS.map((kind) => ({
    kind,
    records: domain.records.filter((record) => record.kind === kind.id),
  })).filter((group) => group.records.length > 0);
});

const progress = computed(() =>
  props.domain === null ? { found: 0, required: 0 } : recordProgress(props.domain),
);
const ready = computed(() => props.domain !== null && isReadyToSend(props.domain));

const checkedAgo = computed(() => {
  const at = props.domain?.checkedAt ?? null;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

const STATUS_LOOK: Record<string, { icon: string; tone: string }> = {
  found: { icon: "material-symbols:check-circle-outline", tone: "text-success" },
  missing: { icon: "material-symbols:error-outline", tone: "text-warning" },
  pending: { icon: "material-symbols:pending-outline", tone: "text-ink/40" },
};
</script>

<template>
  <v-dialog v-model="open" max-width="640" scrollable>
    <v-card v-if="domain" border flat>
      <header class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="m-0 truncate font-mono text-sm text-ink">{{ domain.domain }}</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Add these at your DNS provider. We look for them every few minutes, and a
            change can take a day to reach us however fast your console says it saved.
          </p>
        </div>
        <StatusBadge
          :detail="`${progress.found}/${progress.required}`"
          :label="ready ? 'Verified' : 'Waiting on DNS'"
          :tone="ready ? 'success' : 'warning'"
        />
      </header>

      <div class="flex flex-col gap-6 overflow-y-auto px-5 py-5">
        <section v-for="group in groups" :key="group.kind.id" class="flex flex-col gap-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <Icon :name="group.kind.icon" aria-hidden="true" class="flex-none text-base text-ink/70" />
            <h3 class="m-0 text-xs font-medium text-ink">{{ group.kind.label }}</h3>
            <span
              :class="
                group.kind.required
                  ? 'border-line text-ink/55'
                  : 'border-primary/40 bg-primary/8 text-primary'
              "
              class="rounded-full border px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap"
            >
              {{ group.kind.required ? "Required" : "Recommended" }}
            </span>
          </div>
          <p class="m-0 text-[11px] leading-4 text-ink/55">{{ group.kind.note }}</p>

          <div
            v-for="record in group.records"
            :key="record.id"
            class="flex flex-col gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-2 text-[11px] font-medium text-ink/70">
                <span class="rounded border border-line px-1.5 font-mono text-[10px] leading-4">
                  {{ record.type }}
                </span>
                <span v-if="record.priority !== undefined" class="text-ink/55">
                  Priority <span class="font-mono tabular-nums">{{ record.priority }}</span>
                </span>
              </span>
              <span
                :class="STATUS_LOOK[record.status]?.tone"
                class="flex items-center gap-1.5 text-[11px]"
              >
                <Icon
                  :name="STATUS_LOOK[record.status]?.icon ?? 'material-symbols:pending-outline'"
                  aria-hidden="true"
                  class="flex-none text-sm"
                />
                {{ RECORD_STATUS_LABELS[record.status] }}
              </span>
            </div>

            <div class="grid gap-2 sm:grid-cols-[3.25rem_minmax(0,1fr)] sm:items-center">
              <span class="text-[11px] text-ink/55">Name</span>
              <CopyField :label="`Copy the name for ${record.host}`" :value="record.host" dense />
              <span class="text-[11px] text-ink/55">Value</span>
              <CopyField :label="`Copy the value for ${record.host}`" :value="record.value" dense />
            </div>
          </div>
        </section>
      </div>

      <footer class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-3">
        <p class="m-0 text-[11px] text-ink/50">
          <template v-if="checkedAgo">Last checked {{ checkedAgo }}.</template>
          <template v-else>Not checked yet.</template>
        </p>
        <div class="flex items-center gap-2">
          <v-btn
            :loading="busy"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:refresh"
            size="small"
            variant="outlined"
            @click="emit('check')"
          >
            Check now
          </v-btn>
          <v-btn
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="open = false"
          >
            Done
          </v-btn>
        </div>
      </footer>
    </v-card>
  </v-dialog>
</template>
