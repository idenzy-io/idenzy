<script setup lang="ts">
/**
 * Recovery codes for the project, arranged as `notes/mfa-recovery.md` asks: a support
 * queue first, the account somebody picked out of it second, and everything the server
 * decided folded at the foot.
 *
 * The queue used to name people it could not help. Clearing somebody's codes is not the
 * remedy for somebody who has none, so what a picked row opens is context and the steps
 * its owner takes, written to be pasted into a ticket; invalidating what is left is real,
 * and it sits under Advanced one click further away than the thing that helps. There is
 * still no way to generate a set for somebody else, and there will not be: the codes are
 * returned exactly once and only digests are kept, so an operator who could regenerate
 * would be handed ten working credentials for an account that is not theirs.
 *
 * The word "sheet" is gone. A customer reads recovery codes, so the noun is a set and
 * every label says codes; "No codes remaining" and "Never generated" are written out
 * because they are different answers that both read as zero to the server, and because a
 * bar of pips must never be the only thing carrying a state.
 *
 * The one control is a threshold, and it belongs to this dashboard rather than to the
 * server: it decides which accounts this queue and the security centre flag as running
 * low, and nothing about a sign-in changes when it moves. It says so where it is set.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { TOTP } from "~/utils/mfa";
import { humanizeSeconds } from "~/utils/otp";
import {
  CODE_SET,
  countByState,
  factorLabel,
  LOW_THRESHOLD_MAX,
  LOW_THRESHOLD_MIN,
  matchesFilter,
  queueHeading,
  type RecoveryFilter,
  type RecoverySet,
  type RecoveryState,
  ROUTES,
  remainingLabel,
  SAMPLE_RECOVERY_CODE,
  STATE_LABELS,
  STATE_TEXT,
  stateOf,
  THRESHOLD_ISSUE,
  tallyBuckets,
} from "~/utils/recovery";
import { formatDateTime, relativeTime } from "~/utils/time";
import { matchesQuery, nameOf, type ProjectUser } from "~/utils/users";

const projects = useProjectStore();
const store = useRecoveryStore();
const users = useUsersStore();
const { lgAndUp } = useDisplay();

/* Half a minute is finer than any figure here: the coarsest relative time is the minute. */
const now = useNow({ interval: 30_000 });

const settings = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));

/** An account's codes and the person holding them, which is the only shape this reads. */
interface CodeRow {
  /** The user id, which is what the table tells rows apart by. */
  id: string;
  user: ProjectUser;
  set: RecoverySet;
  state: RecoveryState;
}

const rows = computed<CodeRow[]>(() => {
  const byId = new Map(users.forProject(projects.current.id).map((user) => [user.id, user]));
  const threshold = settings.value.lowThreshold;
  const found: CodeRow[] = [];
  for (const set of store.setsFor(projects.current.id)) {
    const user = byId.get(set.userId);
    if (user === undefined) continue;
    found.push({ id: set.userId, user, set, state: stateOf(set, threshold) });
  }
  return found;
});

const counts = computed(() =>
  countByState(
    rows.value.map((row) => row.set),
    settings.value.lowThreshold,
  ),
);

/*
 * Which accounts the list shows. It opens on the ones with nothing left, because that is
 * the state somebody has to do something about; the counts on the other two segments say
 * whether there is anything to move on to.
 */
const filter = ref<RecoveryFilter>("risk");

const FILTERS: readonly RecoveryFilter[] = ["risk", "low", "all"];

function isFilter(value: string): value is RecoveryFilter {
  return (FILTERS as readonly string[]).includes(value);
}

const filterTab = computed<string>({
  get: () => filter.value,
  set: (value) => {
    if (isFilter(value)) filter.value = value;
  },
});

const filterOptions = computed<SegmentedOption[]>(() => [
  { value: "risk", label: `Out of codes · ${counts.value.risk}` },
  { value: "low", label: `Running low · ${counts.value.low}` },
  { value: "all", label: `All enrolled accounts · ${counts.value.all}` },
]);

/* `clearable` hands back null, which reads as nothing typed. */
const search = ref("");
const query = computed<string | null>({
  get: () => search.value,
  set: (value) => {
    search.value = value ?? "";
  },
});

