<script setup lang="ts">
/**
 * Every server-side session on the current project: which devices are signed in, on
 * whose account, from where, by what they proved, and when each one ends.
 *
 * The users screen answers "who has an account"; this one answers "what is signed in
 * right now", which is the question asked during an incident and the one the sessions
 * table exists to answer (PROJECT.md 4.2). It is built for that order of work: land on
 * a suspicious row, narrow to that account or that machine from the row menu, and end
 * what should not be open. The ended rows stay listed on purpose, because a session
 * that was revoked and why is the part of the history an investigation reads.
 *
 * The columns are the `sessions` table as the management API returns it, joined with
 * the account each belongs to, and the pure rules over them are in `utils/sessions.ts`.
 * The data is the store's placeholder until the API client exists; nothing here knows
 * the difference. The column arrangement and the page size are the reader's and go to
 * local storage, the filters and the sort are a visit's and do not.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  type ColumnState,
  type DataTableColumn,
  type DataTableSort,
  defaultColumnState,
  reconcileColumnState,
} from "~/utils/data-table";
import {
  countDevices,
  countriesIn,
  countryName,
  countryOf,
  countSessionsByStatus,
  deviceLabel,
  EMPTY_SESSION_FILTERS,
  endedBy,
  endsAt,
  FACTOR_ICONS,
  FACTOR_LABELS,
  filterSessions,
  isSecurityEvent,
  NETWORK_SIGNALS,
  networkSignal,
  REASON_LABELS,
  SESSION_STATUS_LABELS,
  SESSION_STATUS_RANK,
  type SessionFilters,
  type SessionRow,
  type SessionStatus,
  sessionFilterCount,
  sessionStatus,
  sessionsExportName,
  sessionsToCsv,
} from "~/utils/sessions";
import { DURATIONS, formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useSessionsStore();
const { copy } = useClipboard();

/* Half a minute is finer than any figure on the screen: the coarsest relative time is
   the minute, and a session lapsing is noticed within one. */
const now = useNow({ interval: 30_000 });

const all = computed(() => store.forProject(projects.current.id));
const counts = computed(() => countSessionsByStatus(all.value, now.value));
const devices = computed(() => countDevices(all.value));
const countries = computed(() => countriesIn(all.value));

const filters = ref<SessionFilters>({ ...EMPTY_SESSION_FILTERS });
const filtered = computed(() => filterSessions(all.value, filters.value, now.value));

/* Whether anything is narrowing the list, for the empty state to offer a way out. */
const narrowed = computed(
  () =>
    filters.value.status !== "all" ||
    filters.value.query.trim() !== "" ||
    sessionFilterCount(filters.value) > 0,
);

function resetFilters() {
  filters.value = { ...EMPTY_SESSION_FILTERS };
}

const STATUS_TABS: readonly ("all" | SessionStatus)[] = ["all", "active", "expired", "revoked"];

function isStatusTab(value: string): value is "all" | SessionStatus {
  return (STATUS_TABS as readonly string[]).includes(value);
}

const statusOptions = computed<SegmentedOption[]>(() =>
  STATUS_TABS.map((tab) => ({
    value: tab,
    label: `${tab === "all" ? "All" : SESSION_STATUS_LABELS[tab]} · ${counts.value[tab]}`,
  })),
);

const statusTab = computed({
  get: () => filters.value.status,
  set: (value: string) => {
    if (isStatusTab(value)) filters.value = { ...filters.value, status: value };
  },
});

/* `clearable` hands back null, which the filter reads as nothing typed. */
const query = computed({
  get: () => filters.value.query,
  set: (value: string | null) => {
    filters.value = { ...filters.value, query: value ?? "" };
  },
});

const STATUS_TONES: Record<SessionStatus, BadgeTone> = {
  active: "success",
  expired: "neutral",
  revoked: "warning",
};

/**
 * What the status badge says after the word: for an ended session what ended it, and for
 * a live one how long it has left, but only when that is soon.
 *
 * The silence is the point. An idle window is a fortnight and a live session was active
 * by definition, so its idle expiry is always about a fortnight out and a column of them
 * would read "in 1w" on every row: a figure that never varies is a figure nobody reads.
 * What does vary is a session closing on its absolute lifetime, which is the one ending
 * that surprises the person it happens to, so that is the one the badge speaks up for.
 */
function statusDetail(session: SessionRow): string {
  if (sessionStatus(session, now.value) !== "active") {
    const reason = endedBy(session, now.value);
    return reason === null ? "" : REASON_LABELS[reason];
  }
  const at = endsAt(session).at;
  const left = new Date(at).getTime() - now.value.getTime();
  return left <= DURATIONS.WEEK ? `ends ${relativeTime(at, now.value)}` : "";
}

