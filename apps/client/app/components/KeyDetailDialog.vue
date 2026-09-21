<script setup lang="ts">
/**
 * One key in full: what was observed of it, who made it, the rotation it is part of, where a
 * key of its kind goes, and what can be done to it. Opened from the key's name and from View
 * observed use, and a full-height sheet below `lg`, which is the note's mobile "open detail
 * for placement and rotation".
 *
 * The observation is the reason it exists, and it is stated with its limit rather than as a
 * verdict (notes/keys.md P1). Revoke and Rotate close this before the next dialog opens, so
 * nobody is two overlays deep wondering which Cancel they are pressing.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  isLive,
  KEY_KIND_LABELS,
  maskedKey,
  OBSERVATION_LIMIT,
  observationWords,
  type ProjectApiKey,
  type Rotation,
  SCOPES,
} from "~/utils/keys";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  keyRow: ProjectApiKey;
  role: { role: "old" | "replacement"; rotation: Rotation } | null;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  rotate: [];
  revoke: [];
}>();

const { lgAndUp } = useDisplay();
const now = useNow({ interval: 30_000 });
const titleId = `${useId()}-title`;

const live = computed(() => isLive(props.keyRow));

const badge = computed<{ label: string; tone: BadgeTone }>(() => {
  if (!live.value) return { label: "Revoked", tone: "neutral" };
  if (props.role?.role === "old") return { label: "Being replaced", tone: "warning" };
  if (props.role?.role === "replacement") return { label: "Replacement", tone: "neutral" };
  return { label: "Live", tone: "success" };
});

const facts = computed(() => {
  const { keyRow, role } = props;
  const rows = [
    {
      label: "Last observed use",
      value: keyRow.lastUsedAt
        ? `${observationWords(keyRow, now.value)} · ${formatDateTime(keyRow.lastUsedAt)}`
        : "Not observed since it was made",
      note: OBSERVATION_LIMIT,
    },
    {
      label: "Made",
      value: `${formatDateTime(keyRow.createdAt)}${keyRow.createdBy ? ` by ${keyRow.createdBy}` : ""}`,
      note: keyRow.createdBy
        ? ""
        : "Who made it is not recorded: the entry is older than the audit trail keeps.",
    },
    {
      label: "Access",
      value: keyRow.kind === "secret" ? SCOPES.label : "Names the project",
      note:
        keyRow.kind === "secret"
          ? SCOPES.note
          : "It cannot read a user, change a setting or mint a token.",
    },
  ];
  if (keyRow.revokedAt) {
    rows.push({ label: "Revoked", value: formatDateTime(keyRow.revokedAt), note: "" });
  }
  if (role) {
    const other = role.role === "old" ? role.rotation.replacement : role.rotation.old;
    rows.push({
      label: "Rotation",
      value:
        role.role === "old" ? `Being replaced by ${other.prefix}…` : `Replaces ${other.prefix}…`,
      note:
        role.role === "replacement" && !role.rotation.replacementObserved
          ? "Not observed yet, so nothing is known to be deployed with it."
          : "",
    });
  }
  return rows;
});
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 640 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
  >
    <v-card border flat>
      <div :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'" class="flex flex-col">
        <header class="flex flex-none items-start justify-between gap-4 border-b border-line p-5">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
              {{ KEY_KIND_LABELS[keyRow.kind] }}
            </h2>
            <span class="truncate font-mono text-xs text-ink/70">{{ maskedKey(keyRow) }}</span>
          </div>
          <StatusBadge :label="badge.label" :tone="badge.tone" />
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          <dl class="m-0 flex flex-col divide-y divide-line">
            <div
              v-for="fact in facts"
              :key="fact.label"
              class="grid gap-x-6 gap-y-1 py-3 first:pt-0 sm:grid-cols-[9rem_minmax(0,1fr)]"
            >
              <dt class="text-xs text-ink/55">{{ fact.label }}</dt>
              <dd class="m-0 flex flex-col gap-0.5">
                <span class="text-xs text-ink">{{ fact.value }}</span>
                <span v-if="fact.note" class="text-[11px] leading-4 text-ink/50">{{ fact.note }}</span>
              </dd>
            </div>
          </dl>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-1">
              <span class="text-[11px] leading-4 text-ink/55">Prefix, as a log names it</span>
              <CopyField :label="`Copy ${keyRow.prefix}`" :value="keyRow.prefix" dense />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-[11px] leading-4 text-ink/55">Key ID, as the audit trail names it</span>
              <CopyField :value="keyRow.id" dense label="Copy the key ID" />
            </div>
          </div>

          <section v-if="live" class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Where it goes</h3>
            <KeyPlacement :kind="keyRow.kind" :prefix="keyRow.prefix" />
          </section>
        </div>

        <footer class="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line p-4">
          <v-btn
            v-if="live"
            class="mr-auto text-xs font-medium"
            color="error"
            size="small"
            variant="text"
            @click="emit('revoke')"
          >
            Revoke
          </v-btn>
          <v-btn
            v-if="live"
            :disabled="role !== null"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:swap-horiz"
            size="small"
            variant="text"
            @click="emit('rotate')"
          >
            Rotate
          </v-btn>
          <v-btn
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="open = false"
          >
            Close
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
