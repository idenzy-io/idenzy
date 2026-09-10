<script setup lang="ts">
/**
 * Revocation: ending a session before the access token it already handed out expires
 * (PROJECT.md 4.2, ADR-0009).
 *
 * There is nothing to configure here, and the screen is built around that. Our own
 * endpoints read the session row on every authenticated request, so a revocation takes
 * effect on them at once; what the set exists for is the verifier a customer runs, which
 * is offline on purpose and would otherwise not learn about a revocation until the token
 * expired. So the page shows the thing that is published rather than a form: the snapshot
 * as it stands, the path an entry travels to get there, and the limits of what it covers.
 *
 * The set as it stands is the centrepiece because it is the one part nobody can picture
 * from the documentation. Entries are kept for one access-token lifetime plus skew and no
 * longer, and that bound is the only reason the whole set can be published rather than a
 * feed of changes; a list that visibly drains says that in a way a paragraph does not. The
 * ordinary state of the set is empty, so the empty state says so plainly instead of
 * reading as a fault.
 *
 * Two numbers on this screen belong to other screens and are read from them rather than
 * written again: the retention comes from the access-token lifetime, which
 * `/tokens/lifetimes` owns, and whether anything is polling is the same observation that
 * screen makes. The counts on the side come from the sessions store, so what this screen
 * says was revoked and what the sessions list says cannot disagree.
 */
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { snapshotRetentionSeconds } from "~/utils/lifetimes";
import { humanizeSeconds } from "~/utils/otp";
import {
  entryKindFor,
  POLL_SECONDS,
  PUBLISHING_REASONS,
  publishedEntries,
  REVOCATION_KIND_LABELS,
  REVOCATION_KIND_RULES,
  REVOCATION_PATH,
  type RevocationEntry,
  type RevocationKind,
  remainingShare,
  SNAPSHOT_CACHE_CONTROL,
  SNAPSHOT_PATH,
  SNAPSHOT_TTL_SECONDS,
  SNAPSHOT_TYP,
  SWEEP_SECONDS,
  secondsLeft,
  snapshotPayload,
} from "~/utils/revocation";
import { endedBy, REASON_LABELS, type RevokeReason } from "~/utils/sessions";
import { formatDateTime, relativeTime, relativeTimeWords } from "~/utils/time";

const { copy } = useClipboard();

const projects = useProjectStore();
const store = useRevocationsStore();
const lifetimes = useLifetimesStore();
const sessions = useSessionsStore();

/* A second, because the meters count down in seconds and a minute's tick would stall them. */
const now = useNow({ interval: 1000 });

/* Which cards start unfolded. The set and how it gets there are what a visit is for. */
const expanded = reactive({ set: true, path: true, limits: true, endpoint: false, cache: false });

const accessTokenSeconds = computed(
  () => lifetimes.settingsFor(projects.current.id).accessTokenSeconds,
);
const retentionSeconds = computed(() => snapshotRetentionSeconds(accessTokenSeconds.value));
const retentionLabel = computed(() => humanizeSeconds(retentionSeconds.value));

/* The set as the endpoint would serve it this second: seeded entries, minus what aged out. */
const entries = computed(() =>
  publishedEntries(store.entriesFor(projects.current.id), now.value, accessTokenSeconds.value),
);

const payload = computed(() => snapshotPayload(entries.value, accessTokenSeconds.value));

/*
 * The set is a table for the same reason every other list in the panel is: an operator
 * reading it is scanning for one id, and the columns they need to see to find it are
 * theirs to arrange. A row is the entry, and the last column is the one thing a list of
 * ids does not say on its own, which is how long each has left.
 */
/** What a token is matched on, which is the difference between the three shapes. */
const MATCHED_ON: Record<RevocationKind, string> = {
  session: "sid",
  user: "sub",
  project: "aud",
};

const KIND_RANK: Record<RevocationKind, number> = { project: 0, user: 1, session: 2 };

/*
 * The order is the default and the reader may change it, so the default has to put the
 * two things a visit is for where they cannot scroll away: which entry, and how long it
 * has left. What wrote it is off until somebody turns it on, because the reason is the
 * question asked second.
 */