function statusTone(session: SessionRow): BadgeTone {
  const status = sessionStatus(session, now.value);
  if (status === "revoked" && isSecurityEvent(endedBy(session, now.value))) return "error";
  return STATUS_TONES[status];
}

/**
 * The columns. `value` is what a column sorts by where that is not the property itself:
 * a device or a person folded to one case, a status by its rank, and a nullable field as
 * the empty string so the rows without one gather at the far end of a sorted list.
 */
const COLUMNS: readonly DataTableColumn<SessionRow>[] = [
  {
    key: "device",
    title: "Device",
    fixed: true,
    minWidth: 260,
    skeleton: "identity",
    value: (session) => deviceLabel(session).toLowerCase(),
  },
  {
    key: "user",
    title: "User",
    minWidth: 180,
    skeleton: "identity",
    value: (session) => (session.user.displayName ?? session.user.email ?? "").toLowerCase(),
  },
  {
    key: "amr",
    title: "Signed in with",
    width: 152,
    skeleton: "glyphs",
    value: (session) => session.amr.length,
  },
  {
    key: "status",
    title: "Status",
    width: 184,
    skeleton: "pill",
    value: (session) => SESSION_STATUS_RANK[sessionStatus(session, now.value)],
  },
  { key: "ip", title: "IP address", mono: true, width: 168, value: (s) => s.ip ?? "" },
  {
    key: "country",
    title: "Country",
    width: 152,
    value: (session) => countryOf(session.network) ?? "",
  },
  {
    key: "network",
    title: "Network",
    width: 132,
    skeleton: "pill",
    // Sorted by how much it wants looking at, not alphabetically: the point of sorting
    // this column is to bring Tor to the top.
    value: (session) => NETWORK_SIGNALS.indexOf(networkSignal(session.network)),
  },
  {
    key: "factor",
    title: "Second factor",
    mono: true,
    width: 132,
    value: (session) => session.factorVerifiedAt ?? "",
  },
  { key: "lastActiveAt", title: "Last active", mono: true, width: 116 },
  { key: "createdAt", title: "Signed in", mono: true, width: 156 },
  {
    key: "expiresAt",
    title: "Expires",
    mono: true,
    width: 132,
    hidden: true,
    value: (session) => endsAt(session).at,
  },
  { key: "id", title: "Session ID", mono: true, width: 208, hidden: true },
  {
    key: "deviceId",
    title: "Device ID",
    mono: true,
    width: 200,
    hidden: true,
    value: (session) => session.deviceId ?? "",
  },
  {
    key: "userAgent",
    title: "User agent",
    width: 260,
    hidden: true,
    value: (session) => session.userAgent ?? "",
  },
  {
    key: "bound",
    title: "Device key",
    align: "end",
    width: 100,
    hidden: true,
    value: (session) => (session.deviceBound ? 1 : 0),
  },
];

/* Reconciled on every read, so a column added in a release appears for a reader who
   arranged the table before it existed. */
const stored = useLocalStorage<ColumnState>("idenzy.sessions.columns", defaultColumnState(COLUMNS));
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});

