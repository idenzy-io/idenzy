<script setup lang="ts">
/**
 * One key on `RecordTable`: what kind it is and what part it plays, the prefix it is matched
 * by, who made it, and what was last observed of it.
 *
 * The first cell is the way into the key's detail, as a person's name is on the users list.
 * Below 900px the kind, the prefix and the observation share the top of the row, which is
 * the note's mobile arrangement: the three things a reader matches a key by, together.
 *
 * In a list of both kinds (`mixed`, the All keys tab) a live secret key wears its own colour,
 * `chart-6`, so the two kinds read apart at a glance. A kind tab leaves it plain, because every
 * row there is the same kind and a colour would only be decoration.
 *
 * The observation is written as what was seen over a window and never as a verdict. A key
 * silent for a day can still belong to a weekly job (notes/keys.md P1), so the cell says "No
 * observed use in 24 hours" and the absolute time sits under it.
 */
import {
  isLive,
  KEY_KIND_ICONS,
  KEY_KIND_LABELS,
  maskedKey,
  observationOf,
  observationWords,
  type ProjectApiKey,
  type Rotation,
  SCOPES,
} from "~/utils/keys";
import { formatDate, formatDateTime, relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  keyRow: ProjectApiKey;
  /** Which half of an unfinished rotation this key is, if either. */
  role: { role: "old" | "replacement"; rotation: Rotation } | null;
  /** The row sits in a list of both kinds, so a secret key is set apart by colour. */
  mixed?: boolean;
}>();

const emit = defineEmits<{
  view: [];
  rotate: [];
  "copy-prefix": [];
  "copy-id": [];
  revoke: [];
  compromised: [];
}>();

const now = useNow({ interval: 30_000 });

const live = computed(() => isLive(props.keyRow));
const observed = computed(() => observationOf(props.keyRow, now.value));

/* Written out whole so Tailwind's scan finds the classes. A revoked key keeps the dashed,
   colourless mark whatever its kind: what it was matters less than that it is gone. */
const secretTone = computed(
  () => props.mixed === true && live.value && props.keyRow.kind === "secret",
);

const tileClass = computed(() => {
  if (!live.value) return "border border-dashed border-line text-ink/35";
  if (props.keyRow.kind === "publishable") return "bg-primary/10 text-primary";
  return secretTone.value
    ? "bg-[rgba(var(--v-theme-chart-6),0.14)] text-[rgb(var(--v-theme-chart-6))]"
    : "bg-ink/8 text-ink";
});

const labelClass = computed(() => {
  if (!live.value) return "text-ink/60";
  return secretTone.value ? "text-[rgb(var(--v-theme-chart-6))]" : "text-ink";
});

/** The line under the kind: the part the key plays, or what it may do. */
const part = computed(() => {
  const { keyRow, role } = props;
  if (keyRow.revokedAt !== null) return `Revoked ${formatDate(keyRow.revokedAt)}`;
  if (role?.role === "old") return `Being replaced by ${role.rotation.replacement.prefix}…`;
  if (role?.role === "replacement") return `Replacement for ${role.rotation.old.prefix}…`;
  return keyRow.kind === "secret" ? SCOPES.label : "Names the project";
});
</script>

<template>
  <li class="record-row">
    <span class="record-cell record-cell--primary min-w-0">
      <button
        :aria-label="`View ${KEY_KIND_LABELS[keyRow.kind]} ${keyRow.prefix}`"
        class="group flex min-w-0 items-center gap-3 rounded-(--idenzy-radius-x-small) text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
        @click="emit('view')"
      >
        <span
          :class="tileClass"
          aria-hidden="true"
          class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
        >
          <Icon :name="KEY_KIND_ICONS[keyRow.kind]" class="text-base" />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span
            :class="labelClass"
            class="truncate text-xs font-medium underline-offset-2 group-hover:underline"
          >
            {{ KEY_KIND_LABELS[keyRow.kind] }}
          </span>
          <span
            :class="role?.role === 'replacement' && !role.rotation.replacementObserved ? 'text-warning' : 'text-ink/50'"
            class="truncate text-[11px] leading-4"
          >
            {{ part }}
          </span>
        </span>
      </button>
    </span>

    <span class="record-cell record-cell--half flex flex-col" data-label="Prefix">
      <span class="truncate font-mono text-[11px] text-ink/80">{{ maskedKey(keyRow) }}</span>
    </span>

    <!-- After the observation when stacked, so a phone reads the kind, the prefix and the
         last observed use together (notes/keys.md, mobile arrangement). -->
    <span
      class="record-cell record-cell--half flex flex-col gap-0.5 max-[900px]:order-1"
      data-label="Created by"
    >
      <span :class="keyRow.createdBy ? 'text-ink/80' : 'text-ink/45'" class="truncate text-xs">
        {{ keyRow.createdBy ?? "Not recorded" }}
      </span>
      <span class="text-[11px] leading-4 text-ink/45">{{ formatDate(keyRow.createdAt) }}</span>
    </span>

    <span class="record-cell record-cell--half flex flex-col gap-0.5" data-label="Last observed use">
      <span
        :class="observed === 'recent' ? 'text-ink/80' : 'text-ink/55'"
        class="text-xs"
      >
        {{ observationWords(keyRow, now) }}
      </span>
      <v-tooltip
        v-if="keyRow.lastUsedAt && observed === 'quiet'"
        :text="formatDateTime(keyRow.lastUsedAt)"
        location="top"
      >
        <template #activator="{ props: tip }">
          <span v-bind="tip" class="w-fit text-[11px] leading-4 text-ink/45">
            Last {{ relativeTimeWords(keyRow.lastUsedAt, now) }}
          </span>
        </template>
      </v-tooltip>
    </span>

    <span class="record-cell record-cell--action flex justify-end">
      <KeyRowActions
        :key-row="keyRow"
        :rotating="role !== null"
        @compromised="emit('compromised')"
        @copy-id="emit('copy-id')"
        @copy-prefix="emit('copy-prefix')"
        @revoke="emit('revoke')"
        @rotate="emit('rotate')"
        @view="emit('view')"
      />
    </span>
  </li>
</template>