const COLUMNS: readonly DataTableColumn<RevocationEntry>[] = [
  { key: "id", title: "Entry", fixed: true, mono: true, width: 210 },
  {
    key: "expires",
    title: "Leaves the set",
    width: 150,
    value: (entry) => secondsLeft(entry, now.value, accessTokenSeconds.value),
  },
  {
    key: "kind",
    title: "Ends",
    width: 210,
    value: (entry) => KIND_RANK[entry.kind],
  },
  {
    key: "revokedAt",
    title: "Revoked",
    width: 120,
    mono: true,
    value: (entry) => entry.revokedAt,
  },
  {
    key: "reason",
    title: "Written by",
    width: 180,
    hidden: true,
    skeleton: "pill",
    value: (entry) => (entry.reason === null ? "" : REASON_LABELS[entry.reason]),
  },
];

const stored = useLocalStorage<ColumnState>(
  "idenzy.revocations.columns",
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
const pageSize = useLocalStorage("idenzy.revocations.page-size", 10);

/* The two shapes are read for different reasons, so the list can be narrowed to one. */
const shapeTab = ref("all");

/**
 * Searching by id, which is the one thing somebody arrives here holding: a `sid` off a
 * token their own logs refused, asked of the set to find out whether we are the reason.
 */
const query = ref("");

const shapeOptions = computed(() => [
  { value: "all", label: `All · ${entries.value.length}` },
  {
    value: "session",
    label: `Sessions · ${entries.value.filter((entry) => entry.kind === "session").length}`,
  },
  {
    value: "user",
    label: `Accounts · ${entries.value.filter((entry) => entry.kind === "user").length}`,
  },
]);

const listed = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return entries.value.filter(
    (entry) =>
      (shapeTab.value === "all" || entry.kind === shapeTab.value) &&
      (needle === "" || entry.id.toLowerCase().includes(needle)),
  );
});

/* A narrowed list is read from the top, and a page number left behind shows nothing. */
watch([query, shapeTab, () => projects.current.id], () => {
  page.value = 1;
});

/*
 * Empty means two different things and must not read as one. An empty set is the ordinary
 * state and the copy has to say so, or an operator reads "0" as broken and goes looking
 * for a problem that is not there. An empty filter over a set that holds entries is not
 * that at all, and telling somebody nothing is revoked while five rows sit behind the
 * next tab is simply wrong.
 */
const SHAPE_NAMES: Record<string, string> = {
  session: "session entries",
  user: "account watermarks",
};

const emptyTitle = computed(() => {
  if (entries.value.length === 0) return "Nothing is revoked right now";
  if (query.value.trim() !== "") return "No entry matches that id";
  return `No ${SHAPE_NAMES[shapeTab.value] ?? "entries"} right now`;
});

const emptyDescription = computed(() => {
  if (entries.value.length === 0) {
    return `The ordinary state. An entry stays for ${retentionLabel.value} and then goes, because by then any token it could have killed has expired on its own. A revocation made now appears here and drains from the moment it lands.`;
  }
  if (query.value.trim() !== "") {
    return `Not in the set is not the same as not revoked: an entry older than ${retentionLabel.value} has aged out, and a session ended by one of its own expiries never wrote one. Check the session itself on the sessions list.`;
  }
  const held = entries.value.length === 1 ? "one entry" : `${entries.value.length} entries`;
  return `The set holds ${held} of the other shape. Sessions are ended one id at a time; an account watermark is written when every session it held ended at once.`;
});

/*
 * Whether anything is reading the set, which is the difference between a revocation
 * landing in seconds and waiting out a token lifetime. The same observation the lifetimes
 * screen makes, from the same place, because two screens disagreeing about it would be a
 * customer told twice that their exposure is two different things.
 */
