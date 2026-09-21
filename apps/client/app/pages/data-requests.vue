<script setup lang="ts">
/**
 * What people have asked the project to do with their data, and how long is left to answer
 * each (`data_subject_requests`, PROJECT.md 4.13.6). The note's shape: the counters that
 * matter, a queue in deadline order, and a request opened over it with its receipt, its
 * verification, the work and the answer, ending in the one step that is next.
 *
 * Three things the old screen claimed are gone. The deadline ran from the moment of logging
 * and was a fixed thirty days called statutory; it now runs from receipt, on the calendar,
 * under a named rule. Mark completed and Refuse changed a badge; a request now closes on
 * evidence and a refusal needs its grounds. And an overdue request was said to page
 * somebody, which nothing does yet, so the page says that instead (notes/data-requests.md).
 *
 * The view and the two menus are in the URL, and so is the request being read, so a queue
 * or a request can be linked to. The search is not: it is whichever person is being looked
 * for, and an address in a URL is personal data in a browser history.
 */
import type {
  ExtensionInput,
  IntakeInput,
  Refusal,
  RefusalInput,
  ResponseInput,
  VerifyInput,
} from "~/stores/data-requests";
import {
  ARTIFACT_TTL_DAYS,
  CALENDAR_NOTE,
  type DataSubjectRequest,
  DEADLINE_RULES,
  deadlineRank,
  dueTone,
  dueWords,
  EXPORT_JOBS,
  extensionBlocker,
  filterRequests,
  isOverdue,
  kindInfo,
  type NextAction,
  OVERDUE_ALERTS,
  REQUEST_KIND_INFO,
  REQUEST_KINDS,
  type RequestFilters,
  type RequestKind,
  type RequestView,
  RULE_INFO,
  requestFilterCount,
  requestFiltersFromQuery,
  requestFiltersToQuery,
  SOURCE_INFO,
  stageSummary,
  subjectDetail,
  subjectTitle,
  summariseRequests,
  UNASSIGNED,
} from "~/utils/data-requests";
import {
  type ColumnState,
  type DataTableColumn,
  type DataTableSort,
  defaultColumnState,
  reconcileColumnState,
} from "~/utils/data-table";
import { formatDate, formatDateTime, relativeTime } from "~/utils/time";
import { nameOf, type ProjectUser } from "~/utils/users";

const projects = useProjectStore();
const store = useDataRequestsStore();
const users = useUsersStore();
const members = useMembersStore();
const route = useRoute();
const router = useRouter();

/* A minute is plenty: what moves here is a count of days. */
const now = useNow({ interval: 60_000 });

const projectId = computed(() => projects.current.id);
const requests = computed(() => store.forProject(projectId.value));
const byId = computed(
  () => new Map(users.forProject(projectId.value).map((user) => [user.id, user])),
);
const people = computed(() => users.forProject(projectId.value));
/* The team is the organisation's rather than this project's: somebody assigned a request,
   or reviewing an extension, is a member of the organisation and reaches every project
   under it. The requests themselves stay project-scoped. */
const team = computed(() => members.forOrg(projects.currentOrg.id));
const me = computed(() => members.currentMember(projects.currentOrg.id));

function userOf(request: DataSubjectRequest): ProjectUser | null {
  return request.subjectUserId === null ? null : (byId.value.get(request.subjectUserId) ?? null);
}

function assigneeName(request: DataSubjectRequest): string {
  if (request.assigneeId === null) return "";
  return team.value.find((member) => member.id === request.assigneeId)?.name ?? "A former member";
}

/** What the page knows about a row's person, so a search finds what the reader sees. */
function describe(request: DataSubjectRequest): string {
  const user = userOf(request);
  return user === null ? "" : [nameOf(user), user.email ?? "", user.phone ?? ""].join(" ");
}

const summary = computed(() => summariseRequests(requests.value, now.value));

/*
 * The filters. The view and the menus are read from the URL on every access and written
 * back on a change; the search is held for the visit.
 */
