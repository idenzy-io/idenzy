<script setup lang="ts">
/**
 * Revocation: ending a session before the access token it already handed out expires
 * (PROJECT.md 4.2, ADR-0009), arranged as an integration screen and not an inspector.
 *
 * The question somebody arrives with is whether a session they ended can still reach
 * their backend, and the answer is one fact: has anything of theirs read the published
 * set. So that leads. Our own endpoints read the session row on every authenticated
 * request and refuse a revoked session at once; what the set exists for is the verifier a
 * customer runs, which is offline on purpose and would otherwise learn nothing until the
 * token expired. Those two are stated side by side and never averaged into one number.
 *
 * What the panel can observe is narrower than what it would like to say, and the wording
 * holds that line everywhere. A last-read timestamp says one process fetched the
 * snapshot. It is not proof that every backend process a customer runs holds a cache, and
 * it is not proof any of them refused a token, so the coverage row says "one integration"
 * and the connection test is two halves: we publish an entry for a session that never
 * existed and watch for the read, and the operator confirms what their own verifier did
 * with it. Neither half is inferred from the other, and nothing here ever promises
 * five-second enforcement to a project nothing is polling.
 *
 * The set itself is a diagnostic and sits at the foot, folded. Session ids, watermarks and
 * expiry countdowns are what an operator reads third, after the integration and after the
 * human history of what was revoked, which is a table that links to the screen owning the
 * actual support action.
 *
 * Two numbers belong to other screens and are read from them: the retention comes from the
 * access-token lifetime that `/tokens/lifetimes` owns, and whether anything is polling is
 * the same observation that screen makes. The endpoint in every sample is derived from this
 * project's own auth domain or this deployment, in that order, because a sample naming a
 * host the project does not answer on fails at the first request.
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
  durationParts,
  revocationWindowSeconds,
  snapshotRetentionSeconds,
} from "~/utils/lifetimes";
import { humanizeSeconds } from "~/utils/otp";
import {
  entryKindFor,
  INTEGRATION_LABELS,
  INTEGRATION_TONES,
  integrationStateOf,
  MATCHED_CLAIM,
  POLL_SECONDS,
  publishedEntries,
  REVOCATION_KIND_LABELS,
  REVOCATION_KIND_RULES,
  type RevocationEntry,
  type RevocationKind,
  remainingShare,
  revocationPath,
  SNAPSHOT_CACHE_CONTROL,
  SNAPSHOT_PATH,
  SNAPSHOT_TTL_SECONDS,
  SNAPSHOT_TYP,
  SWEEP_SECONDS,
  secondsLeft,
  snapshotEndpoint,
  snapshotPayload,
} from "~/utils/revocation";
import { endedBy, REASON_LABELS, type RevokeReason, type SessionRow } from "~/utils/sessions";
import { formatDateTime, relativeTime, relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useRevocationsStore();
const lifetimes = useLifetimesStore();
const sessions = useSessionsStore();
const authDomains = useAuthDomainsStore();
const settings = useProjectSettingsStore();

const { copy } = useClipboard({ legacy: true });

/* A second, because the meters and the probe's own wait count down in seconds. */
const now = useNow({ interval: 1000 });

const projectId = computed(() => projects.current.id);

/*
 * Every card on this page is folded to begin with. The history and the figures over it
 * are what a visit is for, and each card below is read once by somebody who has just met
 * a question it answers; the strip carries the state, so nothing important sits behind a
 * fold, only the explanation of it.
 */
const open = reactive({ health: false, limits: false, path: false, snapshot: false });

/*
 * What the panel can see of the integration, which is one observation and not four. Read
 * from the same place the lifetimes screen reads it, because two screens disagreeing about
 * a customer's exposure is a customer told twice that it is two different things.
 */
const polledAt = computed(() => lifetimes.revocationPolledAt(projectId.value));
const state = computed(() => integrationStateOf(polledAt.value, now.value));
const connected = computed(() => state.value === "live");

