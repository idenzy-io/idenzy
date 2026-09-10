<script setup lang="ts">
/**
 * One thing that happened, written as a sentence: who, then what they did, then when.
 *
 * A sentence rather than columns because the question is "what happened here", and a
 * reader answers that by reading rather than by scanning identifiers. The actor's name
 * carries the weight, the rest of the line is ordinary text, and the identifiers a
 * machine needs are behind the row instead of in it.
 *
 * The row opens into the entry as the table holds it: the exact instant, the sequence,
 * the address, the metadata and the chain. That is where this stops being an activity
 * feed and becomes an audit record, and it is the half nobody needs until they need all
 * of it.
 *
 * What is open carries no boxes of its own. A panel of framed, tinted insets inside a row
 * that is already inside a list is three edges deep, and on the dark theme a canvas-toned
 * box cut into a surface reads as a hole. The fields are a plain definition grid on the
 * row's own ground, the JSON is the one inset and it is a step lighter rather than darker,
 * and everything is set on the panel's ordinary text size: this is the half somebody reads
 * closely, which is the worst place to save four pixels.
 *
 * `flush` drops the horizontal inset for a feed that sits directly on a page rather than
 * in a card, so the sentence lines up with the heading above it.
 */
import {
  ACTOR_ICONS,
  ACTOR_LABELS,
  type AuditEvent,
  actionInfo,
  CATEGORY_LABELS,
  FIELDS_OUTSIDE_DIGEST,
  isGenesis,
  phraseFor,
  shortHash,
} from "~/utils/audit";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

const props = withDefaults(
  defineProps<{
    event: AuditEvent;
    open: boolean;
    now: Date;
    /**
     * Whether the row below is genuinely the entry before this one. False whenever the
     * record is narrowed, and the panel then says nothing about the link rather than
     * reporting a break that is only the filter.
     */
    contiguous: boolean;
    /** No horizontal inset, for a feed drawn straight onto a page. */
    flush?: boolean;
    /**
     * Whether to offer "everything this actor did". Off where the feed is already one
     * subject's, which is a control that would ask for what is on the screen.
     */
    actorFilter?: boolean;
  }>(),
  { flush: false, actorFilter: true },
);

const emit = defineEmits<{
  toggle: [];
  /** The actor whose entries the reader wants on their own. */
  actor: [id: string];
}>();

const info = computed(() => actionInfo(props.event.action));
const phrase = computed(() => phraseFor(props.event));

const at = computed(() => new Date(props.event.createdAt));
const ago = computed(() =>
  relativeTimeWords(props.event.createdAt, props.now < at.value ? at.value : props.now),
);
const exact = computed(() => formatDateTime(props.event.createdAt));

/** The two letters on the mark. A key or a job gets a glyph instead. */
const initials = computed(() =>
  props.event.actorName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase(),
);

const isPerson = computed(
  () => props.event.actorType === "member" || props.event.actorType === "end_user",
);

const fields = computed(() => [
  { label: "Happened", value: exact.value, mono: false, outside: false },
  { label: "Sequence", value: String(props.event.seq), mono: true, outside: false },
  { label: "Action", value: props.event.action, mono: true, outside: false },
  { label: "Actor id", value: props.event.actorId ?? "None", mono: true, outside: false },
  { label: "Target id", value: props.event.target ?? "None", mono: true, outside: false },
  { label: "Entry id", value: props.event.id, mono: true, outside: false },
  { label: "IP address", value: props.event.ip ?? "None", mono: true, outside: true },
  { label: "User agent", value: props.event.ua ?? "None", mono: false, outside: true },
]);

const metadata = computed(() => JSON.stringify(props.event.metadata, null, 2));
</script>

