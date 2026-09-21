<script setup lang="ts">
/**
 * Blocked email addresses: why one customer is not getting mail, and whether sending to
 * them can safely resume (notes/email-suppressions.md).
 *
 * The screen is a lookup and not a list, and the schema is why. `suppressions.target_hash`
 * holds a digest and no table anywhere holds the address, so a customer's block list is
 * not a harvestable list of every address that ever bounced for them. Every other vendor's
 * suppressions page is a searchable table of addresses; this one cannot be, so the address
 * is hashed in the browser and only the digest goes looking. The digest is shown back
 * because it is the proof: what left the machine was sixty-four hex characters and not the
 * address of the person who rang.
 *
 * The note's three findings shape the rest. A table of hashes cannot answer which customer
 * needs help, so the records are advanced evidence and the lookup is the page. A lookup
 * that finds nothing is not proof of deliverability, so every answer carries what was
 * compared and when, and says unknown where nothing writes to the list. And the page leads
 * with what it can actually do, because an empty list and an unbuilt recorder look
 * identical from here and only one of them is good news.
 */
import type { RecordColumn, RecordTab } from "~/components/RecordTable.vue";
import {
  canHash,
  DELIVERY_CAPABILITIES,
  deliveryStatus,
  hashAddress,
  ingestionAvailable,
  LOOKUP_ISSUE_LABELS,
  type LookupAnswer,
  type LookupIssue,
  type ReleaseRecord,
  reasonInfo,
  reasonLabel,
  SUPPRESSION_CHANNEL_LABELS,
  type SuppressionRow,
  shortDigest,
  tallyReasons,
  validateLookup,
} from "~/utils/suppressions";
import { applyDirection, type TableSort } from "~/utils/table-sort";
import { formatDateTime, relativeTime } from "~/utils/time";

const projects = useProjectStore();
const store = useSuppressionsStore();

const now = useNow({ interval: 30_000 });

/* Which cards start unfolded. None of them: the lookup and the records are the visit, and
   what the page can tell you is on the badge beside the title either way. */
const expanded = reactive({ capabilities: false, rules: false });

const rows = computed(() => store.forProject(projects.current.id));
const releases = computed(() => store.releasesFor(projects.current.id));

const status = deliveryStatus();
const ingestion = ingestionAvailable();
const missing = DELIVERY_CAPABILITIES.filter((entry) => entry.state === "not_built");

/* The two halves, headed rather than labelled per row. Which half an answer came from is
   the whole point of the card, and it is a heading's job rather than a repeated word. */
const CAPABILITY_GROUPS = [
  {
    id: "live",
    title: "Working here",
    note: "An answer from this half is the whole answer.",
    icon: "material-symbols:check-circle-outline",
    ink: "text-success",
    items: DELIVERY_CAPABILITIES.filter((entry) => entry.state === "live"),
  },
  {
    id: "pending",
    title: "Not built yet",
    note: "Anything resting on this half is unknown rather than good news.",
    icon: "material-symbols:pending-outline",
    ink: "text-warning",
    items: missing,
  },
];

/*
 * The lookup, which is the page.
 *
 * The address is hashed here and the digest is what goes looking, so the address is not
 * sent to us, not logged, and not put in a URL. What is held afterwards is the digest and
 * the answer, never the address beyond the field the reader typed it into.
 */
const address = ref("");
const checking = ref(false);
const issue = ref<LookupIssue | null>(null);
const answer = ref<LookupAnswer | null>(null);
const released = ref<ReleaseRecord | null>(null);

const field = useTemplateRef<{ focus: () => void }>("field");

const fieldId = useId();
const helpId = `${fieldId}-help`;
const issueId = `${fieldId}-issue`;

/* A new question clears the old answer, so a stale verdict is never read as this one. */
watch(address, () => {
  answer.value = null;
  released.value = null;
  issue.value = null;
});

watch(
  () => projects.current.id,
  () => {
    answer.value = null;
    released.value = null;
    issue.value = null;
  },
);