const polledAgo = computed(() => {
  const at = polledAt.value;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

const confirmedAt = computed(() => store.confirmedAt(projectId.value));
const checkedAt = computed(() => store.checkedAt(projectId.value));

const accessTokenSeconds = computed(
  () => lifetimes.settingsFor(projectId.value).accessTokenSeconds,
);
const retentionSeconds = computed(() => snapshotRetentionSeconds(accessTokenSeconds.value));
const retentionLabel = computed(() => humanizeSeconds(retentionSeconds.value));

/** The worst case at the customer's own verifier: one poll with a cache, the token without. */
const exposure = computed(() => revocationWindowSeconds(accessTokenSeconds.value, connected.value));

/**
 * The sentence the page leads with, which is the finding this screen was rebuilt for: the
 * most important state was secondary. Three states and three different next moves, and the
 * one nobody has connected is written as a decision rather than as a fault.
 */
const lead = computed(() => {
  if (state.value === "never") {
    return {
      icon: "material-symbols:link-off",
      tone: "text-ink/45",
      title: "Your backend is not connected to revocation updates",
      detail: `No process holding this project's secret key has ever read the published set. Nothing is broken: verification is offline by design, and a revoked session keeps passing at your own verifier until its access token expires, which is ${humanizeSeconds(accessTokenSeconds.value)}. Attaching a cache is what shortens that.`,
    };
  }
  if (state.value === "stale") {
    return {
      icon: "material-symbols:warning-outline",
      tone: "text-warning",
      title: `The set has not been read ${polledAgo.value}`,
      detail: `Something read it before, so this is a process that has stopped rather than one nobody built. A cache whose snapshot is past its expiry reports stale and answers "not revoked", which is the documented fail-open, so the exposure beside is back to the full token lifetime until polling resumes.`,
    };
  }
  return {
    icon: "material-symbols:check-circle-outline",
    tone: "text-success",
    title: "Something is reading this project's revocation set",
    detail: `The last read was ${polledAgo.value}. A revocation reaches whatever performed it within one poll, and the check on your request path costs a hash lookup and no network call. What that read does not say is how many of your processes hold a cache, which is what the connection test is for.`,
  };
});

/*
 * Setting it up is a dialog and not a card on the page: three ordered steps, one of which
 * performs an action, over a workspace the page behind is not competing with. It is the
 * same shape the provider setup takes, for the same reason.
 */
const setupOpen = ref(false);
const probe = computed(() => store.probeFor(projectId.value));

function openSetup() {
  setupOpen.value = true;
}

const refreshing = ref(false);

async function refreshStatus() {
  refreshing.value = true;
  await store.refresh(projectId.value);
  refreshing.value = false;
  notify("Polling status re-read");
}

/**
 * Where the snapshot is, for this project. Derived rather than written down, so the sample
 * a developer copies names the host their own tokens are issued by.
 */
const authApiBase = useAuthApiBase();

/* The domains store reads over a cache and this screen is one of the readers: without the
   fill, the endpoint a developer copies would name the shared host on a project that has a
   host of its own. */
watch(projectId, (id) => void authDomains.load(id), { immediate: true });

const endpoint = computed(() => {
  const domain =
    authDomains.forProject(projectId.value).find((entry) => entry.status === "verified")?.domain ??
    null;
  const facts = settings.factsFor(projectId.value, projects.current.name);
  return snapshotEndpoint({
    authDomain: domain,
    deploymentBase: authApiBase.value,
  });
});

const snapshotUrl = computed(() => `${endpoint.value.issuerUrl}${SNAPSHOT_PATH}`);

/*
 * The set as the endpoint would serve it this second, which is the diagnostic at the foot
 * and the source of what the history says is still published.
 */
const entries = computed(() =>
  publishedEntries(store.entriesFor(projectId.value), now.value, accessTokenSeconds.value),
);

const payload = computed(() => snapshotPayload(entries.value, accessTokenSeconds.value));

const entryById = computed(() => new Map(entries.value.map((entry) => [entry.id, entry])));

/*
 * The history, in people rather than ids. Its source is the sessions store and not the
 * published set, because the set holds the last few minutes by design: a table drawn from
 * it would be empty most of the time, and an operator asking what was revoked this morning
 * would read that as nothing having happened.
 */
interface RevocationRow {
  /** The session, which is what a row is: one ending, one line. */
  id: string;
  session: SessionRow;
  reason: RevokeReason;
  kind: RevocationKind;
  revokedAt: string;
  /** The entry it wrote, while the snapshot still carries it. */
  entry: RevocationEntry | null;
}

const rows = computed<RevocationRow[]>(() => {
  const built: RevocationRow[] = [];
  for (const session of sessions.forProject(projectId.value)) {
    const reason = endedBy(session, now.value);
    if (reason === null || session.revokedAt === null) continue;
    const kind = entryKindFor(reason);
    if (kind === null) continue;
    const entry = entryById.value.get(kind === "user" ? session.userId : session.id) ?? null;
    built.push({
      id: session.id,
      session,
      reason,
      kind,
      /* The entry's instant where there is one, because that is what the set is keyed by
         and what the countdown beside it is measured from. A row saying a session ended
         two months ago with five minutes left in the set is two facts that cannot both
         be true. */
      revokedAt: entry?.revokedAt ?? session.revokedAt,
      entry,
    });
  }
  return built;
});

const published = computed(() => rows.value.filter((row) => row.entry !== null).length);

const shapeTab = ref("all");
const query = ref("");

const tabOptions = computed<SegmentedOption[]>(() => [
  { value: "all", label: `All · ${rows.value.length}` },
  { value: "published", label: `In the set · ${published.value}` },
  { value: "aged", label: `Aged out · ${rows.value.length - published.value}` },
]);

const listed = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (shapeTab.value === "published" && row.entry === null) return false;
    if (shapeTab.value === "aged" && row.entry !== null) return false;
    if (needle === "") return true;
    const person = row.session.user;
    return [row.id, row.session.userId, person.displayName ?? "", person.email ?? ""].some(
      (field) => field.toLowerCase().includes(needle),
    );
  });
});

