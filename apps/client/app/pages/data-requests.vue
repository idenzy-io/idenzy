<script setup lang="ts">
/**
 * What people have asked us to do with their data, and how long is left to do it
 * (`data_subject_requests`, PROJECT.md 4.13.6).
 *
 * The clock is the screen. A deadline here is statutory, computed at intake and monitored,
 * so the strip at the top leads with what is overdue rather than with what is open, the
 * table sorts by the deadline rather than by when a row arrived, and overdue is the only
 * thing on the page drawn in the error tone.
 *
 * What a request touches is not listed anywhere on this screen and never should be. The
 * field lists are generated from the schema by `@idenzy/compliance`, so an export covers a
 * column added two years from now on its own; a page that restated them would be a second
 * list to keep in step, and the failure mode of that is an export missing a column.
 */

import {
  ARTIFACT_TTL_DAYS,
  type DataSubjectRequest,
  daysLeft,
  dueTone,
  dueWords,
  filterRequests,
  GDPR_DUE_DAYS,
  isArtifactLive,
  isOpen,
  kindInfo,
  NO_REQUEST_FILTERS,
  REQUEST_KIND_INFO,
  REQUEST_KINDS,
  REQUEST_STATUS_TONES,
  type RequestFilters,
  type RequestKind,
  type RequestTab,
  statusLabel,
  summariseRequests,
  TAB_LABELS,
} from "~/utils/data-requests";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { formatDate, relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useDataRequestsStore();
const users = useUsersStore();

/* An hour is plenty: what moves here is a day counter, not a second one. */
const now = useNow({ interval: 60_000 });

const requests = computed(() => store.forProject(projects.current.id));
const summary = computed(() => summariseRequests(requests.value, now.value));
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const filters = ref<RequestFilters>({ ...NO_REQUEST_FILTERS });
const shown = computed(() => filterRequests(requests.value, filters.value, now.value));

const expanded = reactive({ how: false });

const busy = ref<Set<string>>(new Set());
const saving = computed(() => busy.value.size > 0);

function isBusy(key: string): boolean {
  return busy.value.has(key);
}

async function whileBusy(key: string, work: () => Promise<void>) {
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

/*
 * The tabs. Overdue carries its count because it is the one that pages somebody.
 */

const tabOptions = computed(() =>
  (["open", "overdue", "closed", "all"] as RequestTab[]).map((tab) => ({
    value: tab,
    label:
      tab === "overdue" && summary.value.overdue > 0
        ? `${TAB_LABELS[tab]} · ${summary.value.overdue}`
        : TAB_LABELS[tab],
  })),
);

function setTab(value: string) {
  filters.value = { ...filters.value, tab: value as RequestTab };
}

function toggleKind(kind: RequestKind) {
  const held = filters.value.kinds;
  filters.value = {
    ...filters.value,
    kinds: held.includes(kind) ? held.filter((entry) => entry !== kind) : [...held, kind],
  };
}

/*
 * The table.
 */

const COLUMNS: readonly DataTableColumn<DataSubjectRequest>[] = [
  { key: "subjectLabel", title: "Whose data", fixed: true, minWidth: 240 },
  { key: "kind", title: "Asked for", width: 160, value: (row) => kindInfo(row.kind).label },
  { key: "status", title: "Status", width: 140, skeleton: "pill" },
  {
    key: "dueAt",
    title: "Deadline",
    width: 170,
    /* Sorted by what is left rather than by the date, so the closed rows fall to the end
       instead of interleaving with the open ones by an expiry nobody is waiting on. */
    value: (row) => (isOpen(row.status) ? daysLeft(row, now.value) : Number.MAX_SAFE_INTEGER),
  },
  { key: "requestedAt", title: "Requested", width: 140, mono: true },
  { key: "requestedBy", title: "Taken down by", width: 200, hidden: true },
];

const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.data-requests.columns",
  defaultColumnState(COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});

const sortBy = ref<DataTableSort[]>([{ key: "dueAt", order: "asc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.data-requests.page-size", 10);

function ago(stamp: string): string {
  const at = new Date(stamp);
  return relativeTimeWords(stamp, now.value < at ? at : now.value);
}

/*
 * Logging one, and acting on one.
 */

const logOpen = ref(false);
const detailOpen = ref(false);
const openId = ref<string | null>(null);

const openRequest = computed<DataSubjectRequest | null>(
  () => requests.value.find((request) => request.id === openId.value) ?? null,
);

/** Who a request may be about: the project's own accounts, by id or by address. */
const subjects = computed(() =>
  users
    .forProject(projects.current.id)
    .map((user) => ({ id: user.id, label: user.email ?? user.id })),
);

function inspect(request: DataSubjectRequest) {
  openId.value = request.id;
  detailOpen.value = true;
}

async function confirmLog(draft: {
  subjectUserId: string;
  subjectLabel: string;
  kind: RequestKind;
  requestedBy: string;
}) {
  await whileBusy("log", () => store.log(projects.current.id, draft));
  logOpen.value = false;
}

function act(action: "start" | "complete" | "refuse") {
  const id = openId.value;
  if (id === null) return;
  void whileBusy(id, async () => {
    if (action === "start") await store.start(projects.current.id, id);
    else if (action === "complete") await store.complete(projects.current.id, id);
    else await store.refuse(projects.current.id, id);
    if (action !== "start") detailOpen.value = false;
  });
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:folder-shared-outline" title="Data requests">
      <template #description>
        What people have asked
        <span class="font-medium text-ink">{{ projects.current.name }}</span> to do with
        their data. Each one carries a statutory deadline computed at intake, and an
        overdue one pages somebody rather than waiting to be noticed.
      </template>
      <template #actions>
        <FancyButton @click="logOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Log a request
        </FancyButton>
      </template>
    </PageHeader>

    <!-- Overdue first, because it is the finding. The others are context for it. -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Statistic
        :value="summary.overdue"
        description="Past the statutory deadline. This is the number an auditor asks for."
        label="Overdue"
        :positive="'down'"
      />
      <Statistic
        :value="summary.dueSoon"
        :description="`Due inside a week. The window is ${GDPR_DUE_DAYS} days from intake.`"
        label="Due soon"
        :positive="'down'"
      />
      <Statistic :value="summary.open" description="Received or being worked on." label="Open" />
      <Statistic
        :value="summary.closed"
        description="Completed or lawfully refused. The row stays as the record that it was."
        label="Closed"
      />
    </div>

    <LayerCard :padded="false">
      <template #header>
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">Requests</h2>
          <p class="m-0 text-xs text-ink/55">
            Sorted by what is left rather than by when it arrived.
          </p>
        </div>
      </template>
      <template #actions>
        <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
      </template>

      <div
        class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <SegmentedControl
          :model-value="filters.tab"
          :options="tabOptions"
          label="Which requests"
          @update:model-value="setTab"
        />

        <div class="flex flex-wrap items-center gap-2">
          <v-text-field
            v-model="filters.text"
            aria-label="Search requests"
            class="data-requests__search w-full sm:w-72"
            clearable
            density="comfortable"
            hide-details
            placeholder="Search by address or id"
            prepend-inner-icon="material-symbols:search"
            variant="outlined"
          />
          <v-menu :close-on-content-click="false" :offset="6" location="bottom end">
            <template #activator="{ props: activator }">
              <v-btn
                v-bind="activator"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:filter-alt-outline"
                size="small"
                variant="outlined"
              >
                Kind
                <span v-if="filters.kinds.length > 0" class="ml-1.5 font-mono text-primary">
                  {{ filters.kinds.length }}
                </span>
              </v-btn>
            </template>
            <v-list density="compact" min-width="260" nav>
              <v-list-item
                v-for="kind in REQUEST_KINDS"
                :key="kind"
                :active="filters.kinds.includes(kind)"
                :prepend-icon="REQUEST_KIND_INFO[kind].icon"
                :subtitle="REQUEST_KIND_INFO[kind].article"
                :title="REQUEST_KIND_INFO[kind].label"
                @click="toggleKind(kind)"
              />
            </v-list>
          </v-menu>
        </div>
      </div>

      <DataTable
        v-model:column-state="columnState"
        v-model:items-per-page="pageSize"
        v-model:page="page"
        v-model:sort-by="sortBy"
        :columns="COLUMNS"
        :items="shown"
        :loading="store.loading"
        empty-description="Nothing here in this view. A request arriving through your own account flow is logged for you; one that reached you anywhere else goes in by hand."
        empty-title="No requests"
        item-value="id"
        label="Data requests"
      >
        <template #cell.subjectLabel="{ item }">
          <button
            class="cursor-pointer truncate border-0 bg-transparent p-0 font-mono text-xs text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="inspect(item)"
          >
            {{ item.subjectLabel }}
          </button>
        </template>

        <template #cell.kind="{ item }">
          <span class="flex items-center gap-1.5">
            <Icon
              :name="kindInfo(item.kind).icon"
              aria-hidden="true"
              class="flex-none text-sm text-ink/50"
            />
            <span class="truncate text-ink/80">{{ kindInfo(item.kind).label }}</span>
          </span>
        </template>

        <template #cell.status="{ item }">
          <StatusBadge
            :label="statusLabel(item.status)"
            :tone="REQUEST_STATUS_TONES[item.status]"
          />
        </template>

        <template #cell.dueAt="{ item }">
          <v-tooltip :text="`Due ${formatDate(item.dueAt)}`" location="top">
            <template #activator="{ props: tip }">
              <span
                v-bind="tip"
                :class="{
                  'text-error font-medium': dueTone(item, now) === 'error',
                  'text-warning': dueTone(item, now) === 'warning',
                  'text-ink/70': dueTone(item, now) === 'success',
                  'text-ink/40': dueTone(item, now) === 'neutral',
                }"
                class="whitespace-nowrap"
              >
                {{ dueWords(item, now) }}
              </span>
            </template>
          </v-tooltip>
        </template>

        <template #cell.requestedAt="{ item }">
          <span class="text-ink/70">{{ ago(item.requestedAt) }}</span>
        </template>

        <template #actions="{ item }">
          <div class="flex items-center justify-end gap-1">
            <v-tooltip
              v-if="isArtifactLive(item, now)"
              location="top"
              :text="`The export bundle. It expires ${ARTIFACT_TTL_DAYS} days after it was built.`"
            >
              <template #activator="{ props: tip }">
                <a
                  v-bind="tip"
                  :href="item.artifactUri ?? '#'"
                  aria-label="Download the export bundle"
                  class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  rel="noopener"
                  target="_blank"
                >
                  <Icon aria-hidden="true" class="text-base" name="material-symbols:download" />
                </a>
              </template>
            </v-tooltip>
            <button
              :aria-label="`Open the request for ${item.subjectLabel}`"
              class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="inspect(item)"
            >
              <Icon aria-hidden="true" class="text-base" name="material-symbols:chevron-right" />
            </button>
          </div>
        </template>
      </DataTable>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.how"
      description="What each kind does, what an erasure keeps, and the parts of this nobody configures."
      expandable
      title="How a request is answered"
    >
      <div class="divide-y divide-line">
        <SettingRow
          v-for="kind in REQUEST_KINDS"
          :key="kind"
          :description="REQUEST_KIND_INFO[kind].note"
          :fixed="REQUEST_KIND_INFO[kind].article"
          :label="REQUEST_KIND_INFO[kind].label"
        />
        <SettingRow
          description="The columns an export returns and the ones an erasure acts on are generated from the schema, by walking every column declared through classified() and reading what it says about itself. Nobody maintains a list, which is what stops the most common Article 15 failure: an export that quietly omits a column somebody added two years ago."
          fixed="Generated"
          label="What a request covers"
        />
        <SettingRow
          :description="`Computed at intake, ${GDPR_DUE_DAYS} days, and indexed with the status so an overdue row is a query rather than a search. It is monitored and pages somebody: a regulatory clock that depends on a person remembering is an intention rather than a control.`"
          :fixed="`${GDPR_DUE_DAYS} days`"
          label="Where the deadline comes from"
        />
        <SettingRow
          :description="`The bundle holds everything about a person, so it is kept for ${ARTIFACT_TTL_DAYS} days and then it is gone. The request stays completed afterwards: meeting the obligation is what was required, and keeping the copy is not.`"
          :fixed="`${ARTIFACT_TTL_DAYS} days`"
          label="How long an export bundle lives"
        />
        <SettingRow
          description="Retention policies purge sessions, one-time codes, OAuth flows, audit partitions and soft-deleted accounts on a schedule set by the project's compliance tier. Retention no job enforces is not retention, so it is a worker rather than a setting."
          fixed="On a schedule"
          label="What is purged without being asked"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <DataRequestLogDialog
      v-model="logOpen"
      :busy="isBusy('log')"
      :subjects="subjects"
      @confirm="confirmLog"
    />
    <DataRequestDetailDialog
      v-model="detailOpen"
      :busy="openId !== null && isBusy(openId)"
      :now="now"
      :request="openRequest"
      @complete="act('complete')"
      @refuse="act('refuse')"
      @start="act('start')"
    />
  </div>
</template>

<style scoped>
/* The toolbar search, at the height of the buttons beside it and on the small radius, the
   same block the users and sessions toolbars carry. */
.data-requests__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.data-requests__search :deep(.v-field__input),
.data-requests__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
  min-height: 32px;
}

.data-requests__search :deep(.v-field__prepend-inner > .v-icon),
.data-requests__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