<template>
  <div :class="open ? 'bg-ink/3' : ''" class="transition-colors duration-150">
    <button
      :aria-expanded="open"
      :class="flush ? 'px-0' : 'px-4'"
      class="flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors duration-150 hover:bg-ink/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      type="button"
      @click="emit('toggle')"
    >
      <slot name="summary">
      <span
        :class="
          event.actorType === 'staff'
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-line bg-canvas text-ink/70'
        "
        aria-hidden="true"
        class="flex size-8 flex-none items-center justify-center rounded-full border text-[11px] font-medium"
      >
        <template v-if="isPerson">{{ initials }}</template>
        <Icon v-else :name="ACTOR_ICONS[event.actorType]" class="text-base" />
      </span>

      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-xs leading-5 text-ink/70">
          <span class="font-medium text-ink">{{ event.actorName }}</span>
          {{ " " }}{{ phrase }}
        </span>
        <span class="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-ink/45">
          <span>{{ ACTOR_LABELS[event.actorType] }}</span>
          <span aria-hidden="true" class="size-0.5 flex-none rounded-full bg-ink/25" />
          <span class="truncate">{{ CATEGORY_LABELS[info.category] }}</span>
        </span>
      </span>

      <span
        v-if="info.notable"
        aria-hidden="true"
        class="hidden flex-none rounded-full border border-warning/40 bg-warning/8 px-1.5 text-[10px] leading-4 font-medium text-warning sm:inline"
      >
        Worth reading
      </span>

      <span
        :title="exact"
        class="flex-none text-[11px] leading-4 whitespace-nowrap text-ink/45 tabular-nums"
      >
        {{ ago }}
      </span>

      <Icon
        :class="open ? 'rotate-180' : ''"
        aria-hidden="true"
        class="flex-none text-sm text-ink/35 transition-transform duration-200"
        name="material-symbols:keyboard-arrow-down"
      />
      </slot>
    </button>

    <div
      v-if="open"
      :class="flush ? 'px-0' : 'px-4'"
      class="flex flex-col gap-5 border-t border-line/60 py-5"
    >
      <!-- The entry as the table holds it. Two columns of label over value, on the row's
           own ground: nothing here needs a frame to be told apart from what is beside it. -->
      <dl class="m-0 grid gap-x-10 gap-y-4 sm:grid-cols-2">
        <div v-for="field in fields" :key="field.label" class="flex min-w-0 flex-col gap-1">
          <dt class="flex items-center gap-2 text-xs text-ink/45">
            {{ field.label }}
            <!-- The two fields a lawful erasure may pseudonymise. A chain that hashed them
                 would read a compliant erasure as tampering, so they sit outside it. -->
            <v-tooltip
              v-if="field.outside"
              location="top"
              max-width="280"
              text="Held outside the entry hash, because an erasure may pseudonymise it and the chain must not read that as tampering."
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="cursor-help text-xs text-ink/35 underline decoration-dotted underline-offset-2">
                  outside the digest
                </span>
              </template>
            </v-tooltip>
          </dt>
          <dd
            :class="field.mono ? 'font-mono' : ''"
            :title="field.value"
            class="m-0 truncate text-[13px] leading-5 text-ink"
          >
            {{ field.value }}
          </dd>
        </div>
      </dl>

      <div class="flex min-w-0 flex-col gap-1.5">
        <span class="text-xs text-ink/45">Metadata</span>
        <pre
          class="m-0 overflow-x-auto rounded-(--idenzy-radius-x-small) bg-ink/4 p-3 font-mono text-[13px] leading-6 text-ink ring-1 ring-ink/6 ring-inset"
        >{{ metadata }}</pre>
      </div>

      <!-- The chain, as two lines and a sentence. The hashes are the point, so they are
           full ink in the mono face and nothing is drawn around them. -->
      <div class="flex min-w-0 flex-col gap-1.5">
        <span class="text-xs text-ink/45">Tamper evidence</span>
        <dl class="m-0 grid gap-x-10 gap-y-2 sm:grid-cols-2">
          <div class="flex min-w-0 items-center gap-2">
            <Icon
              aria-hidden="true"
              class="flex-none text-sm text-ink/40"
              name="material-symbols:link"
            />
            <dt class="flex-none text-xs text-ink/45">Links to</dt>
            <dd :title="event.prevHash" class="m-0 min-w-0 truncate font-mono text-[13px] text-ink">
              {{ isGenesis(event.prevHash) ? "genesis" : shortHash(event.prevHash) }}
            </dd>
          </div>
          <div class="flex min-w-0 items-center gap-2">
            <Icon
              aria-hidden="true"
              class="flex-none text-sm text-ink/40"
              name="material-symbols:fingerprint"
            />
            <dt class="flex-none text-xs text-ink/45">This entry</dt>
            <dd :title="event.entryHash" class="m-0 min-w-0 truncate font-mono text-[13px] text-ink">
              {{ shortHash(event.entryHash) }}
            </dd>
          </div>
        </dl>
        <p class="m-0 text-xs leading-5 text-ink/50">
          <template v-if="isGenesis(event.prevHash)">
            The first entry this project ever wrote, so it links to sixty-four zeroes.
          </template>
          <template v-else-if="contiguous">
            Links to the entry below it. Everything but
            {{ FIELDS_OUTSIDE_DIGEST.join(" and ") }} is covered.
          </template>
          <template v-else>
            The record is narrowed, so the entry below is not the entry before this one. The
            link is still there; it points at something not on screen.
          </template>
        </p>
      </div>

      <div v-if="event.actorId && actorFilter" class="flex flex-wrap items-center gap-3">
        <button
          class="inline-flex items-center gap-1 text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="emit('actor', event.actorId)"
        >
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:filter-alt-outline" />
          Everything {{ event.actorName }} did
        </button>
        <span class="text-xs text-ink/40">{{ ACTOR_LABELS[event.actorType] }}</span>
      </div>
    </div>
  </div>
</template>