const search = ref("");
const FILTER_KEYS: readonly string[] = ["view", "type", "owner"];

function queryWithout(keys: readonly string[]) {
  return Object.fromEntries(Object.entries(route.query).filter(([key]) => !keys.includes(key)));
}

const filters = computed<RequestFilters>({
  get: () => requestFiltersFromQuery(route.query, search.value),
  set: (next) => {
    search.value = next.text;
    const wanted = requestFiltersToQuery(next);
    const held = requestFiltersToQuery(requestFiltersFromQuery(route.query));
    if (JSON.stringify(wanted) === JSON.stringify(held)) return;
    void router.replace({ query: { ...queryWithout(FILTER_KEYS), ...wanted } });
  },
});

function patch(change: Partial<RequestFilters>) {
  filters.value = { ...filters.value, ...change };
}

const shown = computed(() => filterRequests(requests.value, filters.value, now.value, describe));

const narrowed = computed(
  () => filters.value.text.trim() !== "" || requestFilterCount(filters.value) > 0,
);

/* `clearable` hands back null, which reads as nothing typed. */
const searchModel = computed({
  get: () => filters.value.text,
  set: (value: string | null) => patch({ text: value ?? "" }),
});

function toggleKind(kind: RequestKind) {
  const held = filters.value.kinds;
  patch({ kinds: held.includes(kind) ? held.filter((entry) => entry !== kind) : [...held, kind] });
}

function clearFilters() {
  patch({ kinds: [], owner: "", text: "" });
}

const ownerLabel = computed(() => {
  const owner = filters.value.owner;
  if (owner === "") return "Owner";
  if (owner === UNASSIGNED) return "Unassigned";
  return team.value.find((member) => member.id === owner)?.name ?? "Owner";
});

/*
 * The counters. Each is the view it counts, so pressing one filters the queue to it and
 * pressing it again goes back to what is open.
 */
interface Counter {
  view: RequestView;
  label: string;
  value: number;
  tone: string;
  idle: string;
}

const counters = computed<Counter[]>(() => {
  const figures = summary.value;
  return [
    {
      view: "overdue",
      label: "Overdue",
      value: figures.overdue,
      tone: figures.overdue > 0 ? "text-error" : "text-ink",
      idle: figures.overdue > 0 ? "Show them" : "None overdue",
    },
    {
      view: "due_soon",
      label: "Due within 7 days",
      value: figures.dueSoon,
      tone: figures.dueSoon > 0 ? "text-warning" : "text-ink",
      idle: figures.dueSoon > 0 ? "Show them" : "None this week",
    },
    {
      view: "open",
      label: "Open",
      value: figures.open,
      tone: "text-ink",
      idle: figures.open > 0 ? "Show them" : "Nothing open",
    },
    {
      view: "closed",
      label: "Closed",
      value: figures.closed,
      tone: "text-ink",
      idle: figures.closed > 0 ? "Show them" : "None closed",
    },
  ];
});

