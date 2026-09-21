<script setup lang="ts">
/**
 * Every user on the current project, as a list an operator works from: find one, see at
 * a glance how they sign in and whether they can, and act on one or many at once.
 *
 * The columns are the `users` table as the management API returns it (PROJECT.md 9),
 * joined with the sign-in methods on the account and its open sessions, and the actions
 * are the four the API offers on a user: create, suspend, sign out everywhere, and
 * delete, the last being an erasure (4.13.6). The list, the filters and the arrangement
 * of columns are all pure functions in `utils/users.ts` and `utils/data-table.ts`, and
 * this file is the wiring between them, the store and the dialogs.
 *
 * The data is the store's placeholder until the management API client exists; nothing
 * here knows the difference, which is the point of the store. The column arrangement
 * and the page size are the reader's and go to local storage.
 *
 * Where the rest of the state lives is a decision and not a detail. The status and the
 * filter facets are in the URL, so a narrowed list can be pasted to a colleague and the
 * totals above the table can link to the rows they count. The search term, the sort and
 * the page are not: a search term is whichever person is being investigated, and an
 * address in a URL is personal data in a browser history, a proxy log and a chat message
 * (notes/shared-experience.md). Those three are held for the visit instead, which is what
 * brings a reader back to the list they left when they return from one user's page.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { AddUserInput } from "~/stores/users";
import {
  type ColumnState,
  type DataTableColumn,
  type DataTableSort,
  defaultColumnState,
  reconcileColumnState,
} from "~/utils/data-table";
import { formatDate, formatDateTime, relativeTime } from "~/utils/time";
import {
  activeFilterCount,
  countByStatus,
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  filterUsers,
  isIndefinite,
  METHOD_LABELS,
  methodIcon,
  nameOf,
  type ProjectUser,
  STATUS_LABELS,
  STATUS_RANK,
  sameQuery,
  statusOf,
  summariseUsers,
  type UserFilters,
  type UserStatus,
  usersToCsv,
} from "~/utils/users";

const projects = useProjectStore();
const store = useUsersStore();
const { copy } = useClipboard();

/* Half a minute is finer than any figure on the screen: the coarsest relative time is
   the minute, and a suspension lapsing is noticed within one. */
const now = useNow({ interval: 30_000 });

const route = useRoute();
const router = useRouter();

const all = computed(() => store.forProject(projects.current.id));
const counts = computed(() => countByStatus(all.value, now.value));
const summary = computed(() => summariseUsers(all.value, now.value));

/* The visit's half of the state: kept in memory so a trip to one user and back lands on
   the list as it was left, and out of the URL so nobody's address ends up in one. */
const { search, sort: sortBy, page, query: lastQuery } = useUsersList();

/* The shareable half: read from the query on every access and written back on a change,
   so the browser's own back button is what restores a narrowing. */
const filters = computed<UserFilters>({
  get: () => filtersFromQuery(route.query, search.value),
  set: (next) => {
    search.value = next.query;
    if (sameQuery(next, filtersFromQuery(route.query))) return;
    void router.replace({ query: filtersToQuery(next) });
  },
});

const filtered = computed(() => filterUsers(all.value, filters.value, now.value));

/* What the back link on one user's page returns to, so a narrowing survives the trip. */
watchEffect(() => {
  lastQuery.value = filtersToQuery(filters.value);
});

/* A narrowed list starts at its own beginning. Page three of everyone is not page three
   of the suspended. */
watch(
  () => [JSON.stringify(filtersToQuery(filters.value)), search.value].join(" "),
  () => {
    page.value = 1;
  },
);

/* Whether anything is narrowing the list, for the empty state to offer a way out. */
const narrowed = computed(
  () =>
    filters.value.status !== "all" ||
    filters.value.query.trim() !== "" ||
    activeFilterCount(filters.value) > 0,
);

function resetFilters() {
  filters.value = { ...EMPTY_FILTERS };
}

/**
 * The strip over the table. Six figures, each of which is a filter this screen already
 * has, so the link under one is the list it counts rather than a different screen. No
 * figure appears twice and none of them is a trend: what happened to sign-ups over a
 * month is the overview's question, not this one's.
 */
