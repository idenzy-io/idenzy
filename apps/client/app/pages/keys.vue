<script setup lang="ts">
/**
 * API keys for the project: the two credentials that name it, what each one may do, and the
 * one procedure that replaces a key without taking the application down.
 *
 * Three facts about `api_keys` decide the whole shape of this screen, and each of them
 * removes a control the genre usually has.
 *
 * The row keeps `sha256(key)` under a unique index, never ciphertext. So there is no reveal
 * on a row and there is no eye glyph: the value exists in one dialog, once, and the panel
 * could not show it again whoever asked. Every good keys page has to pick a side of that
 * trade, and this schema picked it before the screen existed.
 *
 * `revoked_at` is read on the request path with no cache in front of it, so revoking is
 * immediate and total. There is therefore no grace window to offer and no "roll" button that
 * could grant one. Rotation is instead a state the project is in, made of two live keys of
 * one kind, and `last_used_at` is the only thing that says when the old one has gone quiet
 * enough to take away. That is why the rotation card exists and why it is the first thing on
 * the page when it applies: it is the only screen state with an action nobody else will
 * prompt for.
 *
 * There is no test mode and there will not be one, which is the question everybody arriving
 * from Stripe asks first. Our tenant is the project: RLS is keyed on `app.project_id`, every
 * table carries it, and a test project's users, sessions and audit trail are different rows
 * behind a different policy. A mode flag inside one project would be a second tenancy model
 * laid over the first, and its failure mode is a test sign-in landing in the production users
 * table. Switching projects is the answer, and the switcher is already in the drawer.
 *
 * Two absences worth naming. There is no name field, because the row has no column for one:
 * a key is told apart by its prefix and its dates, and a field the server drops is worse than
 * the gap it papers over. And there is no scope picker, because `scopes` is on the row and no
 * guard reads it yet; offering one would describe a restriction nothing applies, which is the
 * mistake `UnconfiguredAttestation` refuses to make on the SMS screen.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  API_KEY_KINDS,
  type ApiKeyKind,
  countKeys,
  ENV_NAMES,
  isLive,
  isQuiet,
  KEY_FORMAT,
  KEY_KIND_CARRIERS,
  KEY_KIND_LABELS,
  KEY_KIND_PREFIXES,
  KEY_STATE_LABELS,
  KEY_STATE_RANK,
  type KeyFilter,
  type KeyState,
  keyStateOf,
  maskedKey,
  matchesKeyFilter,
  type ProjectApiKey,
  QUIET_HOURS,
  rotationOf,
  SCOPES,
  tallyKeyAges,
} from "~/utils/keys";
import { formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useKeysStore();
const { copy } = useClipboard({ legacy: true });

/* A quiet window is counted back from now, so the clock has to move or a key stops
   becoming safe to revoke while somebody is looking at the row. */
const now = useNow({ interval: 30_000 });

const keys = computed(() => store.keysFor(projects.current.id));
const counts = computed(() => countKeys(keys.value));
const stats = computed(() => store.stats(projects.current.id));

/** A key and the state it is in, which is the only shape the list reads. */
interface KeyRow {
  id: string;
  key: ProjectApiKey;
  state: KeyState;
}

/*
 * Which keys the list shows. It opens on the live ones, because a revoked key is a record
 * rather than something to act on, and the segments carry their own counts.
 */
const filter = ref<KeyFilter>("live");

const FILTERS: readonly KeyFilter[] = ["live", "revoked", "all"];

const filterTab = computed({
  get: () => filter.value as string,
  set: (value: string) => {
    if ((FILTERS as readonly string[]).includes(value)) filter.value = value as KeyFilter;
  },
});

const filterOptions = computed<SegmentedOption[]>(() => [
  { value: "live", label: `Live · ${counts.value.live}` },
  { value: "revoked", label: `Revoked · ${counts.value.revoked}` },
  { value: "all", label: `All · ${counts.value.all}` },
]);

const rows = computed<KeyRow[]>(() =>
  keys.value
    .filter((key) => matchesKeyFilter(key, filter.value))
    .map((key) => ({ id: key.id, key, state: keyStateOf(key) })),
);

const STATE_TONES: Record<KeyState, BadgeTone> = {
  in_use: "success",
  unused: "warning",
  revoked: "neutral",
};