/**
 * The columns. A person leads, because this table is read to find out who lost a session
 * and what it cost them; the ids the set is keyed by are one click away in the columns
 * menu, which is where infrastructure detail belongs on a screen about an integration.
 */
const COLUMNS: readonly DataTableColumn<RevocationRow>[] = [
  {
    key: "user",
    title: "Account",
    fixed: true,
    minWidth: 200,
    skeleton: "identity",
    value: (row) => (row.session.user.displayName ?? row.session.user.email ?? "").toLowerCase(),
  },
  { key: "revokedAt", title: "When", mono: true, width: 120 },
  {
    key: "effect",
    title: "What it ends",
    width: 236,
    value: (row) => REVOCATION_KIND_LABELS[row.kind],
  },
  {
    key: "state",
    title: "In the published set",
    width: 176,
    value: (row) =>
      row.entry === null ? -1 : secondsLeft(row.entry, now.value, accessTokenSeconds.value),
  },
  {
    key: "reason",
    title: "Written by",
    width: 180,
    skeleton: "pill",
    value: (row) => REASON_LABELS[row.reason],
  },
  { key: "session", title: "Session ID", mono: true, width: 208, hidden: true },
  {
    key: "entry",
    title: "Entry the set carries",
    mono: true,
    width: 208,
    hidden: true,
    value: (row) => (row.kind === "user" ? row.session.userId : row.id),
  },
];

const stored = useLocalStorage<ColumnState>(
  "idenzy.revocations.history.columns",
  defaultColumnState(COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});

