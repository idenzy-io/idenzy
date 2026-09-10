<script setup lang="ts">
/**
 * What the audit trail holds about one account, newest first.
 *
 * The trail's own screen is the record; this is the part of it that names this person,
 * which is the difference between an investigation and a search. Both directions are
 * shown, what was done to them and what they did, because a suspension by an operator and
 * a sign-in from a new country are the same story read from two ends.
 *
 * The rows are the trail's own, so an entry opened here shows the same instant, sequence
 * and chain link it shows there. Drawn flush and parted by hairlines rather than boxed:
 * the section heading above already says what this is. `contiguous` is false throughout,
 * because this is a narrowing of the chain and the entry above another here is not the one
 * before it, so the rows say nothing about the link rather than reporting a break that is
 * only the filter.
 */
import {
  ACTOR_LABELS,
  type AuditEvent,
  actionInfo,
  CATEGORY_LABELS,
  CATEGORY_SLOTS,
  phraseFor,
} from "~/utils/audit";
import { applyDirection, cycleSort, directionOf, type TableSort } from "~/utils/table-sort";
import { formatDateTime, relativeTime } from "~/utils/time";

const props = withDefaults(
  defineProps<{
    events: readonly AuditEvent[];
    now: Date;
    /** Initial row count; older entries remain available through Show more. */
    limit?: number;
  }>(),
  { limit: 8 },
);

const openId = ref<string | null>(null);

const expanded = ref(false);
const query = ref("");

/* `clearable` hands back null, which the filter reads as nothing typed. */
const search = computed({
  get: () => query.value,
  set: (value: string | null) => {
    query.value = value ?? "";
  },
});
/** Newest first, which is the order the trail arrives in and what null means. */
const DEFAULT_SORT: TableSort = { key: "timestamp", direction: "desc" };

const COLUMNS: readonly { key: string; label: string }[] = [
  { key: "timestamp", label: "Timestamp" },
  { key: "event", label: "Event" },
  { key: "actor", label: "Actor" },
  { key: "category", label: "Category" },
];

const COMPARE: Record<string, (a: AuditEvent, b: AuditEvent) => number> = {
  timestamp: (a, b) => a.createdAt.localeCompare(b.createdAt),
  event: (a, b) => a.action.localeCompare(b.action),
  actor: (a, b) => a.actorName.localeCompare(b.actorName),
  category: (a, b) =>
    CATEGORY_LABELS[actionInfo(a.action).category].localeCompare(
      CATEGORY_LABELS[actionInfo(b.action).category],
    ),
};

const sort = ref<TableSort | null>(DEFAULT_SORT);

const active = computed(() => sort.value ?? DEFAULT_SORT);

const ordered = computed(() => {
  const compare = COMPARE[active.value.key] ?? COMPARE.timestamp;
  return [...props.events]
    .filter((event) =>
      [
        event.action,
        event.actorName,
        event.actorId,
        event.target,
        event.id,
        event.ip,
        phraseFor(event),
        CATEGORY_LABELS[actionInfo(event.action).category],
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.value.trim().toLowerCase()),
    )
    .sort((a, b) => applyDirection(compare?.(a, b) ?? 0, active.value.direction));
});
/**
 * The dot before an action, in the colour its category wears in the tag two columns
 * along, so a reader scanning the left of the table is reading the same grouping the
 * right of it names. Notability is not in here: "worth reading" is a judgement and the
 * phrase under the action says it in words and in the warning colour, which is a scale
 * this one must not borrow from.
 */
function dotColour(event: AuditEvent): string {
  return `rgb(var(--v-theme-${CATEGORY_SLOTS[actionInfo(event.action).category]}))`;
}

const shown = computed(() =>
  expanded.value ? ordered.value : ordered.value.slice(0, props.limit),
);
const rest = computed(() => Math.max(0, ordered.value.length - shown.value.length));
watch(
  () => props.events,
  () => {
    expanded.value = false;
    openId.value = null;
  },
);

function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}