async function check() {
  const found = validateLookup(address.value);
  issue.value = found;
  if (found !== null) {
    answer.value = null;
    released.value = null;
    return;
  }
  await ask(address.value.trim());
}

/**
 * One comparison, and an answer that says what it compared.
 *
 * Two of the three verdicts are a finding; the third is the panel admitting it looked at
 * nothing. A browser that cannot hash and a list that has not been read both answer
 * unavailable rather than "not blocked", because an unread list is not an empty one.
 */
async function ask(asked: string) {
  checking.value = true;
  released.value = null;
  try {
    const failure = !canHash() ? "no_crypto" : store.loading ? "not_read" : null;
    if (failure !== null) {
      answer.value = {
        asked,
        digest: "",
        checkedAt: new Date().toISOString(),
        verdict: "unavailable",
        email: null,
        others: [],
        failure,
      };
      return;
    }

    const digest = await hashAddress(asked);
    const found = store.matches(projects.current.id, digest);
    const email = found.find((row) => row.channel === "email") ?? null;
    answer.value = {
      asked,
      digest,
      checkedAt: new Date().toISOString(),
      verdict: email === null ? "clear" : "blocked",
      email,
      others: found.filter((row) => row.channel !== "email"),
      failure: null,
    };
  } finally {
    checking.value = false;
  }
}

/** Asking the same address again, which is how a release is seen to have landed. */
async function recheck() {
  const held = answer.value;
  if (held === null) return;
  await ask(held.asked);
}

/** A new question: the field is cleared and focused rather than merely emptied. */
function another() {
  address.value = "";
  answer.value = null;
  released.value = null;
  issue.value = null;
  void nextTick(() => field.value?.focus());
}

/*
 * Releasing. Only from a lookup, because a row on its own names nobody: releasing by
 * clicking a digest would be taking an address off the list without knowing whose.
 */
/** The one block this screen can release, gathered so the dialog narrows from one guard. */
const releaseTarget = computed(() => {
  const held = answer.value;
  if (held?.email == null) return null;
  return { row: held.email, address: held.asked, others: held.others };
});

const releaseOpen = ref(false);
const releasing = ref(false);
const releaseError = ref("");
const evidenceOpen = ref(false);

function askRelease() {
  if (answer.value?.email == null) return;
  releaseError.value = "";
  releaseOpen.value = true;
}

/** The dialog closes on a confirmed write and on nothing else (notes/dialogs.md). */
async function confirmRelease(justification: string) {
  const held = answer.value;
  if (held?.email == null) return;
  releasing.value = true;
  releaseError.value = "";
  try {
    const record = await store.release(
      projects.current.id,
      held.digest,
      held.email.channel,
      justification,
    );
    answer.value = { ...held, verdict: "clear", email: null };
    released.value = record;
    releaseOpen.value = false;
    notify("Email block released");
  } catch {
    releaseError.value = "The release did not go through. Nothing changed, so try again.";
  } finally {
    releasing.value = false;
  }
}

const { copy } = useClipboard();

async function copyDigest(digest: string) {
  await copy(digest);
  notify("Digest copied");
}

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

/*
 * The records, which are evidence rather than a work list.
 */
const filterTab = ref("all");

const tally = computed(() => tallyReasons(rows.value));

/* The heading states the finding rather than naming the section twice, as the users and
   sessions lists do: what is on the list is the first thing a reader wants from it. */
const recordsHeading = computed(() => {
  /* Distinct targets, not rows: one address blocked on two channels is one person. */
  const count = new Set(rows.value.map((row) => row.targetHash)).size;
  if (count === 0) return "Nothing is blocked on this project";
  return count === 1 ? "One address is blocked" : `${count} addresses are blocked`;
});

/*
 * No records, no tabs. A filter strip over an empty table is a control with nothing to
 * filter, and "All · 0" beside a heading that already says nothing is blocked states the
 * same fact twice. `RecordTable` draws no toolbar for an empty list.
 */