const polledAt = computed(() => lifetimes.revocationPolledAt(projects.current.id));
const polling = computed(() => polledAt.value !== null);
const polledAgo = computed(() => {
  const at = polledAt.value;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

const endpointUrl = `https://auth.idenzy.dev${SNAPSHOT_PATH}`;

/* An id here is what somebody pastes into a log search, so the cell is a copy button. */
const toast = ref("");
const toastOpen = ref(false);

async function copyText(text: string, what: string) {
  await copy(text);
  toast.value = `${what} copied`;
  toastOpen.value = true;
}

const SAMPLE = `import { AccessTokenVerifier } from "@idenzy/node";
import { RemoteJwks } from "@idenzy/node/jwks";
import { RevocationCache } from "@idenzy/node/revocations";

const issuerUrl = "https://auth.idenzy.dev";
const projectId = "${"prj_01j9…"}";

// One key set, shared by the verifier and the cache, so neither fetches it twice.
const keys = new RemoteJwks(issuerUrl);

const revocations = new RevocationCache(
  { issuerUrl, projectId, secretKey: process.env["IDENZY_SECRET_KEY"] },
  keys,
);
// Fetches once, then keeps fetching. Its timer is unreferenced, so a script still exits.
await revocations.start();

const verifier = new AccessTokenVerifier({ issuerUrl, projectId, revocations }, keys);`;

/*
 * The counts, read off the sessions the panel already holds. What matters here is the
 * split the rest of the screen is about: an ending that writes an entry, and one that
 * writes nothing because there is nothing left for an entry to kill.
 */
const rows = computed(() => sessions.forProject(projects.current.id));

const endings = computed(() => {
  const counts = new Map<RevokeReason, number>();
  for (const row of rows.value) {
    const reason = endedBy(row, now.value);
    if (reason !== null) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return counts;
});

const countOf = (reason: RevokeReason) => endings.value.get(reason) ?? 0;

const written = computed(() =>
  [...endings.value.entries()]
    .filter(([reason]) => entryKindFor(reason) !== null)
    .reduce((total, [, count]) => total + count, 0),
);

const lapsed = computed(() =>
  [...endings.value.entries()]
    .filter(([reason]) => entryKindFor(reason) === null)
    .reduce((total, [, count]) => total + count, 0),
);

/** By reason, most common first, each marked with the shape it writes into the set. */
const writers = computed(() =>
  PUBLISHING_REASONS.map((reason) => ({
    reason,
    kind: entryKindFor(reason),
    count: countOf(reason),
  }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count),
);

const share = (count: number) =>
  written.value === 0 ? 0 : Math.round((count / written.value) * 100);

const MATCHES: Record<"session" | "user" | "project", string> = {
  session: "sid",
  user: "sub",
  project: "aud",
};

const GUIDES = [
  {
    icon: "material-symbols:block",
    title: "The revocation set",
    detail: "What is published, what it costs, and what it deliberately does not do.",
    href: "https://idenzy.dev/docs/tokens/revocation",
  },
  {
    icon: "material-symbols:verified-user-outline",
    title: "RevocationCache",
    detail: "Building one, the secret key it needs, and reading status().",
    href: "https://idenzy.dev/docs/sdk/node/revocations",
  },
  {
    icon: "material-symbols:dns-outline",
    title: "Server rendering",
    detail: "Passing a set through the Next, Nuxt, Svelte, Astro and Remix helpers.",
    href: "https://idenzy.dev/docs/sdk/ssr/revocations",
  },
  {
    icon: "material-symbols:timer-outline",
    title: "Access token lifetimes",
    detail: "The number the retention window is derived from.",
    href: "https://idenzy.dev/docs/tokens/lifetimes",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:block" title="Revocation">
      <template #description>
        Ending a session on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> before the
        access token it already handed out expires. Our own API refuses one at once; a
        verifier you run learns from a set we publish and it polls. Nothing here is a
        setting.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.set"
          :padded="false"
          description="What a poll would answer with this second. Entries age out on their own, which is the only reason the whole set can be published rather than a feed of changes."
          expandable
          title="The published set"
        >
          <template #badge>
            <StatusBadge
              :label="entries.length === 1 ? '1 entry' : `${entries.length} entries`"
              tone="neutral"
            />
          </template>
          <template #actions>
            <span class="flex items-center gap-1.5 text-xs text-ink/55">
              <template v-if="polling">
                <span aria-hidden="true" class="size-1.5 rounded-full bg-success" />
                Polled {{ polledAgo }}
              </template>
              <template v-else>
                <span aria-hidden="true" class="size-1.5 rounded-full bg-ink/30" />
                Nothing polls this
              </template>
            </span>
          </template>

          <div
            class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <SegmentedControl v-model="shapeTab" :options="shapeOptions" label="Entry shape" />

            <div class="flex flex-wrap items-center gap-2">
              <v-text-field
                v-model="query"
                aria-label="Search entries"
                class="revocation__search w-full sm:w-64"
                clearable
                density="comfortable"
                hide-details
                placeholder="Search by session or user ID"
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
            item-value="id"
            label="Revocation entries"
          >
            <template #cell.id="{ item }">
              <button
                :title="`Copy ${item.kind === 'user' ? 'user' : 'session'} ID`"
                class="group/id inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/65 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                type="button"
                @click="copyText(item.id, item.kind === 'user' ? 'User ID' : 'Session ID')"
              >
                <span class="truncate">{{ item.id }}</span>
                <Icon
                  aria-hidden="true"
                  class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/id:opacity-60"
                  name="material-symbols:content-copy-outline"
                />
              </button>
            </template>

            <!-- The shape rides with what it means, rather than in a column of its own:
                 "sid" alone says nothing to a reader who has not read the guide. -->
            <template #cell.kind="{ item }">
              <v-tooltip :text="REVOCATION_KIND_RULES[item.kind]" location="top" max-width="260">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-xs text-ink/80">
                      {{ REVOCATION_KIND_LABELS[item.kind] }}
                    </span>
                    <span
                      class="inline-flex flex-none rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/60"
                    >
                      {{ MATCHED_ON[item.kind] }}
                    </span>
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.reason="{ item }">
              <StatusBadge
                v-if="item.reason"
                :label="REASON_LABELS[item.reason]"
                :tone="item.reason === 'refresh_token_reuse' ? 'error' : 'neutral'"
              />
              <span v-else class="text-xs text-ink/45">Replayed</span>
            </template>

            <template #cell.revokedAt="{ item }">
              <v-tooltip :text="formatDateTime(item.revokedAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-[11px] text-ink/70 tabular-nums">
                    {{ relativeTime(item.revokedAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <!-- The one column a list of ids cannot say on its own. The bar is under the
                 figure rather than beside it, so the column reads as seconds first and
                 the drain is what the eye picks up scanning down. -->
            <template #cell.expires="{ item }">
              <span class="flex w-32 flex-col gap-1">
                <span class="flex items-baseline gap-1 text-xs">
                  <span class="font-mono text-ink tabular-nums">
                    {{ secondsLeft(item, now, accessTokenSeconds) }}s
                  </span>
                  <span class="text-ink/55">left</span>
                </span>
                <span
                  :aria-valuemax="100"
                  :aria-valuenow="Math.round(remainingShare(item, now, accessTokenSeconds) * 100)"
                  aria-valuemin="0"
                  class="block h-1 w-full overflow-hidden rounded-full bg-ink/8"
                  role="progressbar"
                >
                  <span
                    :class="
                      remainingShare(item, now, accessTokenSeconds) > 0.25
                        ? 'bg-primary/70'
                        : 'bg-ink/30'
                    "
                    :style="{ width: `${remainingShare(item, now, accessTokenSeconds) * 100}%` }"
                    class="block h-full rounded-full transition-[width] duration-1000 ease-linear"
                  />
                </span>
              </span>
            </template>
          </DataTable>

          <div
            class="grid gap-4 border-t border-line bg-canvas/60 px-4 py-3.5 text-[11px] leading-4 sm:grid-cols-2"
          >
            <p class="m-0 text-ink/60">
              <span class="font-medium text-ink">Kept for {{ retentionLabel }}.</span>
              One
              <NuxtLink
                class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                to="/tokens/lifetimes"
                >access-token lifetime</NuxtLink
              >
              plus a minute of skew. A token minted immediately before a revocation expires
              one lifetime later, so nothing older can still be presented.
            </p>
            <p class="m-0 text-ink/60">
              <span class="font-medium text-ink">A poll of an unchanged set is a 304.</span>
              The ETag is over the content rather than the signature, so a fleet of pollers
              costs conditional requests and almost no bytes.
            </p>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.path"
          description="From the revocation to a verifier refusing the token. Two of the four stages are ours and only the last is yours."
          expandable
          title="How a revocation travels"
        >
          <RevocationPath :stages="REVOCATION_PATH" />
        </LayerCard>

        <LayerCard
          v-model:open="expanded.limits"
          description="What the set is not, which is most of what an operator needs to know about it."
          expandable
          title="What it does not cover"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Our own endpoints read the session row on every authenticated request, so a revoked session is refused here at once and no set is involved. Everything on this screen is about the verifier you run, which is offline on purpose."
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
                <span class="font-mono text-ink/80">stale</span>, which is a third answer
                and not a third state of the token: it means that process cannot tell,
                never that everything is revoked and never that nothing is. Throwing
                instead would turn an outage of ours into an outage of yours on every
                request, which is worse than the delay it avoids.
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
                Nothing writes one yet, so there is no way to ask for it from here or from
                the API.
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
          v-model:open="expanded.endpoint"
          description="One GET that answers the whole set, signed. Everything about it is shaped by the fact that hundreds of your processes may be asking."
          expandable
          title="The endpoint"
        >
          <div class="mb-5 flex flex-col gap-1.5">
            <span class="text-xs font-medium text-ink">Snapshot URL</span>
            <CopyField :value="endpointUrl" label="Copy the snapshot URL" />
          </div>

          <div class="divide-y divide-line">
            <SettingRow label="Who may read it">
              <template #description>
                The project's secret key, never a publishable one. The payload names
                accounts whose sessions were all ended and times their security events, and
                a project id travels in the
                <span class="font-mono text-ink/80">aud</span> of every token we sign, so
                anyone holding one token could otherwise watch that project indefinitely.
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
              :description="`Signed with the project's own key, so a client verifies it with the key set it already caches. TLS ends at whatever you run this behind; the signature is what makes the payload's origin checkable where it arrives.`"
              fixed="ES256"
              label="How it is signed"
            />
            <SettingRow :fixed="SNAPSHOT_TYP" label="What stops a token confusion">
              <template #description>
                One key signs both a snapshot and an access token, so the signature alone
                does not say which you are holding. The header's
                <span class="font-mono text-ink/80">typ</span> is not
                <span class="font-mono text-ink/80">JWT</span>, both access-token verifiers
                require that it is, and the issuer refuses to put
                <span class="font-mono text-ink/80">sub</span> or
                <span class="font-mono text-ink/80">sid</span> in a statement at all. Any
                one of those alone would be a single point of failure.
              </template>
            </SettingRow>
            <SettingRow
              :description="`A signed snapshot may be trusted for ${SNAPSHOT_TTL_SECONDS} seconds. It is the only thing between a withheld snapshot and revocation quietly ceasing to work: anything on the path can serve an old copy, and an expiry is what turns that from invisible into stale.`"
              :fixed="`${SNAPSHOT_TTL_SECONDS}s`"
              label="How long one may be trusted"
            />
            <SettingRow
              :description="`Private, not public. A shared cache keyed on the URL would serve one project's set to another project's key. The ETag is what keeps polling cheap instead, and it is computed over the content rather than the signature: a fresh signature every poll would change the bytes each time and make the ETag useless.`"
              :fixed="SNAPSHOT_CACHE_CONTROL"
              label="Cache-Control"
            />
          </div>

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

        <LayerCard
          v-model:open="expanded.cache"
          description="Opt-in on your side, and what changes when you turn it on is the answer rather than the shape of it."
          expandable
          title="Attaching a cache"
        >
          <SamplePanel
            note="Built once and held, never per request. It holds a secret key and a polling timer, so its start and close belong to whoever owns the process."
            title="On a Node server"
          >
            <pre
              class="m-0 overflow-x-auto font-mono text-xs leading-5 text-ink"
            ><code>{{ SAMPLE }}</code></pre>
          </SamplePanel>

          <div class="mt-5 divide-y divide-line">
            <SettingRow
              :description="`Without one, verification is exactly what it was: signature, issuer, audience and lifetime, and no outbound call but the key set. A revoked session then keeps passing until its token expires, which is one access-token lifetime. With one, it is refused within a poll, about ${POLL_SECONDS} seconds.`"
              fixed="Opt-in"
              label="What it changes"
            />
            <SettingRow
              description="It needs the project's secret key, so it belongs on a server and nowhere else. The five server-rendering helpers each take a set and pass it through to the same verifier, and a helper without one verifies exactly as it did before."
              fixed="Server only"
              label="Where it may live"
            />
            <SettingRow label="Nuxt is the exception">
              <template #description>
                A module option is serialised into the build, so there is nowhere to hand
                over a live object. That module takes the secret key instead and builds the
                set itself, under
                <span class="font-mono text-ink/80">runtimeConfig</span> rather than
                <span class="font-mono text-ink/80">runtimeConfig.public</span>, and it does
                not await the first fetch: awaiting it on the first render would turn a hung
                connection into a page that never answers.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  Builds its own
                </span>
              </template>
            </SettingRow>
            <SettingRow
              :description="`A revoked session is a credential problem and not an outage, so a route guard redirects to your sign-in rather than answering 503. Getting that wrong is the one case that matters: as an outage it would be waved through wherever a gate is set to allow what it cannot judge.`"
              fixed="Sign in again"
              label="In a route guard"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Endings</h2>
          <span class="text-xs text-ink/55">On this project</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="53"
            :value="written"
            info="Sessions ended by somebody or something acting, each of which wrote an entry into the set."
            label="Wrote an entry"
          />
          <UsageTile
            :seed="59"
            :value="lapsed"
            info="Sessions that reached one of their two expiries. A lapse writes nothing, because by then there was no live token left to kill."
            label="Wrote nothing"
          />
        </div>

        <LayerCard
          :padded="false"
          description="Each writes one of two shapes, and the shape decides what a token is matched on."
          title="What wrote them"
        >
          <ul v-if="writers.length > 0" class="m-0 flex list-none flex-col gap-3 p-4 text-xs">
            <li v-for="entry in writers" :key="entry.reason" class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-3">
                <span class="min-w-0 truncate text-ink/80">
                  {{ REASON_LABELS[entry.reason] }}
                </span>
                <span class="flex flex-none items-baseline gap-2">
                  <span
                    v-if="entry.kind"
                    class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/55"
                  >
                    {{ MATCHES[entry.kind] }}
                  </span>
                  <span class="font-mono text-[11px] text-ink tabular-nums">
                    {{ entry.count.toLocaleString("en") }}
                  </span>
                </span>
              </div>
              <span class="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="entry.kind === 'user' ? 'bg-primary' : 'bg-ink/30'"
                  :style="{ width: `${share(entry.count)}%` }"
                  class="block h-full rounded-full"
                />
              </span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            Nothing has been revoked on this project yet.
          </p>
          <div
            v-if="writers.length > 0"
            class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink/55"
          >
            <span>
              <span class="font-mono text-ink">sub</span> is a watermark: one entry for the
              account, however many sessions it ended
            </span>
            <v-tooltip
              location="top"
              max-width="260"
              :text="`Signing out everywhere and a password reset end every session a user holds. One entry per session would not bound: a user with forty devices would write forty. ${REVOCATION_KIND_LABELS.user} is one entry and one comparison.`"
            >
              <template #activator="{ props: tip }">
                <Icon
                  v-bind="tip"
                  aria-label="Why a watermark"
                  class="flex-none text-sm text-ink/40"
                  name="material-symbols:info-outline"
                  role="img"
                />
              </template>
            </v-tooltip>
          </div>
        </LayerCard>

        <LayerCard
          :padded="false"
          :description="
            polling
              ? `Something holding this project's secret key is reading the set, so a revocation lands within one poll.`
              : `Nothing has read this project's set, so a revoked session is refused only once its token expires.`
          "
          title="Polling"
        >
          <div class="flex flex-col gap-2.5 p-4 text-xs">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Last read</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ polling ? polledAgo : "Never" }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Poll interval</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ POLL_SECONDS }}s
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Reconciler sweep</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ SWEEP_SECONDS }}s
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Retention</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ retentionSeconds }}s
              </span>
            </div>
          </div>
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
                <Icon
                  :name="guide.icon"
                  aria-hidden="true"
                  class="mt-px flex-none text-xl text-ink/70"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="font-medium text-ink">{{ guide.title }}</span>
                  <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
                </span>
              </a>
            </li>
          </ul>
        </LayerCard>
      </aside>
    </div>

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
   the small radius, so the row reads as one set. The same block the users screen carries,
   because the two toolbars must not be a size apart. */
.revocation__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.revocation__search :deep(.v-field__input),
.revocation__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
  min-height: 32px;
}

.revocation__search :deep(.v-field__prepend-inner > .v-icon),
.revocation__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