const totals = computed(() => [
  {
    label: "Accounts",
    value: summary.value.living.toLocaleString("en"),
    unit: "",
    to: summary.value.deleted > 0 ? "/users?status=deleted" : "",
    action: summary.value.deleted > 0 ? `${summary.value.deleted} erased` : "None erased",
  },
  {
    label: "New in 30 days",
    value: summary.value.joined.toLocaleString("en"),
    unit: "",
    to: summary.value.joined > 0 ? "/users?created=30d" : "",
    action: summary.value.joined > 0 ? "See them" : "Nobody signed up",
  },
  {
    label: "Signed in this week",
    value: summary.value.recent.toLocaleString("en"),
    unit: "",
    to: summary.value.recent > 0 ? "/users?signin=7d" : "",
    action: summary.value.recent > 0 ? "See them" : "Nobody signed in",
  },
  {
    label: "Never signed in",
    value: summary.value.dormant.toLocaleString("en"),
    unit: "",
    to: summary.value.dormant > 0 ? "/users?signin=never" : "",
    action: summary.value.dormant > 0 ? "See them" : "Everyone has",
  },
  {
    label: "Suspended",
    value: summary.value.suspended.toLocaleString("en"),
    unit: "",
    to: summary.value.suspended > 0 ? "/users?status=suspended" : "",
    action: summary.value.suspended > 0 ? "See them" : "None suspended",
  },
  {
    label: "Second factor",
    value: summary.value.mfaShare.toString(),
    unit: "%",
    to: summary.value.mfa > 0 ? "/users?mfa=yes" : "",
    action: summary.value.mfa > 0 ? `${summary.value.mfa} enrolled` : "Nobody enrolled",
  },
]);

const STATUS_TABS: readonly ("all" | UserStatus)[] = ["all", "active", "suspended", "deleted"];

function isStatusTab(value: string): value is "all" | UserStatus {
  return (STATUS_TABS as readonly string[]).includes(value);
}

