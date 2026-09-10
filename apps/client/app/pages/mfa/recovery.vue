<script setup lang="ts">
/**
 * Recovery codes for the project: who still has a way back in, and the rules the server
 * applies to a sheet (`apps/auth-api/src/mfa`, `@idenzy/crypto/mfa/recovery-codes`).
 *
 * The screen is a list first because there is almost nothing here to configure and one
 * thing worth watching. A sheet is ten codes issued with the account's first second
 * factor, and every rule about it, from the length to the digest to the single use, is
 * the server's and stated here rather than offered. What an operator can act on is an
 * account holding a second factor with nothing left to fall back on, which is a support
 * ticket that has not happened yet, so those accounts are the first thing on the page.
 *
 * The one control is a threshold, and it belongs to this dashboard rather than to the
 * server: it decides when this screen and the security centre call a sheet low, and
 * nothing about a sign-in changes when it moves. It saves itself, like every other
 * setting in the panel.
 *
 * There is deliberately no way to generate a sheet for somebody else. The codes are
 * returned exactly once and only digests are kept, so an operator who could regenerate
 * would be handed ten working credentials for an account that is not theirs. Clearing a
 * sheet is the action that can be taken safely, and the dialog says as much.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { TOTP } from "~/utils/mfa";
import { humanizeSeconds } from "~/utils/otp";
import {
  countByState,
  LOW_THRESHOLD_MAX,
  LOW_THRESHOLD_MIN,
  matchesFilter,
  type RecoverySheet,
  ROUTES,
  roleOf,
  SAMPLE_RECOVERY_CODE,
  SHEET,
  type SheetFilter,
  type SheetState,
  STATE_LABELS,
  stateOf,
  THRESHOLD_ISSUE,
  tallyBuckets,
} from "~/utils/recovery";
import { formatDateTime, relativeTime } from "~/utils/time";
import { nameOf, type ProjectUser } from "~/utils/users";

const projects = useProjectStore();
const store = useRecoveryStore();
const users = useUsersStore();
const { copy } = useClipboard({ legacy: true });

/* Half a minute is finer than any figure here: the coarsest relative time is the minute. */
const now = useNow({ interval: 30_000 });

const settings = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));

/** A sheet and the person holding it, which is the only shape this screen reads. */
interface SheetRow {
  /** The user id, which is what the table tells rows apart by. */
  id: string;
  user: ProjectUser;
  sheet: RecoverySheet;
  state: SheetState;
}

const rows = computed<SheetRow[]>(() => {
  const byId = new Map(users.forProject(projects.current.id).map((user) => [user.id, user]));
  const threshold = settings.value.lowThreshold;
  const found: SheetRow[] = [];
  for (const sheet of store.sheetsFor(projects.current.id)) {
    const user = byId.get(sheet.userId);
    if (user === undefined) continue;
    found.push({ id: sheet.userId, user, sheet, state: stateOf(sheet, threshold) });
  }
  return found;
});

const counts = computed(() =>
  countByState(
    rows.value.map((row) => row.sheet),
    settings.value.lowThreshold,
  ),
);

/*
 * Which sheets the list shows. It opens on the ones with nothing left, because that is
 * the state somebody has to do something about; the counts on the other two segments say
 * whether there is anything to move to.
 */
const filter = ref<SheetFilter>("risk");

const FILTERS: readonly SheetFilter[] = ["risk", "low", "all"];

function isFilter(value: string): value is SheetFilter {
  return (FILTERS as readonly string[]).includes(value);
}

const filterTab = computed({
  get: () => filter.value as string,
  set: (value: string) => {
    if (isFilter(value)) filter.value = value;
  },
});

const filterOptions = computed<SegmentedOption[]>(() => [
  { value: "risk", label: `Out of codes · ${counts.value.risk}` },
  { value: "low", label: `Running low · ${counts.value.low}` },
  { value: "all", label: `Every sheet · ${counts.value.all}` },
]);

const filtered = computed(() =>
  rows.value.filter((row) => matchesFilter(row.sheet, filter.value, settings.value.lowThreshold)),
);