/** By name, for a tie in codes: two accounts on their last code order the same way twice. */
function byName(a: CodeRow, b: CodeRow): number {
  const left = nameOf(a.user).toLowerCase();
  const right = nameOf(b.user).toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/*
 * Fewest codes first, which is the queue's own order and the table's default sort. The
 * page owns it so the row the panel opens on is the row at the top of the list; a reader
 * who sorts by another column still gets what they asked for, because the table sorts
 * what it is given.
 */
const filtered = computed(() =>
  rows.value
    .filter(
      (row) =>
        matchesFilter(row.set, filter.value, settings.value.lowThreshold) &&
        matchesQuery(row.user, search.value),
    )
    .sort((a, b) => a.set.remaining - b.set.remaining || byName(a, b)),
);

const STATE_TONES: Record<RecoveryState, BadgeTone> = {
  healthy: "success",
  low: "warning",
  none: "error",
};

const COLUMNS: readonly DataTableColumn<CodeRow>[] = [
  {
    key: "user",
    title: "Account",
    fixed: true,
    minWidth: 240,
    value: (row) => nameOf(row.user).toLowerCase(),
  },
  {
    key: "remaining",
    title: "Remaining",
    width: 210,
    skeleton: "glyphs",
    value: (row) => row.set.remaining,
  },
  {
    key: "factors",
    title: "Second factor",
    width: 180,
    value: (row) => factorLabel(row.set),
  },
  {
    key: "issuedAt",
    title: "Last generated",
    mono: true,
    width: 140,
    value: (row) => row.set.issuedAt ?? "",
  },
  {
    key: "state",
    title: "Flagged as",
    width: 130,
    skeleton: "pill",
    hidden: true,
    value: (row) => row.set.remaining,
  },
  {
    key: "lastUsedAt",
    title: "Code last used",
    mono: true,
    width: 140,
    hidden: true,
    value: (row) => row.set.lastUsedAt ?? "",
  },
];

const stored = useLocalStorage<ColumnState>("idenzy.recovery.columns", defaultColumnState(COLUMNS));
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});
const sortBy = ref<DataTableSort[]>([{ key: "remaining", order: "asc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.recovery.page-size", 10);

/*
 * The account on show under the list.
 *
 * A queue is opened to work through, so the first row is already picked and a reader
 * lands on somebody rather than on an empty panel. A phone has no room for both, so
 * there the same card is a full-height sheet that View opens.
 */
const picked = ref<string | null>(null);
const sheetOpen = ref(false);

const selected = computed(() => filtered.value.find((row) => row.id === picked.value) ?? null);

/* Follows the list: a row filtered or searched away hands the panel to the first row left. */
watch(
  filtered,
  (list) => {
    if (list.some((row) => row.id === picked.value)) return;
    picked.value = list[0]?.id ?? null;
    sheetOpen.value = false;
  },
  { immediate: true },
);

function pick(row: CodeRow) {
  picked.value = row.id;
  if (!lgAndUp.value) sheetOpen.value = true;
}

/*
 * Saving. The threshold is the only field and clearing is the only action, so both go
 * through the same busy set the other screens use.
 */
const busy = ref<Set<string>>(new Set());

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

const thresholdDialog = ref(false);

function confirmThreshold(value: number) {
  if (value === settings.value.lowThreshold) return;
  void whileBusy("threshold", () => store.patch(projects.current.id, { lowThreshold: value }));
}

/* The account being cleared, held here rather than read off the selection, so the dialog
   keeps its subject while it closes. */
const clearing = ref<CodeRow | null>(null);
const clearDialog = ref(false);

function askClear(row: CodeRow | null) {
  if (row === null) return;
  clearing.value = row;
  clearDialog.value = true;
}

function confirmClear() {
  const row = clearing.value;
  if (row === null) return;
  void whileBusy(row.id, () => store.clearCodes(projects.current.id, row.id));
}

/* A dialog and a sheet both belong to the project they were opened from. */
watch(
  () => projects.current.id,
  () => {
    clearDialog.value = false;
    clearing.value = null;
    sheetOpen.value = false;
  },
);

/*
 * How the project's sets are spread, and what the last thirty days did to them. Both sit
 * under the queue: they are context for a decision, not the decision.
 */
const buckets = computed(() => tallyBuckets(rows.value.map((row) => row.set)));

/* Which reference cards start unfolded. None of them: they are reference. */
const expanded = reactive({ lifecycle: false, format: false, never: false });

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.io/docs/mfa/recovery";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Recovery codes">
      <template #description>
        The way back into an account on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> when the second
        factor is gone. {{ CODE_SET.codes }} single-use codes per account, issued with the
        first factor and shown exactly once.
      </template>
      <template #actions>
        <v-btn
          :href="GUIDES_URL"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:menu-book-outline"
          rel="noopener"
          size="small"
          target="_blank"
          variant="outlined"
        >
          Recovery guide
        </v-btn>
      </template>
    </PageHeader>

    <!--
      The queue. The heading states the finding rather than naming the screen a second
      time, and the line under it answers the question the list cannot: who is listed at
      all, which is every account holding a second factor and nobody else.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ store.loading ? "Reading the project's accounts" : queueHeading(counts) }}
        </h2>
        <p class="m-0 text-xs text-ink/55">
          Every account holding a second factor is listed here, because that is exactly when
          codes exist: they arrive with the first factor and go with the last. An account
          with no second factor has none and is not counted.
        </p>
      </header>

      <v-card border flat>
        <div
          class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl v-model="filterTab" :options="filterOptions" label="Accounts" />

          <div class="flex flex-wrap items-center gap-2">
            <v-text-field
              v-model="query"
              aria-label="Search accounts"
              class="recovery__search w-full sm:w-64"
              clearable
              density="comfortable"
              hide-details
              placeholder="Search name, email, phone or ID"
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />
            <!-- Secondary, at the list's top right, and named as the dashboard preference
                 it is: the server has no opinion about a set until the last code is spent. -->
            <v-tooltip
              location="top"
              max-width="280"
              text="A dashboard warning only. It decides which accounts this queue and the security centre flag as running low, and nothing about a sign-in."
            >
              <template #activator="{ props: tip }">
                <v-btn
                  v-bind="tip"
                  :loading="isBusy('threshold')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:flag-outline"
                  size="small"
                  variant="outlined"
                  @click="thresholdDialog = true"
                >
                  Warning threshold: {{ settings.lowThreshold }}
                </v-btn>
              </template>
            </v-tooltip>
            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
          </div>
        </div>

        <DataTable
          v-model:column-state="columnState"
          v-model:items-per-page="pageSize"
          v-model:page="page"
          v-model:sort-by="sortBy"
          :columns="COLUMNS"
          :items="filtered"
          :loading="store.loading"
          label="Accounts by recovery codes"
        >
          <template #cell.user="{ item }">
            <UserIdentity :user="item.user">
              <!-- What a phone has to keep beside the person: the count in words and the
                   factor they can still sign in with. Both columns are off the side of a
                   narrow screen, and a row of pips alone would leave the state to colour. -->
              <template #below>
                <span class="mt-1 flex items-center gap-1.5 text-[11px] lg:hidden">
                  <span :class="item.set.issuedAt === null ? 'text-ink/45' : STATE_TEXT[item.state]">
                    {{ remainingLabel(item.set) }}
                  </span>
                  <span class="text-ink/30">·</span>
                  <span class="truncate text-ink/55">{{ factorLabel(item.set) }}</span>
                </span>
              </template>
            </UserIdentity>
          </template>

          <!-- The pips are the shape of the count and the words are the count: an account
               that never generated a set is not one spent to its last code, and neither is
               ever told apart by colour alone. -->
          <template #cell.remaining="{ item }">
            <span class="flex items-center gap-2.5">
              <RecoveryPips :remaining="item.set.remaining" :state="item.state" />
              <span
                :class="item.set.issuedAt === null ? 'text-ink/45' : STATE_TEXT[item.state]"
                class="truncate text-xs"
              >
                {{ remainingLabel(item.set) }}
              </span>
            </span>
          </template>

          <template #cell.factors="{ item }">
            <span class="flex items-center gap-2">
              <span aria-hidden="true" class="flex h-4 w-5 flex-none items-center justify-center">
                <Icon
                  class="text-[15px] text-ink/50"
                  name="material-symbols:shield-lock-outline"
                />
              </span>
              <span class="truncate text-xs text-ink/80">{{ factorLabel(item.set) }}</span>
            </span>
          </template>

          <template #cell.state="{ item }">
            <StatusBadge :label="STATE_LABELS[item.state]" :tone="STATE_TONES[item.state]" />
          </template>

          <template #cell.issuedAt="{ item }">
            <span v-if="item.set.issuedAt === null" class="text-ink/35">Never</span>
            <v-tooltip v-else :text="formatDateTime(item.set.issuedAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                  {{ relativeTime(item.set.issuedAt, now) }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.lastUsedAt="{ item }">
            <span v-if="item.set.lastUsedAt === null" class="text-ink/35">Never</span>
            <v-tooltip v-else :text="formatDateTime(item.set.lastUsedAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                  {{ relativeTime(item.set.lastUsedAt, now) }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <!-- The row's own action is to look, never to clear: the actions column is
               pinned at the row's end, so on a phone the account and this stay together
               however far the middle has scrolled. -->
          <template #actions="{ item }">
            <v-btn
              :aria-label="`View ${nameOf(item.user)}`"
              :class="item.id === picked && lgAndUp ? 'text-ink' : 'text-ink/60'"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="pick(item)"
            >
              <!-- Named for what it is doing, so the panel below is tied to a row rather
                   than to whichever account it happened to open on. -->
              {{ item.id === picked && lgAndUp ? "Viewing" : "View" }}
            </v-btn>
          </template>

          <template #empty>
            <div class="flex flex-col items-center gap-1 px-4 py-14 text-center">
              <Icon
                :class="filter === 'all' || search !== '' ? 'text-ink/25' : 'text-success/70'"
                :name="
                  filter === 'all' || search !== ''
                    ? 'material-symbols:search-off'
                    : 'material-symbols:check-circle-outline'
                "
                aria-hidden="true"
                class="mb-1 text-2xl"
              />
              <p class="m-0 text-sm font-medium text-ink">
                {{
                  search !== ""
                    ? "Nobody here matches that search"
                    : filter === "risk"
                      ? "Nobody is out of codes"
                      : filter === "low"
                        ? "No account is running low"
                        : "No second factor on this project yet"
                }}
              </p>
              <p class="m-0 max-w-sm text-xs text-ink/55">
                {{
                  search !== ""
                    ? "The search covers the name, the email, the phone and the user ID of the accounts in this segment."
                    : filter === "all"
                      ? "An account appears the moment somebody confirms an authenticator, because that is the reply the codes come back in."
                      : `Every account on the project still has more than ${settings.lowThreshold} codes left. Nothing to do.`
                }}
              </p>
            </div>
          </template>
        </DataTable>
      </v-card>
    </section>

    <!--
      The account picked out of the queue. Inline under the list where there is room for
      both, and a full-height sheet where there is not.
    -->
    <v-card v-if="lgAndUp && selected" border flat>
      <RecoveryAccountCard
        :busy="isBusy(selected.id)"
        :guide-url="GUIDES_URL"
        :set="selected.set"
        :state="selected.state"
        :user="selected.user"
        @clear="askClear(selected)"
      />
    </v-card>

    <!-- Named for a screen reader by the account it is about: the card's own heading is
         the person, and a person's name is not a heading (notes/dialogs.md). -->
    <v-dialog
      v-model="sheetOpen"
      :aria-label="selected ? `Recovery codes for ${nameOf(selected.user)}` : 'Recovery codes'"
      fullscreen
      transition="dialog-bottom-transition"
    >
      <v-card v-if="selected" flat>
        <RecoveryAccountCard
          :busy="isBusy(selected.id)"
          :guide-url="GUIDES_URL"
          :set="selected.set"
          :state="selected.state"
          :user="selected.user"
          closable
          @clear="askClear(selected)"
          @close="sheetOpen = false"
        />
      </v-card>
    </v-dialog>

    <!--
      Where the project stands, after the task rather than before it. The spread is a
      strip of counts and not a row of bars: the question it answers is how much of the
      project is near the edge, and a bar of 3 beside a bar of 140 answers it worse.
    -->
    <section class="flex flex-col gap-4">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Where the project's codes stand</h2>
        <p class="m-0 text-xs text-ink/55">
          Accounts by how much of their set is left, then what the last 30 days did.
        </p>
      </header>

      <div
        class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 lg:grid-cols-5"
      >
        <div
          v-for="bucket in buckets"
          :key="bucket.id"
          class="flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5"
        >
          <span class="text-xs text-ink/55">{{ bucket.label }}</span>
          <span
            v-if="store.loading"
            aria-hidden="true"
            class="h-5 w-12 animate-pulse rounded-full bg-ink/8"
          />
          <span v-else class="flex min-w-0 items-baseline gap-1.5">
            <span
              :class="bucket.count === 0 ? 'text-ink/35' : bucket.tone || 'text-ink'"
              class="font-mono text-lg leading-6 font-medium tabular-nums"
            >
              {{ bucket.count }}
            </span>
            <span class="font-mono text-xs text-ink/45 tabular-nums">
              {{ bucket.share }}%
            </span>
          </span>
          <span class="text-xs text-ink/40">
            {{
              bucket.id === "none"
                ? "Nothing to fall back on"
                : bucket.id === "full"
                  ? "Never had a code spent"
                  : `of ${CODE_SET.codes} still unspent`
            }}
          </span>
        </div>
      </div>

      <!-- Three tiles and not four: an untouched-sets tile would print the strip's own
           first cell a second time. -->
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Statistic
          :value="stats.withCodes"
          description="Holding at least one unspent code."
          info="The only number the server publishes about a set is how many codes are unspent, so this is counted from that and nothing else."
          label="Accounts with codes"
        />
        <Statistic
          :value="stats.spent"
          description="Codes spent to get back in."
          info="Each one is a sign-in somebody could not complete any other way, over the last 30 days."
          label="Codes spent"
        />
        <Statistic
          :value="stats.regenerated"
          description="New sets made by their owner."
          info="Replaced from your application over the last 30 days. Every earlier code stopped working at that moment."
          label="Sets replaced"
        />
      </div>
    </section>

    <!-- Reference, folded, at the foot: what the server decided and nobody can change. -->
    <LayerCard
      v-model:open="expanded.lifecycle"
      expandable
      description="A set arrives with the first second factor and leaves with the last one. Everything in between belongs to the person holding it."
      title="Issued, replaced, removed"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="The codes come back in the reply that confirms an authenticator, and only while the account has none unspent. Returning them there rather than leaving it to a call somebody has to remember is deliberate: a customer who forgets that call ships a product where a lost phone is a lost account."
          fixed="Automatic"
          label="Issued with the first factor"
        />
        <SettingRow
          description="Enrolling a second factor does not bring a second set. Reissuing would invalidate the one somebody has already printed, and they would find out on the day they needed it."
          fixed="Never"
          label="Issued again quietly"
        />
        <SettingRow label="Replaced whole, by the owner">
          <template #description>
            <span class="font-mono text-ink/80">{{ ROUTES.regenerate }}</span> deletes every
            code and returns ten new ones, once. Half a set is worse than either state: a
            printout that partly works, with no way to tell which half.
          </template>
        </SettingRow>
        <SettingRow
          description="Ten single-use passwords must not outlive the thing they were the fallback for, on an account whose owner believes they turned two-factor off."
          fixed="Always"
          label="Removed with the last factor"
        />
        <SettingRow
          description="The codes are returned exactly once and only their digests are kept, so a set generated from this screen would either be shown to staff, which is ten working credentials for somebody else's account, or shown to nobody at all. Invalidating one is the action that hands nobody anything."
          fixed="Not offered"
          label="Generated for somebody else"
        />
      </div>

      <SamplePanel
        class="mt-5"
        note="We render no screen in this flow, so the one place a set is ever visible is yours. There is no second chance to read it out of us."
        title="What your application has to show"
      >
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-success"
              name="material-symbols:check-circle-outline"
            />
            <span>
              <span class="font-mono text-ink">{{ ROUTES.confirm }}</span>
              carries the codes on the first factor an account enrols, and null after that.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-success"
              name="material-symbols:check-circle-outline"
            />
            <span>
              <span class="font-mono text-ink">{{ ROUTES.regenerate }}</span>
              is how somebody replaces a set they have lost or half spent.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-ink/40"
              name="material-symbols:info-outline"
            />
            <span>
              <span class="font-mono text-ink">{{ ROUTES.factors }}</span>
              answers with how many are left, which is all anybody can read afterwards.
            </span>
          </li>
        </ul>
      </SamplePanel>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.format"
      expandable
      description="What a code is and how it is kept. None of it is configurable, and each row says why it is what it is."
      title="Code format and storage"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="`Issued together and replaced together. ${CODE_SET.codes} is enough to lose a few and still have a way in, and few enough that a set is something a person will keep.`"
          :fixed="`${CODE_SET.codes} codes`"
          label="One set"
        />
        <SettingRow
          :description="`${CODE_SET.groups} groups of ${CODE_SET.groupLength} from Crockford's base32, which drops ${CODE_SET.dropped} because those are the characters somebody reading off paper gets wrong. Twenty symbols over a thirty-two symbol alphabet is exactly ${CODE_SET.bits} bits.`"
          fixed="Fixed"
          label="What a code looks like"
        >
          <template #detail>
            <p
              class="m-0 inline-flex rounded-(--idenzy-radius-x-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-1.5 font-mono text-[11px] tracking-wide text-ink"
            >
              {{ SAMPLE_RECOVERY_CODE }}
            </p>
          </template>
        </SettingRow>
        <SettingRow
          description="Case and separators are display, so they are dropped before a code is compared, and O is folded onto 0 with I and L onto 1. None of those letters is in the alphabet, so the fold costs nothing and saves the person who read a 0 as an O."
          fixed="Always"
          label="Typed loosely"
        />
        <SettingRow
          :description="`Only the ${CODE_SET.digest} digest of a code is stored, so there is nothing to decrypt and nothing a copy of that table would yield. A plain digest rather than a password hash is a property of the code's own length: ${CODE_SET.bits} bits does not fall to the sweep a six-digit code falls to. A memory-hard hash could not be used here in any case, because a submitted code is checked against every unspent code the account holds.`"
          :fixed="CODE_SET.digest"
          label="Stored as a digest"
        />
        <SettingRow
          description="A code is spent in the same statement that reads it, so two requests cannot spend one. The lookup is scoped to the account as well as to the digest: matching on the digest alone would sign the caller in as whoever the code belonged to."
          fixed="Single use"
          label="Spent once, by one account"
        />
        <SettingRow
          :description="`A challenge lasts ${humanizeSeconds(TOTP.challengeSeconds)} and dies after ${TOTP.attempts} wrong answers, the same cap a one-time code gets. Both are set for the deployment.`"
          fixed="Deployment"
          label="Attempts and lifetime"
        />
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.never"
      expandable
      description="A set is a fallback and nothing else. Four things it is regularly expected to do and does not."
      title="What a recovery code never does"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="A set on its own demands no challenge. It is what a second factor falls back to, and it exists only because one was enrolled, so an account left holding codes alone is not an account with two-factor on."
          fixed="Never"
          label="Turn two-factor on"
        />
        <SettingRow
          description="Spending a single-use code kept for a lost phone in order to confirm an email change spends the wrong thing, and a step-up already has a session, so there is a cheaper way to ask. The challenge offers a passkey and an authenticator, and nothing else."
          fixed="Never"
          label="Answer a step-up"
        />
        <SettingRow
          description="No factor row, no counter, no confirmation step. Ten single-use secrets on a printed sheet of paper are not a device, and giving them a device's record would mean a factor that is enrolled and never used."
          fixed="Never"
          label="Count as a device"
        />
        <SettingRow
          description="A wrong code, a code already crossed off and an account with none are one refusal. Everybody who reaches a challenge has already got past a first factor, which is exactly where a stolen password puts an attacker, and a distinguishable answer would tell them what the account holds."
          fixed="Never"
          label="Say what went wrong"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <NumberDialog
      v-model="thresholdDialog"
      :current="settings.lowThreshold"
      :hint="`Between ${LOW_THRESHOLD_MIN} and ${LOW_THRESHOLD_MAX}. An account at or under this many codes is flagged as running low.`"
      :integer-label="THRESHOLD_ISSUE.integer"
      :max="LOW_THRESHOLD_MAX"
      :min="LOW_THRESHOLD_MIN"
      :range-label="THRESHOLD_ISSUE.range"
      confirm-label="Save warning threshold"
      description="Which accounts this queue and the security centre flag. The server never reads it: a sign-in behaves the same whether an account has ten codes or one."
      label="Flag accounts with this many or fewer codes"
      suffix="codes"
      title="Warning threshold"
      @confirm="confirmThreshold"
    />

    <RecoveryClearDialog
      v-model="clearDialog"
      :busy="clearing !== null && isBusy(clearing.id)"
      :factors="clearing === null ? '' : factorLabel(clearing.set)"
      :remaining="clearing?.set.remaining ?? 0"
      :user="clearing?.user ?? null"
      @confirm="confirmClear"
    />
  </div>
</template>

<style scoped>
/* The toolbar's search, at the height of the small controls beside it. Same block as the
   users and sessions lists, because it is the same field on the same kind of screen. */
.recovery__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.recovery__search :deep(.v-field__input),
.recovery__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
  min-height: 32px;
}

.recovery__search :deep(.v-field__prepend-inner > .v-icon),
.recovery__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