function timestamp(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
</script>

<template>
  <div v-if="events.length > 0">
    <!-- What reads the trail sits above it rather than on it: a control drawn inside the
         frame reads as part of the record, and this is the reader's own. Ranged right so
         the eye lands on the table's left edge and not on a search box. -->
    <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
      <span class="activity-feed__count" role="status">{{ ordered.length }} {{ ordered.length === 1 ? 'event' : 'events' }}</span>
      <v-text-field
        v-model="search"
        aria-label="Search account activity"
        class="activity-feed__search w-full grow-0 sm:w-72"
        clearable
        density="comfortable"
        hide-details
        placeholder="Search events, actors or IP addresses"
        prepend-inner-icon="material-symbols:search"
        rounded="pill"
        variant="outlined"
      />
    </div>

    <div class="activity-feed">
      <div class="activity-feed__columns">
        <span aria-hidden="true"></span>
        <span v-for="column in COLUMNS" :key="column.key">
          <SortHeader
            :direction="directionOf(sort, column.key)"
            :label="column.label"
            @toggle="sort = cycleSort(sort, column.key)"
          />
          <span v-if="column.key === 'timestamp'" class="text-ink/40"> · local</span>
        </span>
      </div>
      <ol class="activity-feed__list" aria-label="Account activity logs">
        <li v-for="event in shown" :key="event.id" class="activity-feed__entry">
        <AuditEntryRow
          :contiguous="false"
          :event="event"
          :now="now"
          :actor-filter="false"
          :open="openId === event.id"
          flush
          @toggle="toggle(event.id)"
        >
          <template #summary>
            <Icon class="activity-feed__chevron" :class="openId === event.id ? 'rotate-90' : ''" name="material-symbols:chevron-right" aria-hidden="true" />
            <span class="activity-feed__timestamp">
              <time :datetime="event.createdAt" :title="formatDateTime(event.createdAt)">{{ timestamp(event.createdAt) }}</time>
              <span>{{ relativeTime(event.createdAt, now < new Date(event.createdAt) ? new Date(event.createdAt) : now) }}</span>
            </span>
            <span class="activity-feed__event">
              <span class="activity-feed__action"><span :style="{ background: dotColour(event) }" class="activity-feed__dot" aria-hidden="true" />{{ event.action }}</span>
              <span class="activity-feed__phrase">{{ phraseFor(event) }}<span v-if="actionInfo(event.action).notable" class="text-warning"> · Worth reading</span></span>
            </span>
            <span class="activity-feed__actor"><span>{{ event.actorName }}</span><span>{{ ACTOR_LABELS[event.actorType] }}</span></span>
            <span class="activity-feed__category"><CategoryTag :category="actionInfo(event.action).category" /></span>
          </template>
        </AuditEntryRow>
        </li>
      </ol>
      <div v-if="shown.length === 0" class="flex flex-col items-center gap-1 px-4 py-14 text-center">
        <Icon aria-hidden="true" class="mb-1 text-2xl text-ink/25" name="material-symbols:search-off" />
        <p class="m-0 text-sm font-medium text-ink">No events match “{{ query }}”</p>
        <p class="m-0 max-w-md text-xs leading-5 text-ink/55">Every entry naming this account is still here; the search is what is hiding them.</p>
        <button class="mt-2 text-xs text-primary underline" type="button" @click="query = ''">Clear search</button>
      </div>
      <button v-if="rest > 0" class="activity-feed__more" type="button" @click="expanded = true">Show {{ rest }} older {{ rest === 1 ? 'entry' : 'entries' }}<Icon name="material-symbols:expand-more" aria-hidden="true" /></button>
    </div>
  </div>

  <!-- Nothing here yet, in the shape every other empty list on the panel takes: a mark,
       what is missing, and why it may be missing rather than absent. -->
  <div v-else class="flex flex-col items-center gap-1 px-4 py-14 text-center">
    <Icon aria-hidden="true" class="mb-1 text-2xl text-ink/25" name="material-symbols:history" />
    <p class="m-0 text-sm font-medium text-ink">Nothing in the trail names this account</p>
    <p class="m-0 max-w-md text-xs leading-5 text-ink/55">
      Entries arrive seconds after the event, so something that has just happened may not be
      here yet.
    </p>
  </div>
</template>

<style scoped>
/* No ground of its own: the frame is a rule around the panel's own surface, so the trail
   reads as part of the page rather than as a card sitting on it. */
.activity-feed { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 6px; overflow: hidden; }
.activity-feed__count { font-size: 11px; color: rgba(var(--v-theme-on-surface), .5); white-space: nowrap; }
/* Filled at a twentieth of the ink so the pill reads on a ground it shares with the page,
   which is white on the dark theme and black on the light one. Sized like the search on
   every other screen: 12px text in a 32px field. */
.activity-feed__search :deep(.v-field) { background: rgba(var(--v-theme-on-surface), .05); }
.activity-feed__search :deep(.v-field__input), .activity-feed__search :deep(.v-field__input::placeholder) { font-size: .75rem; min-height: 32px; }
.activity-feed__search :deep(.v-field__prepend-inner > .v-icon), .activity-feed__search :deep(.v-field__clearable > .v-icon) { font-size: 1rem; }
.activity-feed__columns, .activity-feed__entry :deep(button[aria-expanded]) { display: grid; grid-template-columns: 16px 190px minmax(0, 1fr) 180px 110px; gap: 12px; align-items: center; padding: 12px 14px; }
.activity-feed__columns { padding-block: 9px; background: rgba(var(--v-theme-on-surface), .025); font-size: 11px; color: rgba(var(--v-theme-on-surface), .55); }
.activity-feed__list { list-style: none; padding: 0; margin: 0; }
.activity-feed__entry { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
/* An open row is one wash of ink over both halves, the row and what it opens, so the two
   read as one block. Ink rather than a tint, which is white on the dark theme and black on
   the light one and needs no second colour. Three percent: it has to part the open row
   from the closed ones without lifting a block twenty lines tall off the page. */
.activity-feed__entry :deep(button[aria-expanded='true']), .activity-feed__entry :deep(button[aria-expanded] + div) { background: rgba(var(--v-theme-on-surface), .03); }
.activity-feed__entry :deep(button[aria-expanded='true']) { box-shadow: inset 2px 0 rgb(var(--v-theme-primary)); }
.activity-feed__entry :deep(button[aria-expanded] + div) { padding: 20px 42px; }
.activity-feed__timestamp, .activity-feed__event, .activity-feed__actor { display: flex; min-width: 0; flex-direction: column; gap: 5px; font-size: 12px; }
.activity-feed__timestamp time { font-family: 'DM Mono', monospace; font-size: 11px; font-style: normal; color: rgba(var(--v-theme-on-surface), .65); }
.activity-feed__timestamp > span, .activity-feed__actor > span:last-child, .activity-feed__phrase { font-size: 11px; color: rgba(var(--v-theme-on-surface), .5); line-height: 1.5; }
.activity-feed__action { display: flex; align-items: center; gap: 7px; font-family: 'DM Mono', monospace; font-size: 12px; overflow-wrap: anywhere; }
.activity-feed__dot { width: 5px; height: 5px; border-radius: 50%; flex: none; }
.activity-feed__actor { overflow-wrap: anywhere; }
.activity-feed__category { min-width: 0; font-size: 11px; }
.activity-feed__chevron { color: rgba(var(--v-theme-on-surface), .4); font-size: 16px; transition: transform 150ms; }
.activity-feed__more { display: flex; align-items: center; justify-content: center; gap: 5px; width: 100%; padding: 12px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); font-size: 12px; color: rgb(var(--v-theme-primary)); }
.activity-feed__more:hover { background: rgba(var(--v-theme-primary), .06); }
.activity-feed__more:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
@media (max-width: 1200px) {
  .activity-feed__columns, .activity-feed__entry :deep(button[aria-expanded]) { grid-template-columns: 16px 170px minmax(0, 1fr) 140px 80px; gap: 8px; }
}
@media (max-width: 760px) {
  .activity-feed__columns { display: none; }
  .activity-feed__entry :deep(button[aria-expanded]) { grid-template-columns: 12px minmax(0, 1fr); align-items: start; gap: 8px; padding: 14px 12px; }
  .activity-feed__chevron { grid-column: 1; grid-row: 1 / 4; }
  .activity-feed__timestamp { grid-column: 2; flex-direction: row; justify-content: space-between; flex-wrap: wrap; }
  .activity-feed__event, .activity-feed__actor, .activity-feed__category { grid-column: 2; }
  .activity-feed__actor { flex-direction: row; flex-wrap: wrap; gap: 8px; }
  .activity-feed__entry :deep(button[aria-expanded] + div) { padding: 18px 14px; }
}
</style>
