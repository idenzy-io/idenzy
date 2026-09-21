<script setup lang="ts">
/**
 * One account's devices: what signed in, from where, when it started, and what ended it.
 *
 * On `RecordTable`, framed, so this list and the activity feed further down the page are
 * the same table with different columns. What reads it sits above the frame rather than
 * inside it: a count and a search over everything an operator is likely to have been
 * handed. There are no tabs and no order control. A status is a column here, so a filter
 * that hid the ended sessions would answer a question the row already answers, and the
 * order is the head's: every column sorts, unsorted, ascending, descending and back.
 *
 * A column is named once, in the head, and never again on the row: the labels a stacked
 * phone layout needs come back through `data-label`, which is `RecordTable`'s business.
 * Revoke is drawn only where there is something to revoke, because a disabled control on
 * four rows out of six is a column of noise.
 */
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  countryName,
  countryOf,
  deviceLabel,
  endedBy,
  endsAt,
  matchesSessionQuery,
  REASON_LABELS,
  SESSION_STATUS_LABELS,
  type SessionRow,
  type SessionStatus,
  sessionStatus,
  sessionTone,
} from "~/utils/sessions";
import { applyDirection, type TableSort } from "~/utils/table-sort";
import { formatDateTime, relativeTime } from "~/utils/time";

const props = defineProps<{
  sessions: readonly SessionRow[];
  loading: boolean;
  now: Date;
}>();

const emit = defineEmits<{ revoke: [session: SessionRow] }>();

const COLUMNS: readonly RecordColumn[] = [
  { key: "device", label: "Device", width: "minmax(0, 1.5fr)", sortable: true },
  { key: "location", label: "Location", width: "minmax(0, 1fr)", sortable: true },
  { key: "started", label: "Signed in", width: "104px", sortable: true },
  { key: "ends", label: "Ends", width: "132px", sortable: true },
  { key: "status", label: "Status", width: "104px", sortable: true },
  { key: "action", label: "", width: "36px", align: "end" },
];

/** Worst first where it is a judgement: a revoked session is the one to read. */
const STATUS_RANK: Record<SessionStatus, number> = { revoked: 0, active: 1, expired: 2 };

const COMPARE: Record<string, (a: SessionRow, b: SessionRow, now: Date) => number> = {
  device: (a, b) => deviceLabel(a).localeCompare(deviceLabel(b)),
  location: (a, b) =>
    (countryName(countryOf(a.network)) ?? "").localeCompare(
      countryName(countryOf(b.network)) ?? "",
    ),
  started: (a, b) => a.createdAt.localeCompare(b.createdAt),
  ends: (a, b) => endsAt(a).at.localeCompare(endsAt(b).at),
  status: (a, b, now) => STATUS_RANK[sessionStatus(a, now)] - STATUS_RANK[sessionStatus(b, now)],
};

/** Newest first, which is the order the list arrives in and what null means. */
const DEFAULT_SORT: TableSort = { key: "started", direction: "desc" };

const sort = ref<TableSort | null>(DEFAULT_SORT);

const active = computed(() => sort.value ?? DEFAULT_SORT);

const query = ref("");

/* `clearable` hands back null, which the filter reads as nothing typed. */
const search = computed({
  get: () => query.value,
  set: (value: string | null) => {
    query.value = value ?? "";
  },
});

const shown = computed(() => {
  const compare = COMPARE[active.value.key] ?? COMPARE.started;
  return [...props.sessions]
    .filter((session) => matchesSessionQuery(session, query.value))
    .sort((a, b) => applyDirection(compare?.(a, b, props.now) ?? 0, active.value.direction));
});

function live(session: SessionRow): boolean {
  return sessionStatus(session, props.now) === "active";
}

function expiryDetail(session: SessionRow): string {
  const { cause, at } = endsAt(session);
  return `${cause === "idle" ? "Idle timeout" : "Maximum lifetime"} · ${formatDateTime(at)}`;
}

function endedLabel(session: SessionRow): string {
  const reason = endedBy(session, props.now);
  return reason === null ? "Session ended" : REASON_LABELS[reason];
}
</script>

