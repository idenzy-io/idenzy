<script setup lang="ts">
/**
 * Suppressions: the addresses this project must never send to again (PROJECT.md 11.1,
 * 11.2, `packages/persistence/src/schema/messaging.ts`).
 *
 * The screen is shaped by one decision in the schema. `target_hash` holds a digest and no
 * table anywhere holds the address, so that a customer's suppression list is not a
 * harvestable list of every address that ever bounced for them. Every other vendor's
 * suppressions page is a searchable table of addresses; this one cannot be, and pretending
 * otherwise would mean asking the server to keep the very thing it deliberately does not.
 *
 * So the primary control is a lookup rather than a search: an address is hashed in the
 * browser and only the digest goes looking. That is a real privacy property and not a
 * gesture, which is why the digest is shown back: a support agent can see that what left
 * their machine was sixty-four hex characters and not the address of the person who rang.
 *
 * The list below it is still worth drawing, because channel, reason and date say things a
 * digest column does not, and a row appearing yesterday is the signal an operator came for.
 * What it cannot do is connect a row to a person, which is what the lookup is for.
 *
 * Nothing writes to this list yet. The provider event pipeline is designed and not built,
 * so a real project's list is empty, and the empty state says that rather than letting it
 * read as "this project has never had a bounce".
 */
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  hashAddress,
  LOOKUP_ISSUE_LABELS,
  type LookupIssue,
  reasonInfo,
  reasonLabel,
  SUPPRESSION_CHANNEL_LABELS,
  SUPPRESSION_REASONS,
  SUPPRESSION_SOURCES,
  type SuppressionRow,
  shortDigest,
  tallyReasons,
  validateLookup,
} from "~/utils/suppressions";
import { formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useSuppressionsStore();

const now = useNow({ interval: 30_000 });

/* Which cards start unfolded. The lookup and the list are what a visit is for. */
const expanded = reactive({ sources: false, rules: false });

const rows = computed(() => store.forProject(projects.current.id));

/*
 * The lookup. The address is hashed here and the digest is what goes looking, so the
 * address never leaves this machine: it is not sent to us, not logged, and not put in a
 * URL. What is held afterwards is the digest and the answer, never the address itself
 * beyond the field the reader typed it into.
 */
const address = ref("");
const checking = ref(false);

interface Answer {
  /** The address as it was asked about, for the sentence that reports the result. */
  asked: string;
  digest: string;
  row: SuppressionRow | null;
}

const answer = ref<Answer | null>(null);
const issue = ref<LookupIssue | null>(null);

/* A new question clears the old answer, so a stale verdict is never read as this one. */
watch(address, () => {
  answer.value = null;
  issue.value = null;
});

watch(
  () => projects.current.id,
  () => {
    answer.value = null;
    issue.value = null;
  },
);

async function check() {
  const found = validateLookup(address.value);
  issue.value = found;
  answer.value = null;
  if (found !== null) return;

  checking.value = true;
  try {
    const asked = address.value.trim();
    const digest = await hashAddress(asked);
    answer.value = { asked, digest, row: store.find(projects.current.id, digest) };
  } finally {
    checking.value = false;
  }
}

/*
 * Releasing. Only from a lookup, because a row on its own names nobody: releasing by
 * clicking a digest would be taking an address off the list without knowing which.
 */
const releaseOpen = ref(false);
const releasing = ref(false);

function askRelease() {
  if (answer.value?.row) releaseOpen.value = true;
}

async function confirmRelease() {
  const held = answer.value;
  if (held?.row == null) return;
  releasing.value = true;
  try {
    await store.release(projects.current.id, held.digest);
    answer.value = { ...held, row: null };
    releaseOpen.value = false;
    notify(`${held.asked} can be sent to again`);
  } finally {
    releasing.value = false;
  }
}

const { copy } = useClipboard();

async function copyText(text: string, what: string) {
  await copy(text);
  notify(`${what} copied`);
}

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

/*
 * The list.
 */
const filterTab = ref("all");

const tally = computed(() => tallyReasons(rows.value));

const filterOptions = computed(() => [
  { value: "all", label: `All · ${rows.value.length}` },
  ...tally.value.map((entry) => ({
    value: entry.reason,
    label: `${entry.label} · ${entry.count}`,
  })),
]);

/* A reason that was on the list and is not any more must not leave the tabs on nothing. */
watch([filterOptions, () => projects.current.id], ([options]) => {
  if (!options.some((option) => option.value === filterTab.value)) filterTab.value = "all";
});

const listed = computed(() =>
  filterTab.value === "all"
    ? rows.value
    : rows.value.filter((row) => row.reason === filterTab.value),
);

const COLUMNS: readonly DataTableColumn<SuppressionRow>[] = [
  { key: "targetHash", title: "Target", fixed: true, mono: true, width: 200 },
  {
    key: "reason",
    title: "Why",
    width: 190,
    skeleton: "pill",
    value: (row) => reasonLabel(row.reason),
  },
  {
    key: "channel",
    title: "Channel",
    width: 120,
    value: (row) => SUPPRESSION_CHANNEL_LABELS[row.channel],
  },
  { key: "createdAt", title: "Added", width: 130, mono: true, value: (row) => row.createdAt },
];

const stored = useLocalStorage<ColumnState>(
  "idenzy.suppressions.columns",
  defaultColumnState(COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});
const sortBy = ref<DataTableSort[]>([{ key: "createdAt", order: "desc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.suppressions.page-size", 25);

watch([filterTab, () => projects.current.id], () => {
  page.value = 1;
});

const severe = computed(
  () => rows.value.filter((row) => reasonInfo(row.reason)?.severe === true).length,
);

const GUIDES = [
  {
    icon: "material-symbols:do-not-disturb-on-outline",
    title: "Suppressions",
    detail: "What lands on the list, what it costs to ignore, and how to release one.",
    href: "https://idenzy.dev/docs/email/suppressions",
  },
  {
    icon: "material-symbols:mark-email-unread-outline",
    title: "Bounces and complaints",
    detail: "The provider events behind each reason, and what each one means.",
    href: "https://idenzy.dev/docs/email/bounces",
  },
  {
    icon: "material-symbols:webhook",
    title: "The email.bounced webhook",
    detail: "Reacting to the same signal in your own system.",
    href: "https://idenzy.dev/docs/webhooks/email",
  },
  {
    icon: "material-symbols:verified-outline",
    title: "Sending reputation",
    detail: "Why a shared domain makes this not a per-project decision.",
    href: "https://idenzy.dev/docs/email/reputation",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:do-not-disturb-on-outline" title="Suppressions">
      <template #description>
        Addresses <span class="font-medium text-ink">{{ projects.current.name }}</span> must
        never send to again. The list is stored as digests rather than addresses, so it
        cannot be read or searched: ask it about an address instead.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          description="The only way to connect an address to this list. It is hashed in your browser and the digest is what goes looking, so the address is not sent to us, not logged and not put in a URL."
          title="Ask about an address"
        >
          <form class="flex flex-col gap-3" @submit.prevent="check">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <v-text-field
                  v-model="address"
                  :error="issue !== null"
                  aria-label="Email address"
                  autocomplete="off"
                  class="suppressions__field font-mono"
                  density="comfortable"
                  hide-details
                  placeholder="someone@example.com"
                  prepend-inner-icon="material-symbols:alternate-email"
                  spellcheck="false"
                  variant="outlined"
                />
                <p v-if="issue" class="m-0 text-[11px] leading-4 text-error">
                  {{ LOOKUP_ISSUE_LABELS[issue] }}
                </p>
              </div>
              <FancyButton :disabled="checking" type="submit">
                <Icon
                  :class="checking ? 'animate-spin' : ''"
                  :name="
                    checking ? 'material-symbols:progress-activity' : 'material-symbols:search'
                  "
                  aria-hidden="true"
                  class="text-sm"
                />
                Check
              </FancyButton>
            </div>

            <!-- The answer, and the digest that produced it. Showing the digest is the
                 point rather than decoration: it is how a reader can see that what left
                 the browser was not the address they typed. -->
            <div
              v-if="answer"
              :class="
                answer.row
                  ? 'border-warning/40 bg-warning/6'
                  : 'border-success/40 bg-success/6'
              "
              class="flex flex-col gap-3 rounded-(--idenzy-radius-small) border px-4 py-3.5"
            >
              <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div class="flex min-w-0 items-start gap-2.5">
                  <Icon
                    :class="answer.row ? 'text-warning' : 'text-success'"
                    :name="
                      answer.row
                        ? 'material-symbols:do-not-disturb-on-outline'
                        : 'material-symbols:check-circle-outline'
                    "
                    aria-hidden="true"
                    class="mt-px flex-none text-lg"
                  />
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <p class="m-0 text-sm font-medium text-ink">
                      <template v-if="answer.row">
                        {{ answer.asked }} is suppressed
                      </template>
                      <template v-else>{{ answer.asked }} is not suppressed</template>
                    </p>
                    <p class="m-0 text-xs leading-5 text-ink/65">
                      <template v-if="answer.row">
                        {{ reasonLabel(answer.row.reason) }}, added
                        {{ relativeTime(answer.row.createdAt, now) }}. Every message to it is
                        refused before any transport runs.
                      </template>
                      <template v-else>
                        Nothing on this project's list matches it, so mail to it is attempted
                        normally. A delivery problem is somewhere else.
                      </template>
                    </p>
                  </div>
                </div>

                <v-btn
                  v-if="answer.row"
                  class="flex-none text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:undo"
                  size="small"
                  variant="outlined"
                  @click="askRelease"
                >
                  Release
                </v-btn>
              </div>

              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink/55">
                <span>Asked as</span>
                <button
                  class="group/d inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-ink/75 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  title="Copy the digest"
                  type="button"
                  @click="copyText(answer.digest, 'Digest')"
                >
                  <span class="truncate">{{ answer.digest }}</span>
                  <Icon
                    aria-hidden="true"
                    class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/d:opacity-60"
                    name="material-symbols:content-copy-outline"
                  />
                </button>
              </div>
            </div>
          </form>
        </LayerCard>

        <LayerCard :padded="false" title="On the list">
          <template #badge>
            <StatusBadge
              :label="rows.length === 1 ? '1 address' : `${rows.length} addresses`"
              :tone="severe > 0 ? 'warning' : 'neutral'"
            />
          </template>

          <div
            class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <SegmentedControl v-model="filterTab" :options="filterOptions" label="Reason" />
            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
          </div>

          <DataTable
            v-model:column-state="columnState"
            v-model:items-per-page="pageSize"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :columns="COLUMNS"
            :items="listed"
            :loading="store.loading"
            empty-description="Nothing writes to this list yet: the provider event pipeline that turns a bounce or a complaint into a row is designed and not built. So this is not the same as a project that has never had one, and an address that bounced today is still being sent to."
            empty-title="Nothing is suppressed"
            item-value="id"
            label="Suppressed targets"
          >
            <!-- The row identity is a digest, and it is all there is: no table holds the
                 address, so this cannot be turned back into one. -->
            <template #cell.targetHash="{ item }">
              <button
                class="group/h inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/65 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                title="Copy the digest"
                type="button"
                @click="copyText(item.targetHash, 'Digest')"
              >
                <span class="truncate">{{ shortDigest(item.targetHash) }}</span>
                <Icon
                  aria-hidden="true"
                  class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/h:opacity-60"
                  name="material-symbols:content-copy-outline"
                />
              </button>
            </template>

            <template #cell.reason="{ item }">
              <v-tooltip
                :text="reasonInfo(item.reason)?.note ?? item.reason"
                location="top"
                max-width="280"
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="inline-flex">
                    <StatusBadge
                      :label="reasonLabel(item.reason)"
                      :tone="reasonInfo(item.reason)?.severe ? 'warning' : 'neutral'"
                    />
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.channel="{ item }">
              <span class="text-xs text-ink/70">
                {{ SUPPRESSION_CHANNEL_LABELS[item.channel] }}
              </span>
            </template>

            <template #cell.createdAt="{ item }">
              <v-tooltip :text="formatDateTime(item.createdAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-[11px] text-ink/70 tabular-nums">
                    {{ relativeTime(item.createdAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>
          </DataTable>

          <div class="border-t border-line bg-canvas/60 px-4 py-3 text-[11px] leading-4 text-ink/60">
            <span class="font-medium text-ink">A digest cannot be turned back into an address.</span>
            That is the reason there is no search here, and the reason the box above exists:
            it is the only thing that can put a name to a row.
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.sources"
          description="Three ways a row appears, and none of them work yet."
          expandable
          title="How an address gets here"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="source in SUPPRESSION_SOURCES"
              :key="source.id"
              :description="source.detail"
              :fixed="source.built ? 'Live' : 'Not built'"
              :label="source.title"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.rules"
          description="What the list guarantees, and the two places it deliberately gives you no choice."
          expandable
          title="How it behaves"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Checked by the provider base before any transport runs, so no adapter can skip it and no caller has to remember it. A new email provider inherits the check by extending the base, which is the whole reason the base owns it."
              fixed="Before sending"
              label="Where it is enforced"
            />
            <SettingRow label="Whether you can override it">
              <template #description>
                You cannot, and that is deliberate rather than missing. A sending
                reputation is shared with every project on the domain, so one customer
                sending to known-dead addresses degrades delivery for everybody else. What
                you can do is release a specific address, which is a decision about one
                person rather than a setting.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  No
                </span>
              </template>
            </SettingRow>
            <SettingRow
              description="One customer's bounce never mutes another's mail: the list is scoped to the project like every other tenant table, and a test asserts it at the database rather than trusting the query."
              fixed="Per project"
              label="Who it applies to"
            />
            <SettingRow
              description="A row names a channel, so an address suppressed for email says nothing about SMS to the same person. Only email consults the list today; the SMS path is guarded by its own country allowlist and spend cap instead."
              fixed="Per channel"
              label="What it covers"
            />
            <SettingRow
              description="A second hard bounce for an address already on the list is normal and writes nothing new. It must not fail the webhook that reported it, or a provider retrying its notification would look like an outage on our side."
              fixed="Idempotent"
              label="The same bounce twice"
            />
            <SettingRow label="What a blocked send answers">
              <template #description>
                <span class="font-mono text-ink/80">delivery_suppressed</span>, a 403, and it
                is not retryable. That is the difference from
                <span class="font-mono text-ink/80">delivery_failed</span>, which means the
                transport had a problem and trying again is reasonable. Retrying a
                suppression is never reasonable.
              </template>
              <template #actions>
                <span
                  class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                >
                  403
                </span>
              </template>
            </SettingRow>
            <SettingRow
              description="Releasing deletes the row rather than flagging it, so a released address carries nothing saying it was once suppressed. It is a deliberate action and there is no bulk version: clearing a list of bounces in one click is how a domain gets blocked."
              fixed="A delete"
              label="Releasing"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">The list</h2>
          <span class="text-xs text-ink/55">On this project</span>
        </div>

        <LayerCard :padded="false" title="What it holds">
          <div class="flex flex-col gap-2.5 p-4 text-xs">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Addresses</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">{{ rows.length }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Reported by a provider</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">{{ severe }}</span>
            </div>
          </div>
          <ul
            v-if="tally.length > 0"
            class="m-0 flex list-none flex-col gap-3 border-t border-line p-4 text-xs"
          >
            <li v-for="entry in tally" :key="entry.reason" class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-3">
                <span :class="entry.severe ? 'text-ink' : 'text-ink/70'" class="min-w-0 truncate">
                  {{ entry.label }}
                </span>
                <span class="flex-none font-mono text-[11px] text-ink tabular-nums">
                  {{ entry.count }}
                </span>
              </div>
              <span class="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="entry.severe ? 'bg-warning' : 'bg-ink/30'"
                  :style="{ width: `${Math.round((entry.count / rows.length) * 100)}%` }"
                  class="block h-full rounded-full"
                />
              </span>
            </li>
          </ul>
          <p v-else class="m-0 border-t border-line px-4 py-6 text-center text-xs text-ink/50">
            Nothing is suppressed on this project.
          </p>
        </LayerCard>

        <LayerCard :padded="false" description="Why an address ends up here, worst first." title="The reasons">
          <ul class="m-0 flex list-none flex-col divide-y divide-line p-0">
            <li v-for="reason in SUPPRESSION_REASONS" :key="reason.id" class="flex gap-2.5 px-4 py-3">
              <Icon
                :class="reason.severe ? 'text-warning' : 'text-ink/45'"
                :name="reason.icon"
                aria-hidden="true"
                class="mt-px flex-none text-base"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs font-medium text-ink">{{ reason.label }}</span>
                <span class="text-[11px] leading-4 text-ink/55">{{ reason.note }}</span>
              </span>
            </li>
          </ul>
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

        <SaveStatus :last-saved="store.lastChangedAt(projects.current.id)" :saving="releasing" />
      </aside>
    </div>

    <SuppressionReleaseDialog
      v-if="answer?.row"
      v-model="releaseOpen"
      :address="answer.asked"
      :releasing="releasing"
      :row="answer.row"
      @confirm="confirmRelease"
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
/* The lookup field is the page's one input and sits at the height of the button beside
   it, in the same small type as every other field in the panel. */
.suppressions__field :deep(.v-field) {
  --v-input-control-height: 36px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.8125rem;
}

.suppressions__field :deep(.v-field__input),
.suppressions__field :deep(.v-field__input::placeholder) {
  font-size: 0.8125rem;
  min-height: 36px;
}

.suppressions__field :deep(.v-field__prepend-inner > .v-icon) {
  font-size: 1rem;
}
</style>