const filterTabs = computed<RecordTab[]>(() =>
  rows.value.length === 0
    ? []
    : [
        { key: "all", label: "All", count: rows.value.length },
        ...tally.value.map((entry) => ({
          key: entry.reason,
          label: entry.label,
          count: entry.count,
        })),
      ],
);

/* A reason that was on the list and is not any more must not leave the tabs on nothing. */
watch([filterTabs, () => projects.current.id], ([options]) => {
  if (!options.some((option) => option.key === filterTab.value)) filterTab.value = "all";
});

/*
 * The records, on `RecordTable` and framed, which is the sending-domains list one drawer
 * item away. This is a handful of rows about one subject rather than the project-wide list
 * surface: a pager would read "1-6 of 6" and a column menu over four columns is furniture,
 * and the note calls this advanced evidence under a lookup rather than a list screen.
 */
const COLUMNS: readonly RecordColumn[] = [
  { key: "targetHash", label: "Target", width: "minmax(0, 1.4fr)", sortable: true },
  { key: "reason", label: "Why", width: "170px", sortable: true },
  { key: "channel", label: "Channel", width: "110px", sortable: true },
  { key: "createdAt", label: "Added", width: "120px", align: "end", sortable: true },
];

const COMPARE: Record<string, (a: SuppressionRow, b: SuppressionRow) => number> = {
  targetHash: (a, b) => a.targetHash.localeCompare(b.targetHash),
  reason: (a, b) => reasonLabel(a.reason).localeCompare(reasonLabel(b.reason)),
  channel: (a, b) =>
    SUPPRESSION_CHANNEL_LABELS[a.channel].localeCompare(SUPPRESSION_CHANNEL_LABELS[b.channel]),
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

/** Newest first, which is the order the list arrives in and what null means. */
const DEFAULT_SORT: TableSort = { key: "createdAt", direction: "desc" };

const sort = ref<TableSort | null>(DEFAULT_SORT);
const active = computed(() => sort.value ?? DEFAULT_SORT);

const listed = computed(() => {
  const compare = COMPARE[active.value.key] ?? COMPARE.createdAt;
  return rows.value
    .filter((row) => filterTab.value === "all" || row.reason === filterTab.value)
    .sort((a, b) => applyDirection(compare?.(a, b) ?? 0, active.value.direction));
});

const GUIDES_URL = "https://idenzy.io/docs/email/suppressions";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Blocked addresses">
      <template #badge>
        <StatusBadge :label="status.label" :tone="status.tone" />
      </template>
      <template #description>
        The email addresses
        <span class="font-medium text-ink">{{ projects.current.name }}</span> is currently
        blocked from sending to. {{ status.detail }}
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
          variant="text"
        >
          Delivery Guide
        </v-btn>
      </template>
    </PageHeader>

    <!--
      The lookup is the page, so it sits on the page rather than inside a card: a frame
      around the one control makes it a section among sections. The answer appears under
      the field, so the operator who came here with an address in a support ticket never
      has to find it in a list. The list cannot hold it in any case: the column is a digest.
    -->
    <form class="flex flex-col gap-2" @submit.prevent="check">
      <label :for="fieldId" class="text-sm font-medium text-ink">Email address</label>

      <v-text-field
        :id="fieldId"
        ref="field"
        v-model="address"
        :aria-describedby="issue ? issueId : helpId"
        :error="issue !== null"
        autocomplete="off"
        class="suppressions__field font-mono"
        density="comfortable"
        hide-details
        placeholder="someone@example.com"
        prepend-inner-icon="material-symbols:alternate-email"
        spellcheck="false"
        variant="outlined"
      >
        <!--
          Inside the field and against its right edge, rather than a control beside it.
          The lookup acts on nothing but what is in this box, and a button outside the
          border read as the next step in a form: on a phone it sat under the field at
          full width, which is the shape of a Continue. Inside, it is the field's own way
          of being asked, it needs no second row at any width, and the address and the way
          to check it cannot be separated by a wrap.
        -->
        <!--
          `type="button"` and its own handler, not a submit. `VField` calls
          `preventDefault()` on every click inside it that did not land on the input, which
          is how it keeps focus on the value while the field is clicked around — and a
          submit button's submission is that click's default action, so one placed in here
          is pressed, looks pressed, and does nothing. The form keeps its own handler for
          the Enter key, which never goes through that click.
        -->
        <template #append-inner>
          <v-btn
            :disabled="checking"
            class="-mr-2 text-xs font-medium text-ink/70 hover:text-ink"
            size="x-small"
            type="button"
            variant="text"
            @click="check"
          >
            <template #prepend>
              <Icon
                :class="checking ? 'animate-spin' : ''"
                :name="
                  checking ? 'material-symbols:progress-activity' : 'material-symbols:search'
                "
                aria-hidden="true"
                class="text-sm"
              />
            </template>
            Check address
          </v-btn>
        </template>
      </v-text-field>

      <p v-if="issue" :id="issueId" class="m-0 text-xs leading-5 text-error" role="alert">
        {{ LOOKUP_ISSUE_LABELS[issue] }}
      </p>
      <p v-else :id="helpId" class="m-0 text-xs leading-5 text-ink/55">
        The only way to connect an address to this list. It is hashed in your browser and
        the digest is what goes looking, so the address is not sent to us, not logged and
        not put in a URL.
      </p>

      <SuppressionLookupResult
        v-if="answer"
        :answer="answer"
        :ingestion="ingestion"
        :now="now"
        :project-name="projects.current.name"
        :released="released"
        class="mt-2"
        @another="another"
        @evidence="evidenceOpen = true"
        @recheck="recheck"
        @release="askRelease"
      />
    </form>

    <!--
      The records, in the shape the users and sessions lists use: a heading that states
      the finding, then one plain card holding the toolbar and the table. What it cannot
      do is answer which customer needs help, which is what the heading says and what the
      field above is for.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ store.loading ? "Reading this project's records" : recordsHeading }}
        </h2>
        <p class="m-0 text-xs text-ink/55">
          Every block on this project as it is stored: a digest, a channel, a reason and a
          date. A digest cannot be turned back into an address, so a row here names nobody
          and there is nothing to search. The field above is the only thing that can put a
          person to one.
        </p>
      </header>

      <RecordTable
        v-model:sort="sort"
        :aria-busy="store.loading"
        :columns="COLUMNS"
        :loading="store.loading"
        :tabs="filterTabs"
        v-model:tab="filterTab"
        framed
        label="Blocked targets"
      >
        <!-- Two rows of nothing while the store answers, so the frame keeps its height
             and the records arrive as a fill rather than as a jump. -->
        <template v-if="store.loading">
          <li v-for="row in 2" :key="row" class="record-row">
            <span class="record-cell record-cell--primary">
              <span class="block h-2.5 w-40 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-4 w-24 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2.5 w-16 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--end">
              <span class="block h-2.5 w-12 animate-pulse rounded-full bg-ink/6" />
            </span>
          </li>
        </template>

        <template v-else>
          <li v-for="item in listed" :key="item.id" class="record-row">
            <!-- The row identity is a digest, and it is all there is: no table holds the
                 address, so this cannot be turned back into one. -->
            <span class="record-cell record-cell--primary" data-label="Target">
              <button
                class="group/h inline-flex max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) font-mono text-[11px] text-ink/65 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                title="Copy the digest"
                type="button"
                @click="copyDigest(item.targetHash)"
              >
                <span class="truncate">{{ shortDigest(item.targetHash) }}</span>
                <Icon
                  aria-hidden="true"
                  class="flex-none text-xs opacity-0 transition-opacity duration-150 group-hover/h:opacity-60"
                  name="material-symbols:content-copy-outline"
                />
              </button>
            </span>

            <span class="record-cell record-cell--half flex items-start" data-label="Why">
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
            </span>

            <span class="record-cell record-cell--half text-xs text-ink/70" data-label="Channel">
              {{ SUPPRESSION_CHANNEL_LABELS[item.channel] }}
            </span>

            <span
              class="record-cell record-cell--half record-cell--end font-mono text-[11px] text-ink/70 tabular-nums"
              data-label="Added"
            >
              <v-tooltip :text="formatDateTime(item.createdAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip">{{ relativeTime(item.createdAt, now) }}</span>
                </template>
              </v-tooltip>
            </span>
          </li>
        </template>

        <template #empty>
          <div
            v-if="!store.loading && listed.length === 0"
            class="flex flex-col items-center gap-1 px-4 py-14 text-center"
            role="status"
          >
            <Icon
              aria-hidden="true"
              class="mb-1 text-2xl text-ink/25"
              name="material-symbols:block"
            />
            <p class="m-0 text-sm font-medium text-ink">No records on this project</p>
            <p class="m-0 max-w-md text-xs leading-5 text-ink/55">
              Nothing writes to this list yet, so an empty table is not the same as a project
              that has never had a bounce. An address that bounced today is still being sent
              to.
            </p>
          </div>
        </template>
      </RecordTable>

      <!-- Releasing deletes the row, so this is what is left of the decision. The
           justification is kept with it: a release nobody can account for later is the
           one thing worse than a block nobody can explain. -->
      <div v-if="releases.length > 0" class="flex flex-col gap-2">
        <h3 class="m-0 text-xs font-medium text-ink">Released from this project</h3>
        <ul class="m-0 flex list-none flex-col divide-y divide-line p-0">
          <li v-for="record in releases" :key="record.id" class="flex flex-col gap-1 py-3">
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span class="font-mono text-[11px] text-ink/70">
                {{ shortDigest(record.targetHash) }}
              </span>
              <span class="text-[11px] text-ink/55">
                {{ SUPPRESSION_CHANNEL_LABELS[record.channel] }} ·
                {{ reasonLabel(record.reason).toLowerCase() }} ·
                {{ relativeTime(record.releasedAt, now) }}
              </span>
            </div>
            <p v-if="record.justification" class="m-0 text-xs leading-5 text-ink/65">
              {{ record.justification }}
            </p>
          </li>
        </ul>
      </div>
    </section>

    <!--
      What the answer above is worth. An empty list and an unbuilt recorder are the same
      picture from here, so the halves are named separately rather than averaged into a
      reassuring sentence.
    -->
    <LayerCard
      v-model:open="expanded.capabilities"
      :padded="false"
      description="Blocking and releasing are live. Recording one is not, so what an answer here settles depends on which half it came from."
      expandable
      title="What this page can tell you"
    >
      <template #badge>
        <StatusBadge :label="status.label" :tone="status.tone" />
      </template>

      <!-- Grouped rather than a state word per row: the finding is that the two halves
           have to be told apart, and a heading each does that in half the height. -->
      <div class="divide-y divide-line">
        <section v-for="group in CAPABILITY_GROUPS" :key="group.id">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-ink/3 px-4 py-2">
            <Icon :class="group.ink" :name="group.icon" aria-hidden="true" class="text-sm" />
            <h3 :class="group.ink" class="m-0 text-[11px] font-medium tracking-wide uppercase">
              {{ group.title }}
            </h3>
            <span class="text-[11px] leading-4 text-ink/50">{{ group.note }}</span>
          </div>
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="capability in group.items"
              :key="capability.id"
              class="grid grid-cols-1 gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]"
            >
              <span class="text-xs leading-5 font-medium text-ink">{{ capability.label }}</span>
              <span class="text-xs leading-5 text-ink/60">{{ capability.finding }}</span>
            </li>
          </ul>
        </section>
      </div>
      <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
        Nothing here is a delivery log. Whether a message arrived is answered in the
        provider console, and this list only ever says what we refuse to send.
      </p>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.rules"
      description="What a block guarantees, and the two places it deliberately gives you no choice."
      expandable
      title="How blocking behaves"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="Checked by the provider base before any transport runs, so no adapter can skip it and no caller has to remember it. A new email provider inherits the check by extending the base, which is the whole reason the base owns it."
          fixed="Before sending"
          label="Where it is enforced"
        />
        <SettingRow label="Whether you can override it">
          <template #description>
            You cannot, and that is deliberate rather than missing. A sending reputation is
            shared with every project on the domain, so one customer sending to known-dead
            addresses degrades delivery for everybody else. What you can do is allow one
            address again, which is a decision about one person rather than a setting.
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
          description="A row names a channel, so an address blocked for email says nothing about SMS to the same person, and releasing one leaves the other standing. Only email consults the list today; the SMS path is guarded by its own country allowlist and spend cap instead."
          fixed="Per channel"
          label="What it covers"
        />
        <SettingRow
          description="A second hard bounce for an address already blocked is normal and writes nothing new. It must not fail the webhook that reported it, or a provider retrying its notification would look like an outage on our side."
          fixed="Idempotent"
          label="The same bounce twice"
        />
        <SettingRow label="What a blocked send answers">
          <template #description>
            <span class="font-mono text-ink/80">delivery_suppressed</span>, a 403, and it is
            not retryable. That is the difference from
            <span class="font-mono text-ink/80">delivery_failed</span>, which means the
            transport had a problem and trying again is reasonable. Retrying a block is never
            reasonable.
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
          description="Releasing deletes the row rather than flagging it, so a released address carries nothing saying it was once blocked. Your reason is kept separately. There is no bulk version: clearing a list of bounces in one click is how a domain gets blocked."
          fixed="One at a time"
          label="Allowing email again"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="store.lastChangedAt(projects.current.id)" :saving="releasing" />

    <SuppressionReleaseDialog
      v-if="releaseTarget"
      v-model="releaseOpen"
      :address="releaseTarget.address"
      :busy="releasing"
      :error="releaseError"
      :others="releaseTarget.others"
      :project-name="projects.current.name"
      :row="releaseTarget.row"
      @confirm="confirmRelease"
    />

    <SuppressionEvidenceDialog
      v-if="answer"
      v-model="evidenceOpen"
      :answer="answer"
      :ingestion="ingestion"
      :missing="missing"
      :project-name="projects.current.name"
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
/*
 * The lookup field is the page's one input, and it carries its own button. Only the
 * corner, the glyph and the two inner ends are set here: comfortable density is already
 * the toolbar's height and 13px, which is the type of every other field in the panel.
 *
 * A height stated on the field alone is what this looked like before. theme.css sets
 * `--v-input-control-height` on the input root and on the field because Vuetify
 * redeclares it per variant, and the control's box is sized from the root: overriding the
 * field's copy grew the text's own box past the border it sits in and left the value
 * riding low inside it.
 */
.suppressions__field :deep(.v-field) {
  border-radius: var(--idenzy-radius-small);
}

.suppressions__field :deep(.v-field__prepend-inner > .v-icon) {
  font-size: 1rem;
}

/*
 * Both inner ends centre on the field's own line rather than hanging from its top.
 * Vuetify aligns them to `flex-start` and pads them down by a floating label's height,
 * which this panel does not use: left alone the glyph and the button sit a few pixels
 * high in a box whose text is centred, and on a 24px button inside a 36px field that
 * reads as a control that has slipped rather than one that is small.
 */
.suppressions__field :deep(.v-field__append-inner),
.suppressions__field :deep(.v-field__prepend-inner) {
  align-items: center;
  padding-top: 0;
}

/*
 * No ground under the button on hover. Vuetify answers a pointer with a tinted overlay
 * across the whole control, which inside a field draws a second box against the one the
 * border already makes and reads as a control sitting on the value rather than in the
 * same box as it. The label going to full strength is the whole answer, which is what
 * every other quiet button in the panel does.
 */
.suppressions__field :deep(.v-field__append-inner .v-btn__overlay) {
  opacity: 0;
}
</style>