function showView(view: RequestView) {
  patch({ view: filters.value.view === view && view !== "open" ? "open" : view });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The heading states what the queue shows, over the rows it actually shows. */
const heading = computed(() => {
  const count = shown.value.length;
  switch (filters.value.view) {
    case "open": {
      if (count === 0) return "Nothing open";
      const late = shown.value.filter((request) => isOverdue(request, now.value)).length;
      return late > 0
        ? `${late} of ${plural(count, "open request")} overdue`
        : `${plural(count, "open request")}, none overdue`;
    }
    case "overdue":
      return count === 0 ? "Nothing overdue" : `${plural(count, "request")} overdue`;
    case "due_soon":
      return count === 0
        ? "Nothing due this week"
        : `${plural(count, "request")} due within 7 days`;
    case "closed":
      return count === 0 ? "Nothing closed" : plural(count, "closed request");
    case "all":
      return plural(count, "request");
  }
});

const empty = computed(() => {
  if (requests.value.length === 0) {
    return {
      title: "No requests yet",
      text: "When somebody asks what you hold about them, or asks for it to be corrected or erased, log it here. The deadline runs from when it reached you.",
    };
  }
  if (narrowed.value) {
    return {
      title: "No requests match",
      text: "Nothing in this view matches the search or the menus. Clear them to see the whole view.",
    };
  }
  switch (filters.value.view) {
    case "overdue":
      return { title: "Nothing is overdue", text: "Every open request is inside its deadline." };
    case "due_soon":
      return {
        title: "Nothing due this week",
        text: "No open request reaches its deadline in the next 7 days.",
      };
    case "open":
      return {
        title: "Nothing open",
        text: "Every request has been answered or refused. Closed ones stay on the record.",
      };
    case "closed":
      return {
        title: "Nothing closed yet",
        text: "A request lands here once it is completed or refused.",
      };
    case "all":
      return { title: "No requests", text: "" };
  }
});

/*
 * The top of the page says what this deployment cannot do before the queue implies it can.
 */
const notice = computed(() => {
  if (!EXPORT_JOBS.running && !OVERDUE_ALERTS.running) {
    return {
      lead: "Exports are not built yet, and nothing pages anybody.",
      rest: "An access or portability request can be logged, verified, refused or extended here, but not answered with a bundle: the request handler that reads the generated field list has no implementation. An overdue request shows in this queue and nowhere else.",
    };
  }
  if (!EXPORT_JOBS.running) {
    return {
      lead: "Exports are not built yet.",
      rest: "An access or portability request can be logged, verified, refused or extended here, but not answered with a bundle.",
    };
  }
  if (!OVERDUE_ALERTS.running) {
    return {
      lead: "Nothing pages anybody when a request goes overdue.",
      rest: "It shows in this queue and nowhere else.",
    };
  }
  return null;
});

/*
 * The queue.
 */
const DUE_TEXT: Record<string, string> = {
  error: "font-medium text-error",
  warning: "text-warning",
  success: "text-ink/75",
  neutral: "text-ink/45",
};

const COLUMNS: readonly DataTableColumn<DataSubjectRequest>[] = [
  {
    key: "subject",
    title: "Subject",
    fixed: true,
    minWidth: 240,
    value: (request) => subjectTitle(request, userOf(request)).toLowerCase(),
  },
  {
    key: "kind",
    title: "Request type",
    width: 150,
    value: (request) => kindInfo(request.kind).label,
  },
  {
    key: "stage",
    title: "Stage",
    width: 184,
    skeleton: "pill",
    value: (request) => stageSummary(request).label,
  },
  /* Sorted by what is left, so closed rows gather after the open ones rather than
     interleaving with them by a deadline nobody is waiting on. */
  { key: "dueAt", title: "Deadline", width: 150, value: deadlineRank },
  {
    key: "assignee",
    title: "Assigned to",
    width: 160,
    value: (request) => assigneeName(request) || "￿",
  },
  { key: "receivedAt", title: "Received", width: 120, mono: true, hidden: true },
  {
    key: "source",
    title: "Source",
    width: 200,
    hidden: true,
    value: (request) => SOURCE_INFO[request.source].label,
  },
  { key: "id", title: "Request ID", width: 190, mono: true, hidden: true },
];

/* A new key, because the column set changed: the old one would bring back columns this
   screen no longer has for anybody who arranged the table before. */
const stored = useLocalStorage<ColumnState>(
  "idenzy.data-requests.queue-columns",
  defaultColumnState(COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});

const sortBy = ref<DataTableSort[]>([{ key: "dueAt", order: "asc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.data-requests.page-size", 10);

watch(
  () => JSON.stringify(filters.value),
  () => {
    page.value = 1;
  },
);

/*
 * The request being read, over the queue and named in the URL so a link opens it.
 */
const detailTitleId = `${useId()}-request`;
const readingId = ref<string | null>(null);
const detailOpen = ref(false);

const reading = computed(
  () => requests.value.find((request) => request.id === readingId.value) ?? null,
);
const readingUser = computed(() => (reading.value === null ? null : userOf(reading.value)));

function inspect(request: DataSubjectRequest) {
  readingId.value = request.id;
  failure.value = "";
  detailOpen.value = true;
}

/* Replaced rather than pushed: opening a request is not a place to step back to. */
watch(detailOpen, (showing) => {
  const rest = queryWithout(["request"]);
  void router.replace({
    query: showing && readingId.value !== null ? { ...rest, request: readingId.value } : rest,
  });
});

onMounted(() => {
  const asked = route.query["request"];
  const id = Array.isArray(asked) ? asked[0] : asked;
  if (typeof id === "string" && id !== "") {
    readingId.value = id;
    detailOpen.value = true;
  }
});

/* A link to a request this project does not have closes rather than hanging open. */
watch([() => store.loading, reading], ([loading, found]) => {
  if (!loading && detailOpen.value && found === null) detailOpen.value = false;
});

/*
 * Writes started from the request itself: assigning, preparing an export, closing.
 */
const busy = ref(false);
const failure = ref("");

async function direct(work: () => Promise<Refusal>) {
  if (busy.value) return;
  busy.value = true;
  failure.value = "";
  try {
    const refusal = await work();
    if (refusal !== null) failure.value = refusal;
  } finally {
    busy.value = false;
  }
}

function assign(memberId: string | null) {
  const request = reading.value;
  if (request === null || request.assigneeId === memberId) return;
  void direct(() => store.assign(projectId.value, request.id, memberId));
}

/*
 * The dialogs a request opens, stacked over it rather than closing it: the reader comes
 * back to the request after each one. Mounted only while open, like every dialog here that
 * writes and then closes.
 */
type Step = "verify" | "erasure" | "correction" | "response" | "refuse" | "extend";

const step = ref<Step | null>(null);
const stepOpen = ref(false);

function ask(which: Step) {
  failure.value = "";
  step.value = which;
  stepOpen.value = true;
}

watch(stepOpen, (showing) => {
  if (!showing) step.value = null;
});

function act(action: NextAction) {
  const request = reading.value;
  if (request === null) return;
  switch (action) {
    case "verify":
      ask("verify");
      return;
    case "prepare_export":
    case "retry_export":
      void direct(() => store.prepareExport(projectId.value, request.id));
      return;
    case "review_erasure":
      ask("erasure");
      return;
    case "record_correction":
      ask("correction");
      return;
    case "record_response":
      ask("response");
      return;
    case "close":
      void direct(() => store.close(projectId.value, request.id));
      return;
    case "wait":
      return;
  }
}

const GONE = "This request is no longer on the project.";

/** Hands a dialog the write for the request being read, whichever it is when sent. */
function forReading<T>(write: (id: string, input: T) => Promise<Refusal>) {
  return (input: T): Promise<Refusal> => {
    const id = readingId.value;
    return id === null ? Promise.resolve(GONE) : write(id, input);
  };
}

const verifySubmit = forReading<VerifyInput>((id, input) =>
  store.verify(projectId.value, id, input),
);
const correctionSubmit = forReading<string>((id, summary) =>
  store.recordCorrection(projectId.value, id, summary),
);
const responseSubmit = forReading<ResponseInput>((id, input) =>
  store.recordResponse(projectId.value, id, input),
);
const refuseSubmit = forReading<RefusalInput>((id, input) =>
  store.refuse(projectId.value, id, input),
);
const extendSubmit = forReading<ExtensionInput>((id, input) =>
  store.extend(projectId.value, id, input),
);

function erasureSubmit(): Promise<Refusal> {
  const id = readingId.value;
  return id === null ? Promise.resolve(GONE) : store.erase(projectId.value, id);
}

/** Who may review an extension: an owner or an admin who is not the reader. */
const reviewers = computed(() =>
  team.value.filter(
    (member) => (member.role === "owner" || member.role === "admin") && member.id !== me.value?.id,
  ),
);

const extensionBlocked = computed(() =>
  reading.value === null
    ? null
    : extensionBlocker(reading.value, now.value, reviewers.value.length),
);

/*
 * Logging one, which opens it straight after: verifying is the next thing to do with it.
 */
const logOpen = ref(false);

function logSubmit(input: IntakeInput): Promise<string> {
  return store.log(projectId.value, input);
}

function logged(id: string) {
  readingId.value = id;
  failure.value = "";
  detailOpen.value = true;
}

/* A dialog belongs to the project it was opened from. */
watch(projectId, () => {
  detailOpen.value = false;
  stepOpen.value = false;
  logOpen.value = false;
  page.value = 1;
});

const expanded = ref(false);
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Data requests">
      <template v-if="!EXPORT_JOBS.running" #badge>
        <StatusBadge label="Exports unavailable" tone="warning" />
      </template>
      <template #description>
        What people have asked
        <span class="font-medium text-ink">{{ projects.current.name }}</span> to do with their
        data, and how long is left to answer each.
      </template>
      <template #actions>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="text"
          @click="logOpen = true"
        >
          Log Request
        </v-btn>
      </template>
    </PageHeader>

    <!-- Before the queue: a list of requests reads as a pipeline that answers them. -->
    <div
      v-if="notice"
      class="flex items-start gap-2.5 rounded-(--idenzy-radius) border border-line bg-surface px-4 py-3"
      role="status"
    >
      <span aria-hidden="true" class="mt-1.5 size-1.5 flex-none rounded-full bg-warning" />
      <p class="m-0 text-sm text-ink">
        {{ notice.lead }}
        <span class="text-ink/60">{{ notice.rest }}</span>
      </p>
    </div>

    <!--
      The counters, as a strip. Each is a view of the queue, so it is a toggle and not a
      tile: pressed, the queue under it shows what it counts.
    -->
    <div
      aria-label="Show requests"
      class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
      role="group"
    >
      <button
        v-for="counter in counters"
        :key="counter.view"
        :aria-pressed="filters.view === counter.view"
        class="relative flex min-w-0 cursor-pointer flex-col items-start gap-1.5 bg-surface px-4 py-3.5 text-left transition-colors duration-150 hover:bg-ink/3 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        type="button"
        @click="showView(counter.view)"
      >
        <span class="text-xs text-ink/55">{{ counter.label }}</span>
        <span
          v-if="store.loading"
          aria-hidden="true"
          class="h-5 w-10 animate-pulse rounded-full bg-ink/8"
        />
        <span
          v-else
          :class="counter.tone"
          class="font-mono text-lg leading-6 font-medium tabular-nums"
        >
          {{ counter.value }}
        </span>
        <span
          :class="filters.view === counter.view ? 'font-medium text-ink' : 'text-ink/50'"
          class="text-xs"
        >
          {{ filters.view === counter.view ? "Showing" : counter.idle }}
        </span>
        <span
          v-if="filters.view === counter.view"
          aria-hidden="true"
          class="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
        />
      </button>
    </div>

    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">{{ heading }}</h2>
          <p class="m-0 text-xs text-ink/55">
            Soonest deadline first. The clock runs from when a request reached you, not from
            when it was logged here.
          </p>
        </div>
        <button
          v-if="filters.view !== 'all' && requests.length > 0"
          class="text-xs font-medium text-ink/60 transition-colors duration-150 hover:text-ink"
          type="button"
          @click="patch({ view: 'all' })"
        >
          Show all {{ requests.length }}
        </button>
      </header>

      <v-card border flat>
        <div class="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
          <SearchField
            v-model="searchModel"
            label="Search requests"
            placeholder="Search a person, a reference or an id"
            class="w-full sm:max-w-sm"
          />

          <div class="flex flex-wrap items-center gap-2 sm:ml-auto">
            <v-menu :close-on-content-click="false" :offset="6" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  class="idenzy-toolbar-control text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:filter-list"
                  size="small"
                  variant="text"
                >
                  Type
                  <span
                    v-if="filters.kinds.length > 0"
                    class="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-on-primary tabular-nums"
                  >
                    {{ filters.kinds.length }}
                  </span>
                </v-btn>
              </template>
              <v-card class="w-64" flat>
                <ul class="m-0 flex list-none flex-col p-2">
                  <li v-for="kind in REQUEST_KINDS" :key="kind">
                    <label
                      class="flex h-8 cursor-pointer items-center gap-1 rounded-(--idenzy-radius-x-small) pr-2 text-xs text-ink transition-colors duration-150 hover:bg-ink/4"
                    >
                      <v-checkbox-btn
                        :model-value="filters.kinds.includes(kind)"
                        color="primary"
                        density="compact"
                        @update:model-value="toggleKind(kind)"
                      />
                      <Icon
                        :name="REQUEST_KIND_INFO[kind].icon"
                        aria-hidden="true"
                        class="flex-none text-sm text-ink/55"
                      />
                      <span class="truncate">{{ REQUEST_KIND_INFO[kind].label }}</span>
                    </label>
                  </li>
                </ul>
                <div class="flex items-center justify-between border-t border-line px-3 py-2">
                  <p class="m-0 text-[11px] text-ink/50">
                    {{
                      filters.kinds.length === 0
                        ? "Every type"
                        : `${filters.kinds.length} of ${REQUEST_KINDS.length}`
                    }}
                  </p>
                  <button
                    :disabled="filters.kinds.length === 0"
                    class="text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink disabled:text-ink/30"
                    type="button"
                    @click="patch({ kinds: [] })"
                  >
                    Clear
                  </button>
                </div>
              </v-card>
            </v-menu>

            <v-menu :offset="6" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  :class="filters.owner === '' ? '' : 'text-primary'"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:assignment-ind-outline"
                  size="small"
                  variant="text"
                >
                  {{ ownerLabel }}
                  <Icon
                    aria-hidden="true"
                    class="ml-0.5 text-base"
                    name="material-symbols:keyboard-arrow-down"
                  />
                </v-btn>
              </template>
              <v-list density="compact" min-width="240" nav>
                <v-list-item
                  :active="filters.owner === ''"
                  title="Anyone"
                  @click="patch({ owner: '' })"
                />
                <v-list-item
                  :active="filters.owner === UNASSIGNED"
                  title="Unassigned"
                  @click="patch({ owner: UNASSIGNED })"
                />
                <v-divider class="my-1" />
                <v-list-item
                  v-for="member in team"
                  :key="member.id"
                  :active="filters.owner === member.id"
                  :subtitle="member.id === me?.id ? 'You' : member.email"
                  :title="member.name"
                  @click="patch({ owner: member.id })"
                />
              </v-list>
            </v-menu>

            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
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
          item-value="id"
          label="Data requests"
        >
          <!-- The way in, as a person's name is on the users list. Below `sm` the type, the
               stage and the deadline ride along, because the columns that carry them have
               scrolled away and a subject alone is not enough to decide on. -->
          <template #cell.subject="{ item }">
            <button
              class="flex w-full min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-(--idenzy-radius-x-small) py-1 text-left transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="inspect(item)"
            >
              <span class="w-full truncate text-xs font-medium text-ink">
                {{ subjectTitle(item, userOf(item)) }}
              </span>
              <span
                :class="item.subjectUserId === null ? 'text-ink/45' : 'font-mono text-ink/55'"
                class="w-full truncate text-[11px]"
              >
                {{ subjectDetail(item, userOf(item)) }}
              </span>
              <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                <span class="text-[11px] text-ink/60">{{ kindInfo(item.kind).label }}</span>
                <StatusBadge :label="stageSummary(item).label" :tone="stageSummary(item).tone" />
                <span :class="DUE_TEXT[dueTone(item, now)]" class="text-[11px]">
                  {{ dueWords(item, now) }}
                </span>
              </span>
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

          <template #cell.stage="{ item }">
            <StatusBadge :label="stageSummary(item).label" :tone="stageSummary(item).tone" />
          </template>

          <template #cell.dueAt="{ item }">
            <v-tooltip
              :text="`Due ${formatDate(item.dueAt)} · ${RULE_INFO[item.rule].label}${item.extension ? ', extended' : ''}`"
              location="top"
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip" :class="DUE_TEXT[dueTone(item, now)]" class="whitespace-nowrap">
                  {{ dueWords(item, now) }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.assignee="{ item }">
            <span v-if="assigneeName(item)" class="truncate text-ink/80">
              {{ assigneeName(item) }}
            </span>
            <span v-else class="text-ink/40">Unassigned</span>
          </template>

          <template #cell.receivedAt="{ item }">
            <v-tooltip :text="formatDateTime(item.receivedAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                  {{ relativeTime(item.receivedAt, now) }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.source="{ item }">
            <span class="flex min-w-0 items-center gap-1.5">
              <Icon
                :name="SOURCE_INFO[item.source].icon"
                aria-hidden="true"
                class="flex-none text-sm text-ink/50"
              />
              <span class="truncate text-ink/80">
                {{ item.reference || SOURCE_INFO[item.source].label }}
              </span>
            </span>
          </template>

          <template #cell.id="{ item }">
            <span class="font-mono text-[11px] text-ink/65">{{ item.id }}</span>
          </template>

          <template #actions="{ item }">
            <button
              :aria-label="`Open the request from ${subjectTitle(item, userOf(item))}`"
              class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="inspect(item)"
            >
              <Icon aria-hidden="true" class="text-base" name="material-symbols:chevron-right" />
            </button>
          </template>

          <template #empty>
            <div class="flex flex-col items-center gap-1 px-4 py-14 text-center">
              <Icon
                :class="
                  requests.length > 0 && !narrowed && filters.view === 'overdue'
                    ? 'text-success/70'
                    : 'text-ink/25'
                "
                :name="
                  requests.length === 0
                    ? 'material-symbols:folder-managed-outline'
                    : narrowed
                      ? 'material-symbols:search'
                      : 'material-symbols:check-circle-outline'
                "
                aria-hidden="true"
                class="mb-1 text-2xl"
              />
              <p class="m-0 text-sm font-medium text-ink">{{ empty.title }}</p>
              <p v-if="empty.text" class="m-0 max-w-sm text-xs text-ink/55">{{ empty.text }}</p>
              <v-btn
                v-if="narrowed"
                class="mt-2 text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="clearFilters"
              >
                Clear filters
              </v-btn>
              <v-btn
                v-else-if="requests.length === 0"
                class="mt-2 text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:add"
                size="small"
                variant="text"
                @click="logOpen = true"
              >
                Log request
              </v-btn>
              <v-btn
                v-else-if="filters.view !== 'all'"
                class="mt-2 text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="patch({ view: 'all' })"
              >
                Show every request
              </v-btn>
            </div>
          </template>
        </DataTable>

        <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
          Every change to a request is written to the audit log.
        </p>
      </v-card>
    </section>

    <LayerCard
      v-model:open="expanded"
      description="What each type asks for, how a deadline is counted, and what the request row holds."
      expandable
      title="How a request is answered"
    >
      <div class="divide-y divide-line">
        <SettingRow
          v-for="kind in REQUEST_KINDS"
          :key="kind"
          :description="REQUEST_KIND_INFO[kind].detail"
          :fixed="REQUEST_KIND_INFO[kind].article"
          :label="REQUEST_KIND_INFO[kind].label"
        />
        <SettingRow
          v-for="rule in DEADLINE_RULES"
          :key="rule"
          :description="RULE_INFO[rule].note"
          :fixed="RULE_INFO[rule].period"
          :label="`Deadline under ${RULE_INFO[rule].label}`"
        />
        <SettingRow :description="CALENDAR_NOTE" fixed="Calendar" label="How the date is counted" />
        <SettingRow
          description="The columns an export returns and the ones an erasure acts on are generated from the schema, from every column declared through classified(). Nobody keeps a list, which is what stops an export quietly missing a column added two years from now."
          fixed="Generated"
          label="What a request covers"
        />
        <SettingRow
          :description="`A bundle holds everything about a person, so it is kept ${ARTIFACT_TTL_DAYS} days and then deleted. The export and the answer stay on the request: meeting the obligation is the record, and keeping the copy is not.`"
          :fixed="`${ARTIFACT_TTL_DAYS} days`"
          label="How long a bundle lives"
        />
        <SettingRow
          description="The account as a tombstone, the pseudonymous id on audit entries, the address and user agent on those entries under Art. 17(3)(b), and the request itself with the account id, as proof it ran."
          fixed="Four things"
          label="What an erasure keeps"
        />
        <SettingRow
          :description="
            OVERDUE_ALERTS.running
              ? 'An overdue request pages whoever is on call for the project.'
              : OVERDUE_ALERTS.reason
          "
          :fixed="OVERDUE_ALERTS.running ? 'Paging' : 'Not built'"
          label="When one goes overdue"
        />
        <SettingRow
          description="The request row holds its type, status, receipt, deadline, completion and the bundle's link. Where it came from, who has it, the rule, the verification, an extension and the records under it are proposed columns, held by this screen until the management API has them."
          fixed="Proposed"
          label="What the request row holds"
        />
      </div>
    </LayerCard>

    <DataRequestDetailDialog
      v-if="detailOpen && reading"
      v-model="detailOpen"
      :busy="busy"
      :extension-blocked="extensionBlocked"
      :failure="failure"
      :members="team"
      :now="now"
      :request="reading"
      :title-id="detailTitleId"
      :user="readingUser"
      @act="act"
      @assign="assign"
      @extend="ask('extend')"
      @refuse="ask('refuse')"
    />

    <DataRequestLogDialog
      v-if="logOpen"
      v-model="logOpen"
      :current-member-id="me?.id ?? null"
      :members="team"
      :project-name="projects.current.name"
      :submit="logSubmit"
      :users="people"
      @logged="logged"
    />

    <template v-if="reading && step">
      <DataRequestVerifyDialog
        v-if="step === 'verify'"
        v-model="stepOpen"
        :request="reading"
        :submit="verifySubmit"
        :users="people"
      />
      <DataRequestErasureDialog
        v-else-if="step === 'erasure' && readingUser"
        v-model="stepOpen"
        :request="reading"
        :submit="erasureSubmit"
        :user="readingUser"
      />
      <DataRequestCorrectionDialog
        v-else-if="step === 'correction'"
        v-model="stepOpen"
        :request="reading"
        :submit="correctionSubmit"
        :user="readingUser"
      />
      <DataRequestResponseDialog
        v-else-if="step === 'response'"
        v-model="stepOpen"
        :now="now"
        :request="reading"
        :submit="responseSubmit"
      />
      <DataRequestRefuseDialog
        v-else-if="step === 'refuse'"
        v-model="stepOpen"
        :now="now"
        :request="reading"
        :subject="subjectTitle(reading, readingUser)"
        :submit="refuseSubmit"
      />
      <DataRequestExtendDialog
        v-else-if="step === 'extend'"
        v-model="stepOpen"
        :now="now"
        :request="reading"
        :reviewers="reviewers"
        :submit="extendSubmit"
      />
    </template>
  </div>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}

:deep(.v-selection-control:not(.v-selection-control--dirty) .v-selection-control__input > .v-icon) {
  color: rgba(var(--v-theme-on-surface), 0.35);
}
</style>