<template>
  <div v-if="loading || sessions.length > 0">
    <!-- The same bar the activity feed carries, above the frame for the same reason: what
         reads the list is the reader's, and a control on the table's own ground reads as
         part of the record. -->
    <div class="mb-3 flex flex-wrap items-center justify-end gap-2">
      <span v-if="!loading" class="session-list__count" role="status">
        {{ shown.length }} {{ shown.length === 1 ? "session" : "sessions" }}
      </span>
      <SearchField
        v-model="search"
        label="Search sessions"
        placeholder="Search devices, addresses or IDs"
        class="w-full grow-0 sm:w-72"
      />
    </div>

    <RecordTable
      v-model:sort="sort"
      :aria-busy="loading"
      :columns="COLUMNS"
      :loading="loading"
      framed
      label="Sessions"
    >
      <li v-for="session in shown" :key="session.id" class="record-row">
        <span class="record-cell record-cell--primary">
          <SessionDevice :session="session" />
        </span>

        <span class="record-cell session-list__location" data-label="Location">
          <span class="session-list__place">
            <SessionCountry v-if="session.network?.country" :network="session.network" />
            <span v-else class="session-list__unknown">Unknown</span>
            <SessionNetwork :network="session.network" />
          </span>
          <span class="session-list__ip">{{ session.ip ?? "No address recorded" }}</span>
        </span>

        <span class="record-cell record-cell--half session-list__time" data-label="Signed in">
          <v-tooltip :text="formatDateTime(session.createdAt)" location="top">
            <template #activator="{ props: tip }">
              <time v-bind="tip" :datetime="session.createdAt" tabindex="0">
                {{ relativeTime(session.createdAt, now) }}
              </time>
            </template>
          </v-tooltip>
        </span>

        <span
          :data-label="live(session) ? 'Ends' : 'Ended'"
          class="record-cell record-cell--half session-list__time"
        >
          <v-tooltip v-if="live(session)" :text="expiryDetail(session)" location="top">
            <template #activator="{ props: tip }">
              <time v-bind="tip" :datetime="endsAt(session).at" tabindex="0">
                {{ relativeTime(endsAt(session).at, now) }}
              </time>
            </template>
          </v-tooltip>
          <span v-else :title="endedLabel(session)" class="session-list__reason">
            {{ endedLabel(session) }}
          </span>
        </span>

        <span class="record-cell record-cell--half" data-label="Status">
          <Tag
            :label="SESSION_STATUS_LABELS[sessionStatus(session, now)]"
            :tone="sessionTone(session, now)"
          />
        </span>

        <span class="record-cell record-cell--action record-cell--end">
          <v-tooltip v-if="live(session)" location="top" text="Revoke this session">
            <template #activator="{ props: tip }">
              <button
                v-bind="tip"
                :aria-label="`Revoke session ${session.id}`"
                class="session-list__revoke"
                type="button"
                @click="emit('revoke', session)"
              >
                <Icon aria-hidden="true" name="material-symbols:logout" />
              </button>
            </template>
          </v-tooltip>
        </span>
      </li>

      <template #empty>
        <p v-if="loading" class="px-4 py-14 text-center text-xs text-ink/55" role="status">
          Loading sessions…
        </p>
        <div
          v-else-if="shown.length === 0"
          class="flex flex-col items-center gap-1 px-4 py-14 text-center"
          role="status"
        >
          <Icon aria-hidden="true" class="mb-1 text-2xl text-ink/25" name="material-symbols:search-off" />
          <p class="m-0 text-sm font-medium text-ink">No sessions match “{{ query }}”</p>
          <p class="m-0 max-w-md text-xs leading-5 text-ink/55">
            Every session on record is still here; the search is what is hiding them.
          </p>
          <button class="mt-2 text-xs text-primary underline" type="button" @click="query = ''">
            Clear search
          </button>
        </div>
      </template>
    </RecordTable>
  </div>

  <!-- Nothing has ever signed in. Drawn like every other empty list on the panel: a mark,
       what is missing, and why the record may be empty rather than wrong. -->
  <div v-else class="flex flex-col items-center gap-1 px-4 py-14 text-center">
    <Icon aria-hidden="true" class="mb-1 text-2xl text-ink/25" name="material-symbols:devices-outline" />
    <p class="m-0 text-sm font-medium text-ink">No sessions on record</p>
    <p class="m-0 max-w-md text-xs leading-5 text-ink/55">
      Nothing has signed in, or previous sessions have aged out of the record.
    </p>
  </div>
</template>

<style scoped>
.session-list__count {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}

/* Filled at a twentieth of the ink so the pill reads on a ground it shares with the page.
   Sized like the search on every other screen: 12px text in a 32px field. */

/* Two lines, like the device beside it, so the column carries the address instead of
   air and the two tall cells set one row height. */
.session-list__location {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-list__place {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  line-height: 16px;
}

.session-list__ip {
  font-family: "DM Mono", monospace;
  font-size: 11px;
  line-height: 16px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.session-list__unknown {
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.session-list__time {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.8);
}

.session-list__time time {
  font-style: normal;
  cursor: help;
}

/* One line, always: a reason that wrapped made its row taller than every other row. */
.session-list__reason {
  display: block;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.55);
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-list__revoke {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 16px;
  transition:
    color 150ms,
    background-color 150ms;
}

.session-list__revoke:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-error));
}

.session-list__revoke:focus-visible,
.session-list__time time:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