const COLUMNS: readonly DataTableColumn<KeyRow>[] = [
  {
    key: "key",
    title: "Key",
    fixed: true,
    minWidth: 280,
    skeleton: "identity",
    value: (row) => row.key.prefix,
  },
  {
    key: "state",
    title: "State",
    width: 150,
    skeleton: "pill",
    value: (row) => KEY_STATE_RANK[row.state],
  },
  {
    key: "access",
    title: "Access",
    width: 156,
    value: (row) => row.key.kind,
  },
  {
    key: "createdAt",
    title: "Created",
    mono: true,
    width: 124,
    value: (row) => row.key.createdAt,
  },
  {
    key: "lastUsedAt",
    title: "Last used",
    mono: true,
    width: 132,
    value: (row) => row.key.lastUsedAt ?? "",
  },
];

const stored = useLocalStorage<ColumnState>("idenzy.keys.columns", defaultColumnState(COLUMNS));
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});

/* Never-used first, then by age. A key nobody has called is either a rotation somebody
   started and left, or one that was pasted somewhere nobody remembers. */
const sortBy = ref<DataTableSort[]>([
  { key: "state", order: "asc" },
  { key: "createdAt", order: "desc" },
]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.keys.page-size", 10);

/* Which cards start unfolded. Where a key goes is what a first visit is for; the rest are
   folded until somebody has come looking for one. */
const expanded = reactive({ where: true, rotating: false, never: false });

/*
 * Rotations. Only a kind with more than one live key is in one, so on most projects most of
 * the time this is empty and the card is not drawn at all.
 */
const rotations = computed(() =>
  API_KEY_KINDS.map((kind) => rotationOf(keys.value, kind, now.value)).filter(
    (rotation) => rotation.rotating,
  ),
);

/** How many live keys of each kind, for the create dialog's rotation note. */
const liveOf = computed<Record<ApiKeyKind, number>>(() => ({
  publishable: keys.value.filter((key) => key.kind === "publishable" && isLive(key)).length,
  secret: keys.value.filter((key) => key.kind === "secret" && isLive(key)).length,
}));

/** What the project has no live key of at all, which is what a first visit is missing. */
const missing = computed(() => API_KEY_KINDS.filter((kind) => liveOf.value[kind] === 0));

/*
 * Making one.
 */

const createOpen = ref(false);
const creating = ref(false);

/** Whichever kind the project has none of, so the common first move is one click. */
const suggested = computed<ApiKeyKind>(() => missing.value[0] ?? "secret");

/**
 * The plaintext, held for exactly as long as the dialog showing it is open.
 *
 * A ref on the page rather than state in the store, and dropped on close rather than left
 * for the garbage collector, because the value is the one thing on this screen that could
 * not be fetched again if it leaked into somewhere it should not be.
 */
const revealed = ref<{ key: ProjectApiKey; secret: string } | null>(null);
const revealOpen = ref(false);

async function confirmCreate(kind: ApiKeyKind) {
  creating.value = true;
  try {
    revealed.value = await store.create(projects.current.id, kind);
    revealOpen.value = true;
  } finally {
    creating.value = false;
  }
}

function forgetRevealed() {
  revealed.value = null;
}

/*
 * Taking one away.
 */

const revoking = ref<ProjectApiKey | null>(null);
const revokeOpen = ref(false);
const busy = ref<Set<string>>(new Set());

function isBusy(id: string): boolean {
  return busy.value.has(id);
}

function askRevoke(key: ProjectApiKey) {
  revoking.value = key;
  revokeOpen.value = true;
}

async function confirmRevoke() {
  const key = revoking.value;
  if (key === null) return;
  busy.value = new Set([...busy.value, key.id]);
  try {
    await store.revoke(projects.current.id, key.id);
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key.id));
  }
}

/* Read here rather than in the template, so the dialog's props narrow and the subject
   survives the frame in which the dialog is closing. */
const revokingKey = computed(() => revoking.value);
const revokingBusy = computed(() => revoking.value !== null && isBusy(revoking.value.id));
const revokingLastOfKind = computed(() => {
  const key = revoking.value;
  if (key === null) return false;
  return liveOf.value[key.kind] <= 1;
});

/* A dialog belongs to the project it was opened from, and a revealed key certainly does. */
watch(
  () => projects.current.id,
  () => {
    createOpen.value = false;
    revokeOpen.value = false;
    revealOpen.value = false;
    revealed.value = null;
    revoking.value = null;
    page.value = 1;
  },
);