const STATE_TONES: Record<SheetState, BadgeTone> = {
  healthy: "success",
  low: "warning",
  none: "error",
};

/** For sorting the status column: the states in the order an operator wants them grouped. */
const STATE_RANK: Record<SheetState, number> = { none: 0, low: 1, healthy: 2 };

const COLUMNS: readonly DataTableColumn<SheetRow>[] = [
  {
    key: "user",
    title: "Account",
    fixed: true,
    minWidth: 240,
    value: (row) => nameOf(row.user).toLowerCase(),
  },
  { key: "remaining", title: "Codes left", width: 150, value: (row) => row.sheet.remaining },
  {
    key: "status",
    title: "Sheet",
    width: 128,
    skeleton: "pill",
    value: (row) => STATE_RANK[row.state],
  },
  {
    key: "factors",
    title: "Falls back from",
    width: 140,
    skeleton: "glyphs",
    sortable: false,
    value: (row) => row.sheet.factors.join(" "),
  },
  {
    key: "issuedAt",
    title: "Sheet made",
    mono: true,
    width: 128,
    value: (row) => row.sheet.issuedAt ?? "",
  },
  {
    key: "lastUsedAt",
    title: "Code last used",
    mono: true,
    width: 140,
    value: (row) => row.sheet.lastUsedAt ?? "",
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

/* Which cards start unfolded. The list is what a visit is for, so the rules below it
   are folded until somebody is looking for one. */
const expanded = reactive({ sheet: false, lifecycle: false, never: false });

/*
 * Saving. The threshold is the only field, and clearing a sheet is the only action, so
 * both go through the same busy set the other settings screens use.
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

/* The sheet being cleared, held here rather than passed down, so the dialog keeps its
   subject while it closes. */
const clearing = ref<SheetRow | null>(null);
const clearDialog = ref(false);

function askClear(row: SheetRow) {
  clearing.value = row;
  clearDialog.value = true;
}

function confirmClear() {
  const row = clearing.value;
  if (row === null) return;
  void whileBusy(row.id, () => store.clearSheet(projects.current.id, row.id));
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    clearDialog.value = false;
    clearing.value = null;
  },
);

function copyText(value: string) {
  void copy(value);
}

/*
 * The figures.
 */
const buckets = computed(() => tallyBuckets(rows.value.map((row) => row.sheet)));

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.dev/docs/mfa/recovery";

const GUIDES = [
  {
    icon: "material-symbols:key-vertical-outline",
    title: "Recovery codes",
    detail: "What a sheet is, when it is issued, and what a code proves.",
    href: GUIDES_URL,
  },
  {
    icon: "material-symbols:visibility-outline",
    title: "Showing a sheet once",
    detail: "The one screen your application has to build, and what it must say.",
    href: `${GUIDES_URL}/showing`,
  },
  {
    icon: "material-symbols:timer-outline",
    title: "Enrolling an authenticator",
    detail: "The two calls, and why the second one is what proves the secret arrived.",
    href: "https://idenzy.dev/docs/mfa/totp",
  },
  {
    icon: "material-symbols:code",
    title: "The JS SDK's MFA calls",
    detail: "factors(), regenerateRecoveryCodes(), and answering a challenge.",
    href: "https://idenzy.dev/docs/sdk/js/mfa",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:key-vertical-outline" title="Recovery codes">
      <template #description>
        The way back into an account on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> when the second
        factor is gone. {{ SHEET.codes }} single-use codes per account, issued with the first
        factor and shown exactly once.
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
          Recovery guides
        </v-btn>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          :padded="false"
          description="Every account holding a second factor holds a sheet, until it is spent. An account with neither is one lost phone away from a support ticket."
          title="Sheets"
        >
          <template #badge>
            <StatusBadge
              :label="counts.risk === 0 ? 'All accounts covered' : `${counts.risk} out of codes`"
              :tone="counts.risk === 0 ? 'success' : 'error'"
            />
          </template>
          <template #actions>
            <v-tooltip
              location="top"
              max-width="280"
              text="Where this dashboard draws the line, and nothing else. The server has no opinion about a sheet until the last code is spent."
            >
              <template #activator="{ props: tip }">
                <v-btn
                  v-bind="tip"
                  :loading="isBusy('threshold')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="thresholdDialog = true"
                >
                  Low at {{ settings.lowThreshold }}
                </v-btn>
              </template>
            </v-tooltip>
          </template>

          <div
            class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <SegmentedControl v-model="filterTab" :options="filterOptions" label="Sheets" />
            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
          </div>

          <DataTable
            v-model:column-state="columnState"
            v-model:items-per-page="pageSize"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :columns="COLUMNS"
            :items="filtered"
            :loading="store.loading"
            label="Recovery sheets"
          >
            <template #cell.user="{ item }">
              <UserIdentity :user="item.user" />
            </template>

            <template #cell.remaining="{ item }">
              <span class="flex items-center gap-2.5">
                <RecoveryPips :remaining="item.sheet.remaining" :state="item.state" />
                <!-- An account with no sheet at all is not a sheet of ten with none left,
                     and saying "0/10" would claim ten codes that do not exist. -->
                <span v-if="item.sheet.issuedAt === null" class="text-xs text-ink/50">None</span>
                <span
                  v-else
                  :class="item.sheet.remaining === 0 ? 'text-error' : 'text-ink'"
                  class="font-mono text-xs tabular-nums"
                >
                  {{ item.sheet.remaining }}<span class="text-ink/35">/{{ SHEET.codes }}</span>
                </span>
              </span>
            </template>

            <template #cell.status="{ item }">
              <StatusBadge :label="STATE_LABELS[item.state]" :tone="STATE_TONES[item.state]" />
            </template>

            <template #cell.factors="{ item }">
              <span class="flex items-center gap-1.5">
                <v-tooltip
                  v-for="factor in item.sheet.factors"
                  :key="factor"
                  :text="roleOf(factor)?.label ?? factor"
                  location="top"
                >
                  <template #activator="{ props: tip }">
                    <span
                      v-bind="tip"
                      class="inline-flex size-6 items-center justify-center rounded-(--idenzy-radius-x-small) bg-ink/6 text-ink/70"
                    >
                      <Icon
                        :name="roleOf(factor)?.icon ?? 'material-symbols:shield-lock-outline'"
                        aria-hidden="true"
                        class="text-sm"
                      />
                    </span>
                  </template>
                </v-tooltip>
              </span>
            </template>

            <template #cell.issuedAt="{ item }">
              <span v-if="item.sheet.issuedAt === null" class="text-ink/35">Never made</span>
              <v-tooltip v-else :text="formatDateTime(item.sheet.issuedAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                    {{ relativeTime(item.sheet.issuedAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.lastUsedAt="{ item }">
              <span v-if="item.sheet.lastUsedAt === null" class="text-ink/35">Never</span>
              <v-tooltip v-else :text="formatDateTime(item.sheet.lastUsedAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                    {{ relativeTime(item.sheet.lastUsedAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #actions="{ item }">
              <RecoveryRowActions
                :has-sheet="item.sheet.issuedAt !== null"
                :remaining="item.sheet.remaining"
                :user="item.user"
                @clear="askClear(item)"
                @copy-email="item.user.email && copyText(item.user.email)"
                @copy-id="copyText(item.user.id)"
              />
            </template>

            <template #empty>
              <div class="flex flex-col items-center gap-1 px-4 py-14 text-center">
                <Icon
                  :name="
                    filter === 'all'
                      ? 'material-symbols:shield-lock-outline'
                      : 'material-symbols:check-circle-outline'
                  "
                  aria-hidden="true"
                  class="mb-1 text-2xl"
                  :class="filter === 'all' ? 'text-ink/25' : 'text-success/70'"
                />
                <p class="m-0 text-sm font-medium text-ink">
                  {{
                    filter === "risk"
                      ? "Nobody is out of codes"
                      : filter === "low"
                        ? "No sheet is running low"
                        : "No second factor on this project yet"
                  }}
                </p>
                <p class="m-0 max-w-sm text-xs text-ink/55">
                  {{
                    filter === "all"
                      ? "A sheet appears here the moment somebody confirms an authenticator, because that is the reply the codes come back in."
                      : `Every sheet on the project still has more than ${settings.lowThreshold} codes left. Nothing to do.`
                  }}
                </p>
              </div>
            </template>
          </DataTable>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.sheet"
          expandable
          description="What a code is and how it is kept. None of it is configurable, and each row says why it is what it is."
          title="The sheet"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :description="`Issued together and replaced together. ${SHEET.codes} is enough to lose a few and still have a way in, and few enough that a sheet is something a person will keep.`"
              :fixed="`${SHEET.codes} codes`"
              label="One sheet"
            />
            <SettingRow
              :description="`${SHEET.groups} groups of ${SHEET.groupLength} from Crockford's base32, which drops ${SHEET.dropped} because those are the characters somebody reading off paper gets wrong. Twenty symbols over a thirty-two symbol alphabet is exactly ${SHEET.bits} bits.`"
              fixed="Fixed"
              label="What a code looks like"
            >
              <template #detail>
                <p
                  class="m-0 inline-flex rounded-(--idenzy-radius-x-small) border border-line bg-canvas px-3 py-1.5 font-mono text-[11px] tracking-wide text-ink"
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
              :description="`Only the ${SHEET.digest} digest of a code is stored, so there is nothing to decrypt and nothing a copy of that table would yield. A plain digest rather than a password hash is a property of the code's own length: ${SHEET.bits} bits does not fall to the sweep a six-digit code falls to. A memory-hard hash could not be used here in any case, because a submitted code is checked against every unspent code the account holds.`"
              :fixed="SHEET.digest"
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
          v-model:open="expanded.lifecycle"
          expandable
          description="A sheet arrives with the first second factor and leaves with the last one. Everything in between belongs to the person holding it."
          title="Issued, replaced, removed"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="The sheet comes back in the reply that confirms an authenticator, and only when the account has none. Returning it there rather than leaving it to a call somebody has to remember is deliberate: a customer who forgets that call ships a product where a lost phone is a lost account."
              fixed="Automatic"
              label="Issued with the first factor"
            />
            <SettingRow
              description="Enrolling a second factor does not bring a second sheet. Reissuing would invalidate the one somebody has already printed, and they would find out on the day they needed it."
              fixed="Never"
              label="Issued again quietly"
            />
            <SettingRow label="Replaced whole, by the owner">
              <template #description>
                <span class="font-mono text-ink/80">{{ ROUTES.regenerate }}</span> deletes every
                code and returns ten new ones, once. Half a sheet is worse than either state: a
                printout that partly works, with no way to tell which half.
              </template>
            </SettingRow>
            <SettingRow
              description="Ten single-use passwords must not outlive the thing they were the fallback for, on an account whose owner believes they turned two-factor off."
              fixed="Always"
              label="Removed with the last factor"
            />
            <SettingRow
              description="The codes are returned exactly once and only their digests are kept, so a sheet generated from this screen would either be shown to staff, which is ten working credentials for somebody else's account, or shown to nobody at all. Clearing a sheet is the action that hands nobody anything."
              fixed="Not offered"
              label="Generated for somebody else"
            />
          </div>

          <SamplePanel
            class="mt-5"
            note="We render no screen in this flow, so the one place a sheet is ever visible is yours. There is no second chance to read it out of us."
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
                  carries the sheet on the first factor an account enrols, and null after that.
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
                  is how somebody replaces a sheet they have lost or half spent.
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
          v-model:open="expanded.never"
          expandable
          description="A sheet is a fallback and nothing else. Four things it is regularly expected to do and does not."
          title="What a recovery code never does"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="A sheet on its own demands no challenge. It is what a second factor falls back to, and it exists only because one was enrolled, so an account left holding codes alone is not an account with two-factor on."
              fixed="Never"
              label="Turn two-factor on"
            />
            <SettingRow
              description="Spending a single-use code kept for a lost phone in order to confirm an email change spends the wrong thing, and a step-up already has a session, so there is a cheaper way to ask. The challenge offers a passkey and an authenticator, and nothing else."
              fixed="Never"
              label="Answer a step-up"
            />
            <SettingRow
              description="No factor row, no counter, no confirmation step. Ten single-use secrets on a printed sheet are not a device, and giving them a device's record would mean a factor that is enrolled and never used."
              fixed="Never"
              label="Count as a device"
            />
            <SettingRow
              description="A wrong code, a code already crossed off and an account with no sheet are one refusal. Everybody who reaches a challenge has already got past a first factor, which is exactly where a stolen password puts an attacker, and a distinguishable answer would tell them what the account holds."
              fixed="Never"
              label="Say what went wrong"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Recovery</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="41"
            :value="stats.withSheet"
            info="Accounts holding at least one unspent code. It is the only number the server publishes about a sheet."
            label="Sheets in hand"
          />
          <UsageTile
            :seed="43"
            :value="stats.exhausted"
            info="Accounts with a second factor and no code left to fall back on. A lost authenticator here is a support ticket."
            label="Out of codes"
          />
          <UsageTile
            :seed="45"
            :series="stats.spentDaily"
            :value="stats.spent"
            info="Codes spent to get back in. Each one is a sign-in somebody could not complete any other way."
            label="Codes spent"
          />
          <UsageTile
            :seed="47"
            :series="stats.regeneratedDaily"
            :value="stats.regenerated"
            info="Sheets replaced from your application. Every earlier code stopped working at that moment."
            label="Sheets replaced"
          />
        </div>

        <LayerCard :padded="false" description="By how much of each sheet is left." title="Where the sheets stand">
          <ul v-if="counts.all > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="bucket in buckets" :key="bucket.id" class="flex items-center gap-2.5">
              <span class="w-24 flex-none truncate text-ink/80">{{ bucket.label }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="bucket.id === 'none' ? 'bg-error' : bucket.id === 'few' ? 'bg-warning' : 'bg-primary'"
                  :style="{ width: `${bucket.share}%` }"
                  class="block h-full rounded-full"
                />
              </span>
              <span
                :class="bucket.count === 0 ? 'text-ink/35' : bucket.tone || 'text-ink'"
                class="w-8 flex-none text-right font-mono tabular-nums"
              >
                {{ bucket.count }}
              </span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            No account on this project holds a second factor yet.
          </p>
        </LayerCard>

        <LayerCard :padded="false" title="Guides">
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li v-for="guide in GUIDES" :key="guide.href">
              <a
                :href="guide.href"
                class="flex items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
                rel="noopener"
                target="_blank"
              >
                <Icon :name="guide.icon" aria-hidden="true" class="mt-px flex-none text-xl text-ink/70" />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="font-medium text-ink">{{ guide.title }}</span>
                  <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
                </span>
              </a>
            </li>
          </ul>
        </LayerCard>

        <SaveStatus :last-saved="lastSaved" :saving="saving" />
      </aside>
    </div>

    <NumberDialog
      v-model="thresholdDialog"
      :current="settings.lowThreshold"
      :hint="`Between ${LOW_THRESHOLD_MIN} and ${LOW_THRESHOLD_MAX}. A sheet at or under this many codes is called low here.`"
      :integer-label="THRESHOLD_ISSUE.integer"
      :max="LOW_THRESHOLD_MAX"
      :min="LOW_THRESHOLD_MIN"
      :range-label="THRESHOLD_ISSUE.range"
      description="Where this dashboard and the security centre draw the line. The server does not read it: a sign-in behaves the same whether a sheet is full or down to its last code."
      label="Call a sheet low at"
      suffix="codes"
      title="Change when a sheet counts as low"
      @confirm="confirmThreshold"
    />

    <RecoveryClearDialog
      v-model="clearDialog"
      :busy="clearing !== null && isBusy(clearing.id)"
      :remaining="clearing?.sheet.remaining ?? 0"
      :user="clearing?.user ?? null"
      @confirm="confirmClear"
    />
  </div>
</template>