/* Newest first, because what an operator came to check is what just happened. */
const sortBy = ref<DataTableSort[]>([{ key: "revokedAt", order: "desc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.revocations.history.page-size", 10);

/* A narrowed list is read from the top, and a page number left behind shows nothing. */
watch([query, shapeTab], () => {
  page.value = 1;
});

/* A project's history is its own, and so is the setup dialog's walkthrough. */
watch(projectId, () => {
  setupOpen.value = false;
  page.value = 1;
});

/**
 * Empty means two things here and they must not read as one. Nothing revoked is the
 * ordinary state of a quiet project; nothing matching is a filter over a list that has
 * rows in it, and telling somebody nothing was revoked while eight rows sit behind the
 * next tab is simply wrong.
 */
const emptyTitle = computed(() => {
  if (rows.value.length === 0) return "Nothing has been revoked";
  if (query.value.trim() !== "") return "No revocation matches";
  return shapeTab.value === "published"
    ? "Nothing is in the set right now"
    : "Nothing has aged out";
});

const emptyDescription = computed(() => {
  if (rows.value.length === 0) {
    return "No session on this project has been ended by somebody or something acting. A session that reached one of its own expiries is not listed here, because a lapse publishes nothing.";
  }
  if (query.value.trim() !== "") {
    return "Try another name, address or ID. Sessions that lapsed are not in this list at all.";
  }
  return shapeTab.value === "published"
    ? `The ordinary state. An entry stays for ${retentionLabel.value} and then goes, because by then any token it could have killed has expired on its own.`
    : "Every revocation on this project is still inside the retention window.";
});

/**
 * The strip over the table. Six figures, each of which is either a fact the rest of the
 * page explains or a list this table can narrow to, and the line under it goes wherever
 * the figure came from. A total a reader cannot follow through to is a total they have to
 * take on trust, which is the same rule the sessions and users lists are built on.
 */
interface Fact {
  label: string;
  value: string;
  /** After the digits at the smaller size, where the figure is not a count. */
  unit: string;
  /** The line under the figure: what it opens, or what it means where it opens nothing. */
  action: string;
  /** A screen that owns the figure. Empty where this one does. */
  to: string;
  /** What this screen does with it. Null where the figure opens nothing. */
  show: (() => void) | null;
}

const facts = computed<Fact[]>(() => [
  {
    label: "Your backend refuses it",
    value: durationParts(exposure.value).digits,
    unit: durationParts(exposure.value).unit,
    action: connected.value ? "Observed for one integration" : "Set up verification",
    to: "",
    show: connected.value ? null : openSetup,
  },
  {
    label: "Our API refuses it",
    value: "Immediately",
    unit: "",
    action: "Read off the session row, every request",
    to: "",
    show: null,
  },
  {
    label: "Last observed read",
    value: polledAt.value === null ? "Never" : relativeTime(polledAt.value, now.value),
    unit: "",
    action: INTEGRATION_LABELS[state.value],
    to: "",
    show: null,
  },
  {
    label: "In the published set",
    value: entries.value.length.toLocaleString("en"),
    unit: "",
    action: entries.value.length > 0 ? "Show what is still published" : "The ordinary state",
    to: "",
    show: entries.value.length > 0 ? () => narrow("published") : null,
  },
  {
    label: "Revoked sessions",
    value: rows.value.length.toLocaleString("en"),
    unit: "",
    action: rows.value.length > 0 ? "Show every one" : "Nothing has been revoked",
    to: "",
    show: rows.value.length > 0 ? () => narrow("all") : null,
  },
  {
    label: "An entry is kept for",
    value: durationParts(retentionSeconds.value).digits,
    unit: durationParts(retentionSeconds.value).unit,
    action: "Set by the access-token lifetime",
    to: "/tokens/lifetimes",
    show: null,
  },
]);

function narrow(tab: string) {
  shapeTab.value = tab;
  query.value = "";
}

const badge = computed<{ label: string; tone: BadgeTone }>(() => ({
  label: INTEGRATION_LABELS[state.value],
  tone: INTEGRATION_TONES[state.value],
}));

const stages = computed(() => revocationPath(connected.value));

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

async function copyText(text: string, what: string) {
  await copy(text);
  notify(`${what} copied`);
}

const GUIDE_URL = "https://idenzy.io/docs/tokens/revocation";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Revocation">
      <template #badge>
        <StatusBadge :label="badge.label" :tone="badge.tone" />
      </template>
      <template #description>
        Whether a session ended on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> can still reach
        your own backend, and how to shorten the window in which it can.
      </template>
      <template #actions>
        <v-btn
          :loading="refreshing"
          aria-label="Re-read when the revocation set was last fetched"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:refresh"
          size="small"
          variant="text"
          @click="refreshStatus"
        >
          Refresh Status
        </v-btn>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="openSetup"
        >
          <template #prepend>
            <Icon
              aria-hidden="true"
              class="text-sm"
              :name="
                confirmedAt === null
                  ? 'material-symbols:play-arrow-outline'
                  : 'material-symbols:visibility-outline'
              "
            />
          </template>
          {{ confirmedAt === null ? "Set up verification" : "View integration" }}
        </v-btn>
      </template>
    </PageHeader>

    <!--
      The facts, as a strip rather than tiles, and the same one the sessions and users
      lists carry: each figure is either a state the card under it explains or a list this
      table can narrow to, and the line beneath opens exactly that. The rules between the
      cells are the container's own background through a one-pixel gap, which is right at
      all three breakpoints where a per-cell border would need turning off at every edge.
    -->
    <div
      class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      <div
        v-for="fact in facts"
        :key="fact.label"
        class="flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5"
      >
        <span class="text-xs text-ink/55">{{ fact.label }}</span>

        <span
          v-if="store.loading"
          aria-hidden="true"
          class="h-5 w-16 animate-pulse rounded-full bg-ink/8"
        />
        <span v-else class="flex min-w-0 items-baseline gap-1">
          <span class="truncate font-mono text-lg leading-6 font-medium text-ink tabular-nums">
            {{ fact.value }}
          </span>
          <span v-if="fact.unit" class="font-mono text-xs text-ink/45">{{ fact.unit }}</span>
        </span>

        <NuxtLink
          v-if="fact.to"
          :to="fact.to"
          class="text-xs text-ink/55 no-underline transition-colors hover:text-ink"
        >
          {{ fact.action }}
        </NuxtLink>
        <button
          v-else-if="fact.show"
          class="cursor-pointer appearance-none rounded-(--idenzy-radius-x-small) border-0 bg-transparent p-0 text-left text-xs text-ink/55 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="fact.show()"
        >
          {{ fact.action }}
        </button>
        <span v-else class="text-xs text-ink/40">{{ fact.action }}</span>
      </div>
    </div>

    <!--
      The history, in people, and the first thing on the page after the figures. The set
      behind it holds the last few minutes by design, so this reads from the sessions the
      panel already has and marks which of them the snapshot still carries. Ending a
      session happens on the sessions screen, which is what the link beside the heading is
      for.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">Recent revocations</h2>
          <p class="m-0 text-xs text-ink/55">
            Sessions ended by somebody or something acting, and which of them the published
            set still carries. A session that lapsed is not here, because a lapse publishes
            nothing.
          </p>
        </div>
        <NuxtLink
          class="flex items-center gap-1 text-xs font-medium whitespace-nowrap text-ink no-underline transition-colors hover:text-ink/60"
          to="/sessions"
        >
          Open sessions
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:arrow-forward" />
        </NuxtLink>
      </header>

      <v-card border flat>
        <div
          class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl v-model="shapeTab" :options="tabOptions" label="Published state" />

          <div class="flex flex-wrap items-center gap-2">
            <v-text-field
              v-model="query"
              aria-label="Search revocations"
              class="revocation__search w-full sm:w-72"
              clearable
              density="comfortable"
              hide-details
              placeholder="Search account, session or user ID"
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />
            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
          </div>
        </div>

        <DataTable
          v-model:column-state="columnState"
          v-model:items-per-page="pageSize"
          v-model:page="page"
          v-model:sort-by="sortBy"
          :columns="COLUMNS"
          :empty-description="emptyDescription"
          :empty-title="emptyTitle"
          :items="listed"
          :loading="store.loading"
          label="Recent revocations"
        >
          <template #cell.user="{ item }">
            <SessionUser :user="item.session.user" />
          </template>

          <template #cell.revokedAt="{ item }">
            <v-tooltip :text="formatDateTime(item.revokedAt)" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="font-mono text-[11px] text-ink/80 tabular-nums">
                  {{ relativeTime(item.revokedAt, now) }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <!-- The shape rides with what it means rather than in a column of its own:
               "sub" alone says nothing to a reader who has not read the guide. -->
          <template #cell.effect="{ item }">
            <v-tooltip :text="REVOCATION_KIND_RULES[item.kind]" location="top" max-width="260">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="flex min-w-0 items-center gap-2">
                  <span class="truncate text-xs text-ink/80">
                    {{ REVOCATION_KIND_LABELS[item.kind] }}
                  </span>
                  <span
                    class="inline-flex flex-none rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/60"
                  >
                    {{ MATCHED_CLAIM[item.kind] }}
                  </span>
                </span>
              </template>
            </v-tooltip>
          </template>

          <!-- The one thing a list of endings does not say on its own: whether a poll made
               now would still see it. The bar is under the figure, so the column reads as
               seconds first and the drain is what the eye picks up scanning down. -->
          <template #cell.state="{ item }">
            <span v-if="item.entry" class="flex w-36 flex-col gap-1">
              <span class="flex items-baseline gap-1 text-xs">
                <span class="font-mono text-ink tabular-nums">
                  {{ secondsLeft(item.entry, now, accessTokenSeconds) }}s
                </span>
                <span class="text-ink/55">left</span>
              </span>
              <span
                :aria-valuenow="Math.round(remainingShare(item.entry, now, accessTokenSeconds) * 100)"
                aria-valuemax="100"
                aria-valuemin="0"
                class="block h-1 w-full overflow-hidden rounded-full bg-ink/8"
                role="progressbar"
              >
                <span
                  :class="
                    remainingShare(item.entry, now, accessTokenSeconds) > 0.25
                      ? 'bg-primary/70'
                      : 'bg-ink/30'
                  "
                  :style="{ width: `${remainingShare(item.entry, now, accessTokenSeconds) * 100}%` }"
                  class="block h-full rounded-full transition-[width] duration-1000 ease-linear"
                />
              </span>
            </span>
            <span v-else class="text-xs text-ink/45">Aged out</span>
          </template>

          <template #cell.reason="{ item }">
            <StatusBadge
              :label="REASON_LABELS[item.reason]"
              :tone="item.reason === 'refresh_token_reuse' ? 'error' : 'neutral'"
            />
          </template>

          <template #cell.session="{ item }">
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

          <template #cell.entry="{ item }">
            <button
              :title="item.kind === 'user' ? 'Copy user ID' : 'Copy session ID'"
              class="group/id inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/65 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="
                copyText(
                  item.kind === 'user' ? item.session.userId : item.id,
                  item.kind === 'user' ? 'User ID' : 'Session ID',
                )
              "
            >
              <span class="truncate">
                {{ item.kind === "user" ? item.session.userId : item.id }}
              </span>
              <Icon
                aria-hidden="true"
                class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/id:opacity-60"
                name="material-symbols:content-copy-outline"
              />
            </button>
          </template>
        </DataTable>
      </v-card>
    </section>

    <!--
      What the panel can see of the integration, and what it costs. Folded like everything
      below it: the strip above already carries both figures, and this is the card that
      says what each of them is evidence of.
    -->
    <LayerCard
      id="revocation-health"
      v-model:open="open.health"
      :padded="false"
      description="What this panel can see of the verifier you run, and what a revocation costs today because of it."
      expandable
      title="Integration health"
    >
      <template #badge>
        <StatusBadge :label="badge.label" :tone="badge.tone" />
      </template>
      <template #actions>
        <span class="text-[11px] text-ink/50">
          {{ checkedAt === null ? "Read as the page opened" : `Checked ${relativeTime(checkedAt, now)}` }}
        </span>
      </template>

      <div class="flex items-start gap-3 p-4 sm:p-5">
        <Icon :class="lead.tone" :name="lead.icon" aria-hidden="true" class="mt-0.5 flex-none text-lg" />
        <div class="flex min-w-0 flex-col gap-1.5">
          <p class="m-0 text-sm leading-5 font-medium text-ink">{{ lead.title }}</p>
          <p class="m-0 max-w-prose text-xs leading-5 text-ink/60">{{ lead.detail }}</p>
        </div>
      </div>

      <!-- Two enforcement summaries, never averaged: ours is a row read on every request
           and theirs is a snapshot something has to fetch. Stacked below sm. -->
      <div class="grid gap-5 border-y border-line bg-ink/3 px-4 py-4 sm:grid-cols-2 sm:px-5">
        <LifetimeOutcome
          label="Our API refuses it"
          note="Every authenticated request reads the session row, so a revoked session is refused here at once whatever token it presents. This half needs no integration and cannot be switched off."
          unit="on the next request"
          value="Immediately"
        />
        <LifetimeOutcome
          :note="
            connected
              ? `Observed for one integration. Any verifier of yours holding no RevocationCache still waits out the full ${humanizeSeconds(accessTokenSeconds)}.`
              : `The access-token lifetime, because an offline verifier has nothing to tell it otherwise. Attaching a cache brings this to about ${POLL_SECONDS} seconds.`
          "
          :tone="connected ? 'primary' : 'warning'"
          :unit="`${durationParts(exposure).unit}, worst case`"
          :value="durationParts(exposure).digits"
          label="Your backend refuses it"
        />
      </div>

      <!--
        The coverage statement, which is the other half of the finding: a read of the
        snapshot is not end-to-end enforcement, and each row here says exactly what it is
        evidence of rather than letting the green badge stand for all three.
      -->
      <dl class="m-0 grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-3 sm:px-5">
        <div class="flex min-w-0 flex-col gap-1">
          <dt class="text-[11px] text-ink/55">Last observed read</dt>
          <dd class="m-0 font-mono text-xs text-ink tabular-nums">
            {{ polledAt === null ? "Never" : polledAgo }}
          </dd>
          <dd class="m-0 text-[11px] leading-4 text-ink/55">
            {{
              polledAt === null
                ? "Nothing holding this project's secret key has ever fetched the snapshot."
                : "One process holding this project's secret key fetched the snapshot."
            }}
          </dd>
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <dt class="text-[11px] text-ink/55">Integration scope</dt>
          <dd class="m-0 font-mono text-xs text-ink tabular-nums">
            {{ polledAt === null ? "None observed" : "1 integration" }}
          </dd>
          <dd class="m-0 text-[11px] leading-4 text-ink/55">
            A read is all this panel can see. How many of your processes hold a cache is not
            visible from here.
          </dd>
        </div>
        <div class="flex min-w-0 flex-col gap-1">
          <dt class="text-[11px] text-ink/55">Enforcement confirmed</dt>
          <dd class="m-0 font-mono text-xs text-ink tabular-nums">
            {{ confirmedAt === null ? "Never" : relativeTimeWords(confirmedAt, now) }}
          </dd>
          <dd class="m-0 text-[11px] leading-4 text-ink/55">
            Your own statement after watching a verifier hold the test entry, never a check
            we ran.
          </dd>
        </div>
      </dl>
    </LayerCard>

    <!--
      The distinction the page exists to keep: which endings publish anything, and which of
      them our own API refuses whatever the set holds.
    -->
    <LayerCard
      id="revocation-limits"
      v-model:open="open.limits"
      description="Which endings reach the set at all, and what our own API does about the ones that do not."
      expandable
      title="What a revocation reaches today"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="Our own endpoints read the session row on every authenticated request, so a revoked session is refused here at once and no set is involved. Everything else on this screen is about the verifier you run, which is offline on purpose."
          fixed="Immediate"
          label="Our own API"
        />
        <SettingRow
          description="A session that lapses writes nothing, and that is not an oversight: the idle clock only moves on a rotation, so a session that has gone idle stopped holding a live token long before it lapsed. The maximum lifetime is the one case where a token can outlive its session, by at most one token lifetime, and our own API refuses it from the row on the first request."
          fixed="No entry"
          label="A session that expires"
        />
        <SettingRow
          description="A suspension is not a revocation, so nothing is published. The account stops at its next rotation, when the refresh is refused, which bounds it to one access-token lifetime. A set changes nothing about that."
          fixed="No entry"
          label="A suspended account"
        />
        <SettingRow
          description="Refusing a rotation is the session row's job, and it happens on our side whatever the set holds. The set is only ever about access tokens already minted and already in somebody's hands."
          fixed="The row"
          label="Refresh tokens"
        />
        <SettingRow label="A verifier that cannot reach us">
          <template #description>
            A failed poll holds the last good snapshot and reports
            <span class="font-mono text-ink/80">stale</span>, which is a third answer and not
            a third state of the token: it means that process cannot tell, never that
            everything is revoked and never that nothing is. Throwing instead would turn an
            outage of ours into an outage of yours on every request, which is worse than the
            delay it avoids.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Fails open
            </span>
          </template>
        </SettingRow>
        <SettingRow label="A whole project at once">
          <template #description>
            The snapshot carries
            <span class="font-mono text-ink/80">projectRevokedBefore</span> for a key
            compromise, compared against every token's
            <span class="font-mono text-ink/80">iat</span> the way a user watermark is.
            Nothing writes one yet, so there is no way to ask for it from here or from the
            API.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Not built
            </span>
          </template>
        </SettingRow>
      </div>
    </LayerCard>


    <LayerCard
      v-model:open="open.path"
      description="From the revocation to a verifier refusing the token. Three of the four stages are ours; the last is yours to run and is drawn as such."
      expandable
      title="How a revocation travels"
    >
      <RevocationPath :stages="stages" />
    </LayerCard>

    <!--
      The snapshot itself, folded. It is what an operator reads third, and a page that
      opened on session ids and expiry countdowns read as infrastructure inspection rather
      than as the integration screen it is.
    -->
    <LayerCard
      v-model:open="open.snapshot"
      description="The signed snapshot as it stands, what may be trusted for how long, and the diagnostics behind the state above."
      expandable
      title="Advanced: the published snapshot"
    >
      <template #badge>
        <StatusBadge
          :label="entries.length === 1 ? '1 entry' : `${entries.length} entries`"
          tone="neutral"
        />
      </template>

      <div class="mb-5 flex flex-col gap-1.5">
        <span class="text-xs font-medium text-ink">Snapshot URL</span>
        <CopyField :value="snapshotUrl" label="Copy the snapshot URL" />
        <span class="text-[11px] leading-4 text-ink/55">{{ endpoint.note }}</span>
      </div>

      <div class="divide-y divide-line">
        <SettingRow label="Who may read it">
          <template #description>
            The project's secret key, never a publishable one. The payload names accounts
            whose sessions were all ended and times their security events, and a project id
            travels in the <span class="font-mono text-ink/80">aud</span> of every token we
            sign, so anyone holding one token could otherwise watch that project
            indefinitely.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Secret key
            </span>
          </template>
        </SettingRow>
        <SettingRow
          description="Signed with the project's own key, so a client verifies it with the key set it already caches. TLS ends at whatever you run this behind; the signature is what makes the payload's origin checkable where it arrives."
          fixed="ES256"
          label="How it is signed"
        />
        <SettingRow :fixed="SNAPSHOT_TYP" label="What stops a token confusion">
          <template #description>
            One key signs both a snapshot and an access token, so the signature alone does
            not say which you are holding. The header's
            <span class="font-mono text-ink/80">typ</span> is not
            <span class="font-mono text-ink/80">JWT</span>, both access-token verifiers
            require that it is, and the issuer refuses to put
            <span class="font-mono text-ink/80">sub</span> or
            <span class="font-mono text-ink/80">sid</span> in a statement at all. Any one of
            those alone would be a single point of failure.
          </template>
        </SettingRow>
        <SettingRow
          :description="`A signed snapshot may be trusted for ${SNAPSHOT_TTL_SECONDS} seconds. It is the only thing between a withheld snapshot and revocation quietly ceasing to work: anything on the path can serve an old copy, and an expiry is what turns that from invisible into stale.`"
          :fixed="`${SNAPSHOT_TTL_SECONDS}s`"
          label="How long one may be trusted"
        />
        <SettingRow
          description="Private, not public. A shared cache keyed on the URL would serve one project's set to another project's key. The ETag is what keeps polling cheap instead, and it is computed over the content rather than the signature: a fresh signature every poll would change the bytes each time and make the ETag useless."
          :fixed="SNAPSHOT_CACHE_CONTROL"
          label="Cache-Control"
        />
        <SettingRow
          :description="`One access-token lifetime plus a minute of skew. A token minted immediately before a revocation expires one lifetime later, so nothing older can still be presented, and that bound is the only reason the whole set can be published rather than a feed of changes.`"
          :fixed="`${retentionSeconds}s`"
          label="How long an entry is kept"
        />
      </div>

      <!-- The diagnostics behind the state at the top, in one place rather than restated
           beside each figure that depends on them. -->
      <dl
        class="m-0 mt-5 grid gap-x-6 gap-y-3 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3.5 ring-1 ring-ink/6 ring-inset sm:grid-cols-2 lg:grid-cols-4"
      >
        <div class="flex items-baseline justify-between gap-3 text-xs">
          <dt class="text-ink/60">Last read</dt>
          <dd class="m-0 font-mono text-[11px] text-ink tabular-nums">
            {{ polledAt === null ? "Never" : polledAgo }}
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-3 text-xs">
          <dt class="text-ink/60">Poll interval</dt>
          <dd class="m-0 font-mono text-[11px] text-ink tabular-nums">{{ POLL_SECONDS }}s</dd>
        </div>
        <div class="flex items-baseline justify-between gap-3 text-xs">
          <dt class="text-ink/60">Reconciler sweep</dt>
          <dd class="m-0 font-mono text-[11px] text-ink tabular-nums">{{ SWEEP_SECONDS }}s</dd>
        </div>
        <div class="flex items-baseline justify-between gap-3 text-xs">
          <dt class="text-ink/60">Retention</dt>
          <dd class="m-0 font-mono text-[11px] text-ink tabular-nums">{{ retentionSeconds }}s</dd>
        </div>
      </dl>

      <SamplePanel
        class="mt-5"
        :meta="entries.length === 1 ? '1 entry' : `${entries.length} entries`"
        note="The payload inside the signature, for this project as it stands. Unix seconds, because a watermark is compared against a token's iat."
        title="What a poll answers with"
      >
        <pre
          class="m-0 overflow-x-auto font-mono text-xs leading-5 text-ink"
        ><code>{{ payload }}</code></pre>
      </SamplePanel>
    </LayerCard>

    <RevocationSetupDialog
      v-model="setupOpen"
      :endpoint="endpoint"
      :retention-label="retentionLabel"
      @copy="notify(`${$event} copied`)"
    />

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
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
/* A search box at the height of the control beside it, in the toolbar's small type and on
   the small radius, so the row reads as one set. The same block the sessions and users
   screens carry, because the toolbars must not be a size apart. */
.revocation__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.revocation__search :deep(.v-field__input),
.revocation__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
}

.revocation__search :deep(.v-field__prepend-inner > .v-icon),
.revocation__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