watch(filter, () => {
  page.value = 1;
});

function copyText(value: string) {
  void copy(value);
}

/*
 * The figures beside the list.
 */
const ages = computed(() => tallyKeyAges(keys.value, now.value));

const GUIDES_URL = "https://idenzy.dev/docs/keys";

const GUIDES = [
  {
    icon: "material-symbols:vpn-key-outline",
    title: "Which key goes where",
    detail: "The browser header, the Authorization line, and what each one may do.",
    href: GUIDES_URL,
  },
  {
    icon: "material-symbols:swap-horiz",
    title: "Rotating a key",
    detail: "Two live keys, a deployment, and the check that says when to revoke.",
    href: `${GUIDES_URL}/rotation`,
  },
  {
    icon: "material-symbols:terminal",
    title: "idenzy init",
    detail: "What the scaffolder writes into your environment file, and what it will not.",
    href: "https://idenzy.dev/docs/cli",
  },
  {
    icon: "material-symbols:cloud-outline",
    title: "Keys on a server SDK",
    detail: "Where the secret key belongs in Next, Nuxt, SvelteKit and Node.",
    href: "https://idenzy.dev/docs/sdk/node",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:vpn-key-outline" title="API keys">
      <template #description>
        The two credentials that name
        <span class="font-medium text-ink">{{ projects.current.name }}</span> to us. One is
        meant for a browser bundle and the other must never reach one, and the prefix is what
        tells them apart before any lookup happens.
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
          Key guide
        </v-btn>
        <FancyButton @click="createOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Create key
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <!-- Drawn only while a kind has two live keys, which is a rotation somebody has
             started and not finished. It is first on the page because it is the one state
             here with an action nothing else will prompt for. -->
        <LayerCard
          v-for="rotation in rotations"
          :key="rotation.kind"
          :padded="false"
          :description="`Two live ${KEY_KIND_LABELS[rotation.kind].toLowerCase()}s. Both work, which is the point: deploy the new one, wait for the old one to go quiet, then take it away.`"
          :title="`Rotation in progress: ${KEY_KIND_LABELS[rotation.kind].toLowerCase()}`"
        >
          <template #badge>
            <StatusBadge
              :label="rotation.quiet ? 'Safe to finish' : 'Old key still in use'"
              :tone="rotation.quiet ? 'success' : 'warning'"
            />
          </template>

          <ul class="m-0 list-none divide-y divide-line p-0">
            <li
              v-if="rotation.current"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
            >
              <span
                aria-hidden="true"
                class="flex size-8 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) bg-success/10 text-success"
              >
                <Icon class="text-base" name="material-symbols:arrow-downward" />
              </span>
              <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                <span class="font-mono text-xs text-ink">{{ maskedKey(rotation.current) }}</span>
                <span class="text-[11px] text-ink/55">
                  Traffic is arriving here.
                  {{
                    rotation.current.lastUsedAt
                      ? `Last used ${relativeTime(rotation.current.lastUsedAt, now)}.`
                      : "Nothing has called with it yet, so nothing is deployed on it."
                  }}
                </span>
              </div>
              <span class="text-[11px] font-medium text-success">Keep</span>
            </li>

            <li
              v-for="old in rotation.previous"
              :key="old.id"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
            >
              <span
                :class="isQuiet(old, now) ? 'bg-ink/6 text-ink/60' : 'bg-warning/10 text-warning'"
                aria-hidden="true"
                class="flex size-8 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
              >
                <Icon
                  :name="
                    isQuiet(old, now)
                      ? 'material-symbols:check-circle-outline'
                      : 'material-symbols:pending-outline'
                  "
                  class="text-base"
                />
              </span>
              <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                <span class="font-mono text-xs text-ink">{{ maskedKey(old) }}</span>
                <span class="text-[11px] text-ink/55">
                  <template v-if="old.lastUsedAt === null">
                    Never used. Nothing is holding it, so it can go.
                  </template>
                  <template v-else-if="isQuiet(old, now)">
                    Silent for over {{ QUIET_HOURS }} hours. Last used
                    {{ relativeTime(old.lastUsedAt, now) }}.
                  </template>
                  <template v-else>
                    Still answering, {{ relativeTime(old.lastUsedAt, now) }}. Something is
                    holding it: finish the deployment before taking it away.
                  </template>
                </span>
              </div>
              <v-btn
                :color="isQuiet(old, now) ? 'error' : 'neutral'"
                :loading="isBusy(old.id)"
                class="text-xs font-medium"
                size="small"
                variant="text"
                @click="askRevoke(old)"
              >
                Revoke
              </v-btn>
            </li>
          </ul>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="What exists, what it may do, and when it was last used. The value itself is not here and never was: only its digest was kept."
          title="Keys"
        >
          <template #badge>
            <StatusBadge
              :label="
                counts.live === 0
                  ? 'No live key'
                  : `${counts.live} live${counts.unused > 0 ? `, ${counts.unused} never used` : ''}`
              "
              :tone="counts.live === 0 ? 'error' : counts.unused > 0 ? 'warning' : 'success'"
            />
          </template>

          <div
            class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <SegmentedControl v-model="filterTab" :options="filterOptions" label="Keys" />
            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
          </div>

          <DataTable
            v-model:column-state="columnState"
            v-model:items-per-page="pageSize"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :columns="COLUMNS"
            :items="rows"
            :loading="store.loading"
            label="API keys"
          >
            <template #cell.key="{ item }">
              <KeyIdentity :key-row="item.key" />
            </template>

            <template #cell.state="{ item }">
              <StatusBadge
                :detail="
                  item.state === 'revoked' && item.key.revokedAt
                    ? relativeTime(item.key.revokedAt, now)
                    : ''
                "
                :label="KEY_STATE_LABELS[item.state]"
                :tone="STATE_TONES[item.state]"
              />
            </template>

            <template #cell.access="{ item }">
              <v-tooltip
                :text="
                  item.key.kind === 'secret'
                    ? SCOPES.note
                    : 'A publishable key names the project and authorises nothing. It cannot read a user, change a setting or mint a token.'
                "
                location="top"
                max-width="300"
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="text-xs text-ink/70">
                    {{ item.key.kind === "secret" ? SCOPES.label : "Names the project" }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.createdAt="{ item }">
              <v-tooltip :text="formatDateTime(item.key.createdAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                    {{ relativeTime(item.key.createdAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.lastUsedAt="{ item }">
              <span v-if="item.key.lastUsedAt === null" class="text-ink/35">Never</span>
              <v-tooltip v-else :text="formatDateTime(item.key.lastUsedAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                    {{ relativeTime(item.key.lastUsedAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #actions="{ item }">
              <KeyRowActions
                :key-row="item.key"
                @copy-id="copyText(item.key.id)"
                @copy-prefix="copyText(item.key.prefix)"
                @revoke="askRevoke(item.key)"
              />
            </template>

            <template #empty>
              <EmptyState
                v-if="filter === 'live' && counts.all === 0"
                description="Nothing can reach this project yet. A publishable key is what your application sends from the browser; a secret key is what your server sends. Both are shown once, when they are made."
                icon="material-symbols:vpn-key-outline"
                title="No keys yet"
              >
                <template #actions>
                  <FancyButton @click="createOpen = true">
                    <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                    Create the first key
                  </FancyButton>
                </template>
              </EmptyState>
              <div v-else class="flex flex-col items-center gap-1 px-4 py-14 text-center">
                <Icon
                  :class="filter === 'revoked' ? 'text-success/70' : 'text-ink/25'"
                  :name="
                    filter === 'revoked'
                      ? 'material-symbols:check-circle-outline'
                      : 'material-symbols:vpn-key-outline'
                  "
                  aria-hidden="true"
                  class="mb-1 text-2xl"
                />
                <p class="m-0 text-sm font-medium text-ink">
                  {{
                    filter === "revoked" ? "Nothing has been revoked" : "No live key on this project"
                  }}
                </p>
                <p class="m-0 max-w-sm text-xs text-ink/55">
                  {{
                    filter === "revoked"
                      ? "A revoked key stays on this list for the record, so a log line naming its prefix next year still has something to point at."
                      : "Every key here has been revoked. Nothing can reach the project until a new one is made and deployed."
                  }}
                </p>
              </div>
            </template>
          </DataTable>

          <div
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[10px] leading-4 text-ink/45"
          >
            <p class="m-0">
              Only a {{ KEY_FORMAT.digest }} digest is kept, so no key here can be shown a
              second time. The first {{ KEY_FORMAT.prefixLength }} characters are stored in the
              clear, which is what a row, a log line and your own file have in common.
            </p>
            <p class="m-0">Every key made and revoked is in the audit log.</p>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.where"
          expandable
          description="Which credential goes where, and what each one is allowed to do when it gets there."
          title="Where each key goes"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :description="`Sent from the browser on ${KEY_KIND_CARRIERS.publishable}. It names the project and authorises nothing: it cannot read a user, change a setting or mint a token, which is what makes shipping it the intended use rather than a leak.`"
              :fixed="KEY_KIND_PREFIXES.publishable"
              label="Publishable key"
            />
            <SettingRow
              description="The header takes a pk_ and nothing else, refused on the prefix before any lookup runs. So a secret key pasted into client config and a fabricated one cost the same work and get the same answer, and neither learns whether it was real."
              fixed="Always"
              label="Refused on the prefix"
            />
            <SettingRow
              description="Sent from your server on the Authorization header as a bearer token. It acts as the project on the management API, so anything your backend can do it can do."
              :fixed="KEY_KIND_PREFIXES.secret"
              label="Secret key"
            />
            <SettingRow
              description="The prefix is what the caller typed; the kind is what we provisioned, and the two are checked independently. A row whose kind is secret but whose value was issued with a pk_ prefix is a provisioning mistake, and it must not become a secret key that works from a browser."
              fixed="Both"
              label="Prefix and kind"
            />
            <SettingRow
              description="The publishable-key header first, then Authorization, then Host. First present wins rather than falling through: a header that is present but resolves to nothing is a hard failure, because falling back to Host would let a request that named one project execute against another."
              fixed="In order"
              label="How a request finds its project"
            />
            <SettingRow :description="SCOPES.note" :fixed="SCOPES.label" label="What a key may do" />
          </div>

          <SamplePanel
            class="mt-5"
            note="What our own scaffolder writes, and the one line it will not write. The browser prefix is your framework's: VITE_, NEXT_PUBLIC_, PUBLIC_."
            title="In your environment file"
          >
            <div class="flex flex-col gap-1">
              <SampleLine icon="material-symbols:public" mono>
                {{ ENV_NAMES.publishable }}={{ KEY_KIND_PREFIXES.publishable }}…
              </SampleLine>
              <SampleLine icon="material-symbols:lock-outline" mono>
                {{ ENV_NAMES.secret }}={{ KEY_KIND_PREFIXES.secret }}…
                <span class="text-ink/45">&nbsp;# server only, never a public prefix</span>
              </SampleLine>
              <SampleLine icon="material-symbols:info-outline" tone="muted">
                <span class="font-mono">idenzy init</span> writes the first and refuses the
                second on its prefix before writing anything: a bundle publishes at build time,
                and nothing afterwards unpublishes it.
              </SampleLine>
            </div>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.rotating"
          expandable
          description="Replacing a key without a minute of downtime. Three steps, and the middle one is the only one that needs patience."
          title="Rotating a key"
        >
          <ol class="m-0 flex list-none flex-col gap-4 p-0">
            <li v-for="(step, index) in 3" :key="step" class="flex items-start gap-3">
              <span
                aria-hidden="true"
                class="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border border-line bg-canvas font-mono text-[11px] leading-none text-ink tabular-nums"
              >
                {{ index + 1 }}
              </span>
              <div class="flex min-w-0 flex-col gap-1">
                <p class="m-0 text-sm font-medium text-ink">
                  {{
                    ["Make the new key", "Deploy it, and wait", "Revoke the old one"][index]
                  }}
                </p>
                <p class="m-0 text-xs leading-5 text-ink/60">
                  <template v-if="index === 0">
                    Both keys are live from this moment and both work. The row does not replace
                    anything, which is the whole reason this can be done without downtime.
                  </template>
                  <template v-else-if="index === 1">
                    Ship the new value, then watch the old key's last-used time on this page. It
                    is the only evidence that everything holding the old key has actually been
                    replaced, and it is why the middle step is a wait rather than a click. This
                    panel calls a key finished once it has been silent for
                    {{ QUIET_HOURS }} hours.
                  </template>
                  <template v-else>
                    Revoking lands on the very next request: the lookup reads
                    <span class="font-mono text-ink/80">revoked_at</span> with no cache in front
                    of it. That is why step two is not optional, and why there is no button here
                    that promises an overlap the server would not honour.
                  </template>
                </p>
              </div>
            </li>
          </ol>

          <p
            class="m-0 mt-5 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas px-3 py-2.5 text-[11px] leading-4 text-ink/65"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-ink/40"
              name="material-symbols:bolt"
            />
            <span>
              A key you believe is compromised does not get this procedure. Revoke it first and
              deploy second: a few minutes of failed requests is a smaller problem than a live
              credential in somebody else's hands.
            </span>
          </p>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.never"
          expandable
          description="Four things this screen is regularly expected to do and does not."
          title="What a key never does"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :description="`Only ${KEY_FORMAT.digest} of the key is stored, under a unique index, so there is nothing to decrypt and nothing a copy of that table would yield. A reveal here is not a feature nobody built: it is one that cannot exist without changing what is kept, and what is kept is the reason a stolen backup is not a stolen key.`"
              fixed="Never"
              label="Come back a second time"
            />
            <SettingRow
              description="There is no test mode, because the project is the environment. Tenancy is keyed on the project id at the database, so a second project's users, sessions and audit trail are different rows behind a different policy. A mode flag inside one project would be a second tenancy model over the first, and its failure is a test sign-in in the production users table."
              fixed="Never"
              label="Carry a test mode"
            />
            <SettingRow
              description="No expiry, no reminder, no forced rotation. A key that stopped working on a date nobody wrote down is an outage at three in the morning, and an expiry a customer can set is one they will set once and forget. What this screen does instead is show you how old the live ones are."
              fixed="Never"
              label="Expire on its own"
            />
            <SettingRow
              description="A key is the project acting, not a person. The audit trail records the key's own id as the actor, which is why a key row stays after it is revoked: it is the only thing an old entry can be matched back to. If you need to know which colleague did something, that is a team member and not a key."
              fixed="Never"
              label="Name a person"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Keys</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="71"
            :value="stats.live"
            info="Keys that would resolve a request right now. A revoked key is refused on the very next call, so this is the whole of what works."
            label="Live keys"
          />
          <UsageTile
            :seed="73"
            :value="stats.unused"
            info="Live keys nothing has ever called. Either a rotation nobody finished, or a key pasted somewhere nobody remembers."
            label="Never used"
          />
          <UsageTile
            :seed="75"
            :series="stats.callsDaily"
            :value="stats.calls"
            info="Requests that presented one of this project's keys, by any of them."
            label="Calls"
          />
          <UsageTile
            :seed="77"
            :series="stats.refusedDaily"
            :value="stats.refused"
            info="Calls refused because the key was unknown or revoked. A run of these after a rotation means something is still holding the old value."
            label="Refused"
          />
        </div>

        <LayerCard
          :padded="false"
          description="Nothing expires on its own, so this is the only reminder there is."
          title="How old the live keys are"
        >
          <ul v-if="counts.live > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="bucket in ages" :key="bucket.id" class="flex items-center gap-2.5">
              <span class="w-28 flex-none truncate text-ink/80">{{ bucket.label }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="bucket.id === 'ancient' ? 'bg-warning' : 'bg-primary'"
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
            This project has no live key, so nothing can reach it.
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

        <!-- There is no save line here, because nothing on this page is a setting that
             writes itself. Making and revoking a key are actions, and the audit log is
             where they are kept. -->
        <p class="m-0 px-1 text-center text-[11px] leading-4 text-ink/50">
          Every key made and revoked is recorded in the
          <NuxtLink
            class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
            to="/audit"
          >
            audit log </NuxtLink
          >, against your name.
        </p>
      </aside>
    </div>

    <KeyCreateDialog
      v-model="createOpen"
      :busy="creating"
      :live-of="liveOf"
      :suggested="suggested"
      @confirm="confirmCreate"
    />

    <KeyRevealDialog
      v-model="revealOpen"
      :key-row="revealed?.key ?? null"
      :secret="revealed?.secret ?? ''"
      @done="forgetRevealed"
    />

    <KeyRevokeDialog
      v-model="revokeOpen"
      :busy="revokingBusy"
      :key-row="revokingKey"
      :last-of-kind="revokingLastOfKind"
      @confirm="confirmRevoke"
    />
  </div>
</template>