const statusOptions = computed<SegmentedOption[]>(() =>
  STATUS_TABS.map((tab) => ({
    value: tab,
    label: `${tab === "all" ? "All" : STATUS_LABELS[tab]} · ${counts.value[tab]}`,
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

const STATUS_TONES: Record<UserStatus, BadgeTone> = {
  active: "success",
  suspended: "warning",
  deleted: "neutral",
};

/**
 * The columns. `value` is what a column sorts by where that is not the property itself:
 * a name folded to one case, a status by its rank, a nullable date as the empty string
 * so the accounts without one gather at the far end of a list sorted by recency, and a
 * tombstone after every name.
 */
const COLUMNS: readonly DataTableColumn<ProjectUser>[] = [
  {
    key: "user",
    title: "User",
    fixed: true,
    minWidth: 260,
    value: (user) => (user.deletedAt === null ? nameOf(user).toLowerCase() : "￿"),
  },
  { key: "id", title: "User ID", mono: true, width: 208 },
  { key: "phone", title: "Phone", mono: true, width: 148, value: (user) => user.phone ?? "" },
  {
    key: "methods",
    title: "Sign-in methods",
    width: 148,
    skeleton: "glyphs",
    value: (user) => user.methods.length,
  },
  { key: "mfa", title: "MFA", width: 72, value: (user) => (user.mfaEnabled ? 1 : 0) },
  {
    key: "status",
    title: "Status",
    width: 176,
    skeleton: "pill",
    value: (user) => STATUS_RANK[statusOf(user, now.value)],
  },
  {
    key: "sessions",
    title: "Sessions",
    align: "end",
    mono: true,
    width: 88,
    value: (user) => user.activeSessions,
  },
  {
    key: "lastSignInAt",
    title: "Last sign-in",
    mono: true,
    width: 108,
    value: (user) => user.lastSignInAt ?? "",
  },
  { key: "createdAt", title: "Created", mono: true, width: 156 },
  { key: "updatedAt", title: "Updated", mono: true, width: 156, hidden: true },
  {
    key: "metadata",
    title: "Metadata",
    align: "end",
    mono: true,
    width: 88,
    hidden: true,
    value: (user) => Object.keys(user.metadataPublic).length,
  },
];

/* Reconciled on every read, so a column added in a release appears for a reader who
   arranged the table before it existed. */
const stored = useLocalStorage<ColumnState>("idenzy.users.columns", defaultColumnState(COLUMNS));
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});

const pageSize = useLocalStorage("idenzy.users.page-size", 10);

const selected = ref<string[]>([]);
const selectedUsers = computed(() => all.value.filter((user) => selected.value.includes(user.id)));

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

const suspendable = (users: readonly ProjectUser[]) =>
  users.filter((user) => statusOf(user, now.value) === "active");
const restorable = (users: readonly ProjectUser[]) =>
  users.filter((user) => statusOf(user, now.value) === "suspended");
const signedIn = (users: readonly ProjectUser[]) =>
  users.filter((user) => user.deletedAt === null && user.activeSessions > 0);
const erasable = (users: readonly ProjectUser[]) => users.filter((user) => user.deletedAt === null);

const adding = ref(false);
const suspendOpen = ref(false);
const suspendTargets = ref<ProjectUser[]>([]);
const deleteOpen = ref(false);
const deleteTargets = ref<ProjectUser[]>([]);

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

async function addUser(input: AddUserInput) {
  const user = await store.add(projects.current.id, input);
  notify(`Added ${nameOf(user)}`);
}

function askSuspend(users: readonly ProjectUser[]) {
  suspendTargets.value = suspendable(users);
  if (suspendTargets.value.length > 0) suspendOpen.value = true;
}

/**
 * Awaited, because the notice reports what the server did and not what was asked for.
 * Signing out is a second call by design: a suspension is read on token rotation, so an
 * open session survives it for up to one access-token lifetime.
 */
async function suspend(until: string, signOut: boolean) {
  const ids = suspendTargets.value.map((user) => user.id);
  const count = await store.suspend(ids, until);
  if (signOut) await store.signOutEverywhere(ids);
  notify(`Suspended ${plural(count, "user")}`);
  selected.value = [];
}

async function restore(users: readonly ProjectUser[]) {
  const count = await store.restore(users.map((user) => user.id));
  notify(`Lifted ${plural(count, "suspension")}`);
  selected.value = [];
}

async function signOut(users: readonly ProjectUser[]) {
  const count = await store.signOutEverywhere(users.map((user) => user.id));
  notify(
    count === 0 ? "No open sessions to end" : `Signed out ${plural(count, "user")} everywhere`,
  );
}

function askDelete(users: readonly ProjectUser[]) {
  deleteTargets.value = erasable(users);
  if (deleteTargets.value.length > 0) deleteOpen.value = true;
}

/** Erasure has no endpoint yet, so the refusal is shown rather than a fabricated count. */
async function erase() {
  try {
    const count = await store.remove(deleteTargets.value.map((user) => user.id));
    notify(`Deleted ${plural(count, "user")}`);
    selected.value = [];
  } catch {
    notify("Erasure is not available yet");
  }
}

async function copyText(text: string, what: string) {
  await copy(text);
  notify(`${what} copied`);
}

/* A file the browser saves, named by project and day so two exports do not collide. */
function exportCsv(users: readonly ProjectUser[]) {
  const blob = new Blob([usersToCsv(users, now.value)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `users-${projects.current.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  notify(`Exported ${plural(users.length, "user")}`);
}

function statusDetail(user: ProjectUser): string {
  const status = statusOf(user, now.value);
  if (status === "suspended" && user.bannedUntil !== null) {
    return isIndefinite(user.bannedUntil)
      ? "until lifted"
      : `until ${formatDate(user.bannedUntil)}`;
  }
  if (status === "deleted" && user.deletedAt !== null) return formatDate(user.deletedAt);
  return "";
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Users">
      <template #description>
        Everyone with an account on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>.
      </template>
      <template #actions>
        <v-btn
          :disabled="filtered.length === 0"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="text"
          @click="exportCsv(filtered)"
        >
          Export CSV
        </v-btn>
        <!-- Text and rippled, like the links in the signed-out bar. `ripple` is spelled out
             because the panel turns it off globally and a text button has no fill of its own
             to answer a press with. -->
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:person-add-outline"
          size="small"
          variant="text"
          @click="adding = true"
        >
          Add User
        </v-btn>
      </template>
    </PageHeader>

    <!--
      The totals, as a strip rather than tiles: every figure here is the count of a filter
      the table below can apply, so each one links to its own list and the reader never has
      to build the query by hand. The rules between the cells are the container's own
      background through a one-pixel gap, which is right at all three breakpoints where a
      per-cell border would need turning off at every edge.
    -->
    <div
      class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      <div
        v-for="total in totals"
        :key="total.label"
        class="flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5"
      >
        <span class="text-xs text-ink/55">{{ total.label }}</span>

        <span
          v-if="store.loading"
          aria-hidden="true"
          class="h-5 w-16 animate-pulse rounded-full bg-ink/8"
        />
        <span v-else class="flex min-w-0 items-baseline gap-1">
          <span class="font-mono text-lg leading-6 font-medium text-ink tabular-nums">
            {{ total.value }}
          </span>
          <span v-if="total.unit" class="font-mono text-xs text-ink/45">{{ total.unit }}</span>
        </span>

        <NuxtLink
          v-if="total.to"
          :to="total.to"
          class="text-xs text-ink/55 no-underline transition-colors hover:text-ink"
        >
          {{ total.action }}
        </NuxtLink>
        <span v-else class="text-xs text-ink/40">{{ total.action }}</span>
      </div>
    </div>

    <!--
      The list: a heading on the page, then the card, with the controls that narrow it
      along the top and the table under them. The heading sits above the card rather than
      in a strip inside it, which is where every other section on this panel puts its name,
      and it leaves the card the same object here and on the sessions screen.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Every account</h2>
        <p class="m-0 text-xs text-ink/55">
          Suspended and erased rows stay listed beside the active ones: a tombstone keeps the
          account's id and loses every column that named a person.
        </p>
      </header>

      <v-card border flat>
        <div
          class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl v-model="statusTab" :options="statusOptions" label="Status" />

          <div class="flex flex-wrap items-center gap-2">
            <v-text-field
              v-model="query"
              aria-label="Search users"
              class="users__search w-full sm:w-72"
              clearable
              density="comfortable"
              hide-details
              placeholder="Search name, email, phone or ID"
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />
            <UsersFilterMenu v-model="filters" />
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
          label="Users"
          selectable
        >
          <!-- What can be done to the selection. Each button is off when nothing in the
               selection can take it, so a bar over a mixed selection says which actions
               apply rather than failing on the ones that do not. -->
          <template #selection>
            <v-btn
              :disabled="suspendable(selectedUsers).length === 0"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:block"
              size="small"
              variant="text"
              @click="askSuspend(selectedUsers)"
            >
              Suspend
            </v-btn>
            <v-btn
              :disabled="restorable(selectedUsers).length === 0"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:lock-open-outline"
              size="small"
              variant="text"
              @click="restore(restorable(selectedUsers))"
            >
              Lift suspension
            </v-btn>
            <v-btn
              :disabled="signedIn(selectedUsers).length === 0"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:logout"
              size="small"
              variant="text"
              @click="signOut(signedIn(selectedUsers))"
            >
              Sign out everywhere
            </v-btn>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:download"
              size="small"
              variant="text"
              @click="exportCsv(selectedUsers)"
            >
              Export
            </v-btn>
            <v-btn
              :disabled="erasable(selectedUsers).length === 0"
              class="text-xs font-medium"
              color="error"
              prepend-icon="material-symbols:delete-outline"
              size="small"
              variant="text"
              @click="askDelete(selectedUsers)"
            >
              Delete
            </v-btn>
          </template>

          <!-- The identity is the way in, which is what makes the ellipsis the place for
               everything else. The status rides along below `sm`: at 390px the status
               column sits outside the first viewport, and a suspended account that reads as
               a normal one is the wrong answer to the only question being asked. -->
          <template #cell.user="{ item }">
            <NuxtLink
              :to="`/users/${item.id}`"
              class="group/user -mx-1 block rounded-(--idenzy-radius-x-small) px-1 py-0.5 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <UserIdentity :user="item">
                <template #below>
                  <span class="mt-1 flex sm:hidden">
                    <StatusBadge
                      :detail="statusDetail(item)"
                      :label="STATUS_LABELS[statusOf(item, now)]"
                      :tone="STATUS_TONES[statusOf(item, now)]"
                    />
                  </span>
                </template>
              </UserIdentity>
            </NuxtLink>
          </template>

          <template #cell.id="{ item }">
            <button
              class="group/id inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/65 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="Copy user ID"
              type="button"
              @click="copyText(item.id, 'User ID')"
            >
              <span class="truncate">{{ item.id }}</span>
              <Icon
                aria-hidden="true"
                class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/id:opacity-60"
                name="material-symbols:content-copy-outline"
              />
            </button>
          </template>

          <template #cell.phone="{ item }">
            <span
              v-if="item.phone"
              class="inline-flex items-center gap-1 font-mono text-[11px] text-ink/80 tabular-nums"
            >
              {{ item.phone }}
              <Icon
                v-if="item.phoneVerified"
                aria-label="Verified"
                class="text-[13px] text-success"
                name="material-symbols:verified-outline"
                role="img"
              />
            </span>
            <span v-else class="text-ink/30">–</span>
          </template>

          <template #cell.methods="{ item }">
            <ul v-if="item.methods.length" class="m-0 flex list-none items-center gap-1 p-0">
              <li v-for="method in item.methods" :key="method">
                <v-tooltip :text="METHOD_LABELS[method]" location="top">
                  <template #activator="{ props: tip }">
                    <span
                      v-bind="tip"
                      :aria-label="METHOD_LABELS[method]"
                      class="flex size-6 items-center justify-center rounded-(--idenzy-radius-x-small) bg-ink/4 text-ink/70"
                      role="img"
                    >
                      <Icon
                        :class="methodIcon(method).monochrome ? '[.v-theme--dark_&]:invert' : ''"
                        :name="methodIcon(method).icon"
                        aria-hidden="true"
                        class="text-[13px]"
                      />
                    </span>
                  </template>
                </v-tooltip>
              </li>
            </ul>
            <span v-else class="text-ink/30">–</span>
          </template>

          <template #cell.mfa="{ item }">
            <span v-if="item.deletedAt" class="text-ink/30">–</span>
            <span v-else-if="item.mfaEnabled" class="inline-flex items-center gap-1 text-ink">
              <Icon
                aria-hidden="true"
                class="text-sm text-success"
                name="material-symbols:shield-lock-outline"
              />
              On
            </span>
            <span v-else class="text-ink/40">Off</span>
          </template>

          <template #cell.status="{ item }">
            <StatusBadge
              :detail="statusDetail(item)"
              :label="STATUS_LABELS[statusOf(item, now)]"
              :tone="STATUS_TONES[statusOf(item, now)]"
            />
          </template>

          <template #cell.sessions="{ item }">
            <span
              :class="item.activeSessions > 0 ? 'text-ink' : 'text-ink/30'"
              class="font-mono tabular-nums"
            >
              {{ item.activeSessions }}
            </span>
          </template>

          <template #cell.lastSignInAt="{ item }">
            <span v-if="item.lastSignInAt === null" class="text-ink/35">Never</span>
            <v-tooltip v-else :text="formatDateTime(item.lastSignInAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                  {{ relativeTime(item.lastSignInAt, now) }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.createdAt="{ item }">
            <span class="font-mono text-ink/80 tabular-nums">
              {{ formatDateTime(item.createdAt) }}
            </span>
          </template>

          <template #cell.updatedAt="{ item }">
            <span class="font-mono text-ink/80 tabular-nums">
              {{ formatDateTime(item.updatedAt) }}
            </span>
          </template>

          <template #cell.metadata="{ item }">
            <span
              :class="Object.keys(item.metadataPublic).length > 0 ? 'text-ink' : 'text-ink/30'"
              class="font-mono tabular-nums"
            >
              {{ Object.keys(item.metadataPublic).length }}
            </span>
          </template>

          <template #actions="{ item }">
            <UserRowActions
              :status="statusOf(item, now)"
              :user="item"
              @copy-email="item.email && copyText(item.email, 'Email')"
              @copy-id="copyText(item.id, 'User ID')"
              @remove="askDelete([item])"
              @restore="restore([item])"
              @sign-out="signOut([item])"
              @suspend="askSuspend([item])"
            />
          </template>

          <template #empty>
            <div class="flex flex-col items-center gap-1 px-4 py-14 text-center">
              <Icon
                aria-hidden="true"
                class="mb-1 text-2xl text-ink/25"
                name="material-symbols:person-search-outline"
              />
              <p class="m-0 text-sm font-medium text-ink">
                {{ all.length === 0 ? "No users yet" : "No users match" }}
              </p>
              <p class="m-0 max-w-sm text-xs text-ink/55">
                {{
                  all.length === 0
                    ? "Nobody has signed up on this project. Add one by hand, or import a list."
                    : "Try another search, or clear the filters to see everyone."
                }}
              </p>
              <v-btn
                v-if="narrowed"
                class="mt-2 text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="resetFilters"
              >
                Clear filters
              </v-btn>
            </div>
          </template>
        </DataTable>
      </v-card>
    </section>

    <UserAddDialog v-model="adding" :create="addUser" />
    <UserSuspendDialog v-model="suspendOpen" :users="suspendTargets" @confirm="suspend" />
    <UserDeleteDialog v-model="deleteOpen" :users="deleteTargets" @confirm="erase" />

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
      class="users__toast"
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
   colours are the theme's, in theme.css, and are what every outlined field gets. The
   height is the `comfortable` density's own 32px: pinned here it would reach the field
   and not the control box around it, which takes the variable off the input root. */
.users__search :deep(.v-field) {
  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.users__search :deep(.v-field__input),
.users__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
}

.users__search :deep(.v-field__prepend-inner > .v-icon),
.users__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