const sortBy = ref<DataTableSort[]>([{ key: "lastActiveAt", order: "desc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.sessions.page-size", 10);

const selected = ref<string[]>([]);
const selectedSessions = computed(() =>
  all.value.filter((session) => selected.value.includes(session.id)),
);

/* A selection is of what is on the screen: rows a filter has hidden leave it too. */
watch(filtered, (rows) => {
  const visible = new Set(rows.map((row) => row.id));
  selected.value = selected.value.filter((id) => visible.has(id));
});

watch(
  () => projects.current.id,
  () => {
    selected.value = [];
    page.value = 1;
  },
);

const revocable = (sessions: readonly SessionRow[]) =>
  sessions.filter((session) => sessionStatus(session, now.value) === "active");

const revokeOpen = ref(false);
const revokeTargets = ref<SessionRow[]>([]);

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function askRevoke(sessions: readonly SessionRow[]) {
  revokeTargets.value = revocable(sessions);
  if (revokeTargets.value.length > 0) revokeOpen.value = true;
}

function revoke() {
  const count = store.revoke(revokeTargets.value.map((session) => session.id));
  notify(`Revoked ${plural(count, "session")}`);
  selected.value = [];
}

async function copyText(text: string, what: string) {
  await copy(text);
  notify(`${what} copied`);
}

/* Narrowing from a row: the search box is the one control that already matches on both
   kinds of id, so pointing it at one is the whole of it. The status tab is cleared with
   it, because a device's other sessions are usually the ended ones. */
function only(term: string, what: string) {
  filters.value = { ...EMPTY_SESSION_FILTERS, query: term };
  page.value = 1;
  notify(`Showing ${what}`);
}

/* A country is structural rather than a search term: "DE" as text matches "device" and
   half the addresses in the table. */
function onlyCountry(session: SessionRow) {
  const code = countryOf(session.network);
  if (code === null) return;
  filters.value = { ...EMPTY_SESSION_FILTERS, countries: [code] };
  page.value = 1;
  notify(`Showing ${countryName(code)}`);
}

/* A file the browser saves, named by project and day so two exports do not collide. */
function exportCsv(sessions: readonly SessionRow[]) {
  const blob = new Blob([sessionsToCsv(sessions, now.value)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sessionsExportName(projects.current.id, new Date());
  anchor.click();
  URL.revokeObjectURL(url);
  notify(`Exported ${plural(sessions.length, "session")}`);
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Sessions & devices">
      <template #description>
        Every signed-in device on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >, across
        <span class="font-mono tabular-nums">{{ devices.toLocaleString("en") }}</span>
        {{ devices === 1 ? "device" : "devices" }}.
      </template>
      <template #actions>
        <v-btn
          :disabled="filtered.length === 0"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="outlined"
          @click="exportCsv(filtered)"
        >
          Export CSV
        </v-btn>
      </template>
    </PageHeader>

    <v-card border flat>
      <div
        class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <SegmentedControl v-model="statusTab" :options="statusOptions" label="Status" />

        <div class="flex flex-wrap items-center gap-2">
          <v-text-field
            v-model="query"
            aria-label="Search sessions"
            class="sessions__search w-full sm:w-80"
            clearable
            density="comfortable"
            hide-details
            placeholder="Search device, user, IP or ID"
            prepend-inner-icon="material-symbols:search"
            variant="outlined"
          />
          <SessionsFilterMenu v-model="filters" :countries="countries" />
          <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
        </div>
      </div>

      <DataTable
        v-model:column-state="columnState"
        v-model:items-per-page="pageSize"
        v-model:page="page"
        v-model:selected="selected"
        v-model:sort-by="sortBy"
        :columns="COLUMNS"
        :items="filtered"
        :loading="store.loading"
        label="Sessions"
        selectable
      >
        <!-- Revoke is off when nothing in the selection is still live, so a bar over a
             mixed selection says what applies rather than failing on what does not. -->
        <template #selection>
          <v-btn
            :disabled="revocable(selectedSessions).length === 0"
            class="text-xs font-medium"
            color="error"
            prepend-icon="material-symbols:logout"
            size="small"
            variant="text"
            @click="askRevoke(selectedSessions)"
          >
            Revoke
          </v-btn>
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:download"
            size="small"
            variant="text"
            @click="exportCsv(selectedSessions)"
          >
            Export
          </v-btn>
        </template>

        <template #cell.device="{ item }">
          <SessionDevice :session="item" />
        </template>

        <template #cell.user="{ item }">
          <SessionUser :user="item.user" />
        </template>

        <template #cell.amr="{ item }">
          <ul class="m-0 flex list-none items-center gap-1 p-0">
            <li v-for="factor in item.amr" :key="factor">
              <v-tooltip :text="FACTOR_LABELS[factor]" location="top">
                <template #activator="{ props: tip }">
                  <span
                    v-bind="tip"
                    :aria-label="FACTOR_LABELS[factor]"
                    class="flex size-6 items-center justify-center rounded-(--idenzy-radius-x-small) bg-ink/4 text-ink/70"
                    role="img"
                  >
                    <Icon :name="FACTOR_ICONS[factor]" aria-hidden="true" class="text-[13px]" />
                  </span>
                </template>
              </v-tooltip>
            </li>
          </ul>
        </template>

        <template #cell.status="{ item }">
          <StatusBadge
            :detail="statusDetail(item)"
            :label="SESSION_STATUS_LABELS[sessionStatus(item, now)]"
            :tone="statusTone(item)"
          />
        </template>

        <template #cell.ip="{ item }">
          <button
            v-if="item.ip"
            class="group/ip inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/80 tabular-nums transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            title="Copy IP address"
            type="button"
            @click="copyText(item.ip, 'IP address')"
          >
            <span class="truncate">{{ item.ip }}</span>
            <Icon
              aria-hidden="true"
              class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/ip:opacity-60"
              name="material-symbols:content-copy-outline"
            />
          </button>
          <span v-else class="text-ink/30">–</span>
        </template>

        <template #cell.country="{ item }">
          <SessionCountry :network="item.network" />
        </template>

        <template #cell.network="{ item }">
          <SessionNetwork :network="item.network" />
        </template>

        <template #cell.factor="{ item }">
          <v-tooltip v-if="item.factorVerifiedAt" :text="formatDateTime(item.factorVerifiedAt)" location="top">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="inline-flex items-center gap-1 text-ink">
                <Icon
                  aria-hidden="true"
                  class="text-sm text-success"
                  name="material-symbols:shield-lock-outline"
                />
                <span class="font-mono tabular-nums">{{ relativeTime(item.factorVerifiedAt, now) }}</span>
              </span>
            </template>
          </v-tooltip>
          <span v-else class="text-ink/40">None</span>
        </template>

        <template #cell.lastActiveAt="{ item }">
          <v-tooltip :text="formatDateTime(item.lastActiveAt)" location="top">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                {{ relativeTime(item.lastActiveAt, now) }}
              </span>
            </template>
          </v-tooltip>
        </template>

        <template #cell.createdAt="{ item }">
          <span class="font-mono text-ink/80 tabular-nums">
            {{ formatDateTime(item.createdAt) }}
          </span>
        </template>

        <template #cell.expiresAt="{ item }">
          <v-tooltip
            :text="`${endsAt(item).cause === 'idle' ? 'Idle timeout' : 'Maximum lifetime'} · ${formatDateTime(endsAt(item).at)}`"
            location="top"
          >
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                {{ relativeTime(endsAt(item).at, now) }}
              </span>
            </template>
          </v-tooltip>
        </template>

        <template #cell.id="{ item }">
          <button
            class="group/id inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/65 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            title="Copy session ID"
            type="button"
            @click="copyText(item.id, 'Session ID')"
          >
            <span class="truncate">{{ item.id }}</span>
            <Icon
              aria-hidden="true"
              class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/id:opacity-60"
              name="material-symbols:content-copy-outline"
            />
          </button>
        </template>

        <template #cell.deviceId="{ item }">
          <span v-if="item.deviceId" class="truncate font-mono text-[11px] text-ink/65">
            {{ item.deviceId }}
          </span>
          <span v-else class="text-ink/30">–</span>
        </template>

        <template #cell.userAgent="{ item }">
          <span v-if="item.userAgent" class="block max-w-[16rem] truncate text-[11px] text-ink/65">
            {{ item.userAgent }}
          </span>
          <span v-else class="text-ink/30">–</span>
        </template>

        <template #cell.bound="{ item }">
          <span v-if="item.deviceBound" class="inline-flex items-center gap-1 text-ink">
            <Icon aria-hidden="true" class="text-sm text-success" name="material-symbols:key-outline" />
            Bound
          </span>
          <span v-else class="text-ink/40">Off</span>
        </template>

        <template #actions="{ item }">
          <SessionRowActions
            :country="countryOf(item.network)"
            :revocable="sessionStatus(item, now) === 'active'"
            :session="item"
            @copy-id="copyText(item.id, 'Session ID')"
            @copy-ip="item.ip && copyText(item.ip, 'IP address')"
            @copy-user="copyText(item.userId, 'User ID')"
            @only-country="onlyCountry(item)"
            @only-device="item.deviceId && only(item.deviceId, 'one device')"
            @only-user="only(item.userId, 'one user')"
            @revoke="askRevoke([item])"
          />
        </template>

        <template #empty>
          <div class="flex flex-col items-center gap-1 px-4 py-14 text-center">
            <Icon
              aria-hidden="true"
              class="mb-1 text-2xl text-ink/25"
              name="material-symbols:devices-other-outline"
            />
            <p class="m-0 text-sm font-medium text-ink">
              {{ all.length === 0 ? "No sessions yet" : "No sessions match" }}
            </p>
            <p class="m-0 max-w-sm text-xs text-ink/55">
              {{
                all.length === 0
                  ? "Nobody has signed in on this project. A session appears here the moment one does."
                  : "Try another search, or clear the filters to see every device."
              }}
            </p>
            <v-btn
              v-if="narrowed"
              class="mt-2 text-xs font-medium"
              color="neutral"
              size="small"
              variant="outlined"
              @click="resetFilters"
            >
              Clear filters
            </v-btn>
          </div>
        </template>
      </DataTable>
    </v-card>

    <SessionRevokeDialog v-model="revokeOpen" :sessions="revokeTargets" @confirm="revoke" />

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
      class="sessions__toast"
      color="surface"
      location="bottom right"
      rounded="lg"
      variant="flat"
    >
      <span class="text-xs text-ink">{{ toast }}</span>
    </v-snackbar>
  </div>
</template>

<style scoped>
/* A search box at the height of the buttons beside it, in the toolbar's small type and
   on the small radius, so the three controls in the row read as one set. The outline's
   colours are the theme's, in theme.css, and are what every outlined field gets. */
.sessions__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.sessions__search :deep(.v-field__input),
.sessions__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
  min-height: 32px;
}

.sessions__search :deep(.v-field__prepend-inner > .v-icon),
.sessions__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
