<script setup lang="ts">
/**
 * The origins a project trusts with a credentialed response (ADR-0006, PROJECT.md 4.10,
 * notes/domains-origins.md).
 *
 * The whole difficulty of this screen is that a missing entry fails silently. The request
 * reaches us, we answer it normally, and the browser throws the response away: there is no
 * status to look at, nothing in anybody's server log, and the customer's first reading is
 * that the SDK is broken. So the screen's job is diagnosis, and the checker is what makes
 * it one: paste the URL a page is served from, watch it reduce to an origin, and read
 * whether that origin is permitted before anything is changed.
 *
 * What it must not do is answer a question nobody is measuring. Nothing records the
 * `Origin` on a request yet, so `Last observed use` is a column that says "not recorded"
 * and the figures at the top read as no data. An empty list of refusals on this screen
 * would be the most expensive false comfort in the panel: it would look like proof that
 * nobody was blocked, when it is proof that nobody is counting.
 *
 * The ADR asks the dashboard to suggest origins from the lists a project has already
 * filled in and to have somebody confirm each one. That is the suggestions section, and it
 * is suggestion in both directions: allowing one from there is an ordinary write, and
 * nothing about a magic link or a passkey origin changes this list on its own. Two
 * deliberate acts was the point of keeping the tables apart, so each row says what
 * accepting it grants.
 */
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  ALLOW_ORIGIN_HEADER,
  checkOrigin,
  corsSample,
  OBSERVED_FIGURES,
  ORIGIN_SOURCE_FROM,
  ORIGIN_SOURCES,
  ORIGIN_TELEMETRY,
  type OriginSource,
  SUGGESTION_GRANT,
  suggestionsFrom,
} from "~/utils/origins";
import { isRefusal } from "~/utils/sign-in-errors";

const projects = useProjectStore();
const store = useOriginsStore();
const otp = useOtpStore();
const passkeys = usePasskeysStore();
const providers = useProvidersStore();

const now = useNow({ interval: 60_000 });

const project = computed(() => projects.current.id);

/* Read when the screen opens and again whenever the project changes. `forProject` is
   deliberately synchronous — six screens read it in a computed, and a fetch inside one is a
   request per render — so something has to fill the cache, and this is it. */
watch(project, (id) => void store.load(id), { immediate: true });

function reload() {
  void store.load(project.value);
}

const origins = computed(() => store.forProject(projects.current.id));
const allowed = computed(() => origins.value.map((entry) => entry.origin));

/* Reference, and it starts folded: the list and the check are what a visit is for. */
const expanded = reactive({ rules: false });

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

/*
 * What the project's other lists imply. Read from the stores that own them, so this
 * screen cannot offer a redirect target the magic-link screen no longer holds.
 */
const suggestions = computed(() =>
  suggestionsFrom(
    {
      magic_link: otp.settingsFor(projects.current.id).magicLink.redirectUris,
      oauth: providers.returnUrisFor(projects.current.id),
      passkey: passkeys.settingsFor(projects.current.id).relyingParty?.origins ?? [],
    },
    allowed.value,
  ),
);

/*
 * Adding and removing.
 */

const addOpen = ref(false);
const addError = ref("");
const removeOpen = ref(false);
const removing = ref("");
const removeError = ref("");
/**
 * What went wrong on a write with no dialog of its own: a suggestion accepted from its row, or
 * the checker's own Allow. Both change a permission from a control with no footer to put a
 * sentence in, so the sentence goes under the list heading.
 */
const failure = ref("");

function openAdd() {
  addError.value = "";
  addOpen.value = true;
}

async function confirmAdd(origin: string) {
  addError.value = "";
  failure.value = "";
  await whileBusy("add", async () => {
    try {
      await store.add(projects.current.id, origin);
      addOpen.value = false;
    } catch (cause: unknown) {
      addError.value = refused(cause, origin);
    }
  });
}

function accept(origin: string, source: OriginSource | null) {
  failure.value = "";
  void whileBusy(origin, async () => {
    try {
      await store.add(projects.current.id, origin, source);
    } catch (cause: unknown) {
      failure.value = refused(cause, origin);
    }
  });
}

function askRemoval(origin: string) {
  removeError.value = "";
  removing.value = origin;
  removeOpen.value = true;
}

async function confirmRemoval() {
  removeError.value = "";
  await whileBusy(removing.value, async () => {
    try {
      await store.remove(projects.current.id, removing.value);
      removeOpen.value = false;
    } catch {
      removeError.value =
        "It was not removed, so a page there can still read what the API answers. Try again.";
    }
  });
}

/**
 * What a refused write says.
 *
 * A conflict is the one worth its own sentence and the one most likely here, because a
 * suggestion offered from a stale list is exactly how two people racing on one project meet.
 * Everything else is the same sentence: nothing was granted.
 */
function refused(cause: unknown, origin: string): string {
  return isRefusal(cause, ErrorCode.Conflict)
    ? `${origin} is already allowed on this project. Reload to see the list as it is now.`
    : "The origin was not allowed. Nothing changed, so try again.";
}

/*
 * The checker, which is what makes this a diagnosis screen rather than a form.
 */

const typed = ref("");
const asked = ref("");
const checking = ref(false);

const answer = computed(() => checkOrigin(asked.value, allowed.value));

async function check() {
  if (typed.value.trim() === "") return;
  checking.value = true;
  /* A visible wait, because an answer that appears in the same frame as the click reads
     as validation rather than as a check that was run. */
  await new Promise((resolve) => setTimeout(resolve, 350));
  asked.value = typed.value;
  checking.value = false;
}

/* An answer is about the string it was asked, so editing the field takes it away. */
watch(typed, () => {
  asked.value = "";
});

function allowChecked() {
  const found = answer.value;
  if (found === null || !found.addable) return;
  failure.value = "";
  void whileBusy(found.origin, async () => {
    try {
      await store.add(projects.current.id, found.origin, null);
      /* Re-asked against the list as it now is, so the verdict above the button changes to
         match what the button just did. */
      asked.value = found.origin;
    } catch (cause: unknown) {
      failure.value = refused(cause, found.origin);
    }
  });
}

const VERDICT_MARKS: Record<string, { icon: string; tone: string }> = {
  allowed: { icon: "material-symbols:check-circle-outline", tone: "text-success" },
  blocked: { icon: "material-symbols:cancel-outline", tone: "text-warning" },
  refusable: { icon: "material-symbols:block", tone: "text-warning" },
  unusable: { icon: "material-symbols:info-outline", tone: "text-ink/50" },
};

/*
 * The list.
 */

const LIST_COLUMNS: readonly RecordColumn[] = [
  { key: "origin", label: "Configured origin", width: "minmax(0, 1.6fr)" },
  { key: "source", label: "Added from", width: "170px" },
  { key: "seen", label: "Last observed use", width: "150px" },
  { key: "remove", label: "Remove", width: "104px", align: "end" },
];

const listHeading = computed(() => {
  const count = origins.value.length;
  /* A failed re-read keeps the rows it had, and the heading says which of the two this is:
     nothing known, or something known and now a read behind. */
  if (store.refusal !== null)
    return count === 0
      ? "This project's origins could not be read"
      : "The last read failed, so this is the list from before it";
  if (count === 0) return "No origin is allowed";
  return count === 1 ? "One origin is allowed" : `${count} origins are allowed`;
});

/*
 * The two answers, side by side. The status is the same and one header is not, which is
 * the whole of what this list decides and is not something prose says convincingly.
 */
const sampleOrigin = computed(() => allowed.value[0] ?? "https://app.example.com");
const samples = computed(() => [
  { id: "allowed", title: "An origin on the list", sample: corsSample(sampleOrigin.value, true) },
  {
    id: "unknown",
    title: "One that is not",
    sample: corsSample("https://elsewhere.example", false),
  },
]);

const GUIDES_URL = "https://idenzy.dev/docs/origins";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Allowed origins">
      <template #badge>
        <!-- "None allowed" over a list we failed to read would be the worst claim on the
             screen: it is the state an operator is here to fix. -->
        <StatusBadge
          v-if="store.refusal !== null"
          label="Not read"
          tone="warning"
        />
        <StatusBadge
          v-else
          :label="origins.length === 0 ? 'None allowed' : `${origins.length} allowed`"
          :tone="origins.length === 0 ? 'warning' : 'success'"
        />
      </template>
      <template #description>
        The pages that may read a credentialed response from the auth API on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >. Exact matches, no wildcards, and its own list: a redirect URI and a passkey
        origin do not add one here.
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
          CORS guide
        </v-btn>
        <FancyButton :disabled="isBusy('add')" @click="openAdd()">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Allow origin
        </FancyButton>
      </template>
    </PageHeader>

    <!--
      What has actually called, which is nothing anybody records. The tiles are here rather
      than absent because these are the first four questions asked of a list like this, and
      the honest answer is a shape with no series in it.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Observed use</h2>
        <span class="text-xs text-ink/55">Last 30 days</span>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UsageTile
          v-for="figure in OBSERVED_FIGURES"
          :key="figure.id"
          :info="figure.info"
          :label="figure.label"
          :seed="figure.seed"
          :value="0"
        />
      </div>

      <!-- The one caveat this screen cannot do without: an empty answer here is not
           evidence (notes/domains-origins.md, acceptance checks). -->
      <p class="m-0 text-[11px] leading-4 text-ink/55">
        <template v-if="ORIGIN_TELEMETRY">
          Counted from the Origin header on requests to this project.
        </template>
        <template v-else>
          Nothing records the Origin header on a request yet, so there are no figures and no
          list of origins that were refused. Read that as nobody counting rather than as
          nobody being blocked: a refusal is invisible from here by construction, which is
          what the check below is for.
        </template>
      </p>
    </section>

    <!--
      The configured list. The origin is never truncated: it is compared as one exact
      string and this is the column somebody checks against their own address bar.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ store.loading ? "Reading this project's origins" : listHeading }}
        </h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Compared against the Origin header as one exact string. A change takes effect on
          the next request, because the list rides the lookup that resolves the project.
        </p>
      </header>

      <!-- A write with no dialog to put a sentence in: a suggestion's own Allow, or the
           checker's. -->
      <InfoNote
        v-if="failure"
        :text="failure"
        icon="material-symbols:error-outline"
        tone="warning"
      />

      <!-- A read that failed says so and offers the read again. Left to the empty state
           below, it would tell somebody no origin is allowed, which is the one state this
           screen exists to fix. Rows already read stay under it. -->
      <div v-if="store.refusal" class="flex flex-col items-start gap-2.5">
        <InfoNote :text="store.refusal" icon="material-symbols:error-outline" tone="warning" />
        <v-btn
          :loading="store.loading"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:refresh"
          size="small"
          variant="outlined"
          @click="reload()"
        >
          Try again
        </v-btn>
      </div>

      <RecordTable
        v-if="store.refusal === null || origins.length > 0"
        :columns="LIST_COLUMNS"
        framed
        label="Allowed origins"
      >
        <template v-if="store.loading">
          <li v-for="row in 2" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex items-center gap-3">
              <span
                class="size-7 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8"
              />
              <span class="h-2.5 w-48 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2.5 w-28 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2.5 w-20 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--action" />
          </li>
        </template>

        <template v-else>
          <OriginRow
            v-for="entry in origins"
            :key="entry.origin"
            :busy="isBusy(entry.origin)"
            :entry="entry"
            :now="now"
            @remove="askRemoval(entry.origin)"
          />
        </template>

        <!-- The empty state names who is affected rather than claiming nobody can sign in:
             a server calls the API without an Origin at all, and the development loopback
             is allowed by the deployment (notes/domains-origins.md P1). -->
        <template #empty>
          <div
            v-if="!store.loading && origins.length === 0"
            class="flex flex-col items-center gap-1.5 px-4 py-12 text-center"
          >
            <Icon
              aria-hidden="true"
              class="mb-1 text-2xl text-ink/25"
              name="material-symbols:language"
            />
            <p class="m-0 text-sm font-medium text-ink">No browser origin is allowed</p>
            <p class="m-0 max-w-lg text-xs leading-5 text-ink/55">
              A page served from a real origin cannot read a credentialed response on this
              project. The API still answers, so nothing in a log says why: the response comes
              back without an allow header and the browser discards it, which reads as the SDK
              being broken.
            </p>
            <p class="m-0 max-w-lg text-xs leading-5 text-ink/50">
              A server calling the API sends no Origin at all and is unaffected, and a page on
              localhost is allowed by the deployment while it runs in development. This list is
              for the browser origins you deploy to.
            </p>
            <FancyButton class="mt-2" @click="openAdd()">
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
              Allow origin
            </FancyButton>
          </div>
        </template>
      </RecordTable>
    </section>

    <!--
      Suggestions: one row per origin, the screen it came from in the reader's words, and
      what allowing it grants. The URL it was read off is not repeated, because the same
      origin arrives from several of them and a list that said so three times read as
      three decisions (notes/domains-origins.md P2).
    -->
    <section v-if="suggestions.length > 0" class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{
            suggestions.length === 1
              ? "One origin your other settings imply"
              : `${suggestions.length} origins your other settings imply`
          }}
        </h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Offered rather than added. {{ SUGGESTION_GRANT }}
        </p>
      </header>

      <v-card border flat>
        <ul class="m-0 flex list-none flex-col divide-y divide-line p-0">
          <li
            v-for="suggestion in suggestions"
            :key="suggestion.origin"
            class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3"
          >
            <span
              class="flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-ink/4 text-ink/70"
            >
              <Icon
                :name="ORIGIN_SOURCES[suggestion.source].icon"
                aria-hidden="true"
                class="text-sm"
              />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="font-mono text-xs break-all text-ink">{{ suggestion.origin }}</span>
              <v-tooltip
                :text="ORIGIN_SOURCES[suggestion.source].note"
                location="top"
                max-width="320"
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="w-fit text-[11px] leading-4 text-ink/55">
                    {{ ORIGIN_SOURCE_FROM[suggestion.source] }}
                  </span>
                </template>
              </v-tooltip>
            </span>
            <v-btn
              :loading="isBusy(suggestion.origin)"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="outlined"
              @click="accept(suggestion.origin, suggestion.source)"
            >
              Allow
            </v-btn>
          </li>
        </ul>
      </v-card>
    </section>

    <!--
      The diagnosis. A whole application URL in, its origin out, and the answer before
      anything is offered: watching a path and a query fall away is most of what the check
      teaches (notes/domains-origins.md P1).
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Test an application URL</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Paste the address a page is served from, path and all. The check reduces it to the
          origin a browser would send and says whether this project permits it.
        </p>
      </header>

      <v-card border flat>
        <form class="flex flex-col gap-3 p-4" @submit.prevent="check">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label class="text-xs font-medium text-ink" for="origin-check">
                Application URL
              </label>
              <v-text-field
                id="origin-check"
                v-model="typed"
                autocomplete="off"
                class="font-mono"
                density="comfortable"
                hide-details
                placeholder="https://app.example.com/sign-in"
                variant="filled"
              />
            </div>
            <v-btn
              :disabled="typed.trim() === ''"
              :loading="checking"
              class="text-xs font-medium sm:mt-[1.375rem]"
              color="primary"
              prepend-icon="material-symbols:search"
              size="small"
              type="submit"
              variant="flat"
            >
              Check
            </v-btn>
          </div>

          <p v-if="answer === null" class="m-0 text-[11px] leading-4 text-ink/50">
            The path, the query and the fragment are all dropped: an Origin header is a
            scheme, a host and a port, and nothing else.
          </p>

          <div
            v-else
            class="flex flex-col gap-3 rounded-(--idenzy-radius-small) bg-ink/4 p-4 ring-1 ring-ink/6 ring-inset"
            role="status"
          >
            <!-- The origin it reduced to, before any offer to change a permission. -->
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
              <span class="break-all text-ink/45">{{ answer.asked }}</span>
              <template v-if="answer.origin">
                <Icon
                  aria-hidden="true"
                  class="flex-none text-sm text-ink/40"
                  name="material-symbols:arrow-forward"
                />
                <span class="break-all text-ink">{{ answer.origin }}</span>
              </template>
            </div>

            <div class="flex items-start gap-2.5">
              <Icon
                :class="VERDICT_MARKS[answer.verdict]?.tone"
                :name="VERDICT_MARKS[answer.verdict]?.icon ?? 'material-symbols:info-outline'"
                aria-hidden="true"
                class="mt-px flex-none text-base"
              />
              <div class="flex min-w-0 flex-col gap-0.5">
                <p class="m-0 text-xs font-medium text-ink">{{ answer.title }}</p>
                <p class="m-0 text-[11px] leading-4 text-ink/55">{{ answer.detail }}</p>
              </div>
            </div>

            <div v-if="answer.addable" class="flex">
              <v-btn
                :loading="isBusy(answer.origin)"
                class="text-xs font-medium"
                color="primary"
                prepend-icon="material-symbols:add"
                size="small"
                variant="flat"
                @click="allowChecked"
              >
                Allow {{ answer.origin }}
              </v-btn>
            </div>
          </div>
        </form>
      </v-card>
    </section>

    <LayerCard
      v-model:open="expanded.rules"
      description="What a browser actually gets, where the check runs, and why this is a list of its own."
      expandable
      title="How the check works"
    >
      <div class="flex flex-col gap-4">
        <!-- The two answers, which differ by one header and not by a status. Prose does
             not carry that; the headers do. -->
        <div class="grid gap-3 sm:grid-cols-2">
          <SamplePanel
            v-for="entry in samples"
            :key="entry.id"
            :meta="entry.sample.status"
            :title="entry.title"
          >
            <div class="flex flex-col gap-0.5">
              <SampleLine
                v-for="header in entry.sample.headers"
                :key="header.name"
                mono
                tone="ink"
              >
                {{ header.name }}: {{ header.value }}
              </SampleLine>
              <SampleLine v-if="entry.sample.headers.length === 1" tone="warning">
                No {{ ALLOW_ORIGIN_HEADER }}
              </SampleLine>
              <p class="m-0 mt-1.5 text-[11px] leading-4 text-ink/55">
                {{ entry.sample.outcome }}
              </p>
            </div>
          </SamplePanel>
        </div>

        <div class="divide-y divide-line">
          <SettingRow
            description="One exact string against another. A pattern would match nothing, a subdomain is not covered by its parent, and http is not the same origin as https on the same host. That is CORS's rule rather than ours, and matching more loosely than the browser does would only mean allowing what it then refuses."
            fixed="Exact"
            label="How an origin is matched"
          />
          <SettingRow
            :description="`An unregistered origin gets an ordinary answer with no ${ALLOW_ORIGIN_HEADER} header, and never a 403. The refusal is the browser's to make, and a hard status would tell a prober the difference between an origin that was checked and refused and one nothing is configured for.`"
            fixed="Never a 403"
            label="What a refusal is"
          />
          <SettingRow
            description="Localhost is allowed while the deployment is running in development, by code that reads the environment rather than this table. It cannot be switched on by data, which is what stops a production project ever trusting a page on somebody's machine."
            fixed="Not data"
            label="Development loopback"
          />
          <SettingRow
            description="Redirect URIs are where a flow lands and may be a custom scheme a browser never sends; passkey origins are confined to the relying party's own domain, which CORS is not. Neither is derived from the other, because adding a redirect while looking at a dialog about OAuth should not widen what a page may read."
            fixed="Three lists"
            label="Why this is its own list"
          />
          <SettingRow
            description="A preflight cannot see the publishable-key header, so it can only be strict where the Host names a project. The real check is on the response the browser actually reads, which is the one that carries the credential and the one that matters."
            fixed="On the response"
            label="Where CORS is enforced"
          />
          <SettingRow
            description="Both project lookups return the allowed origins with the project, so the check costs nothing on the request path and a change lands on the next request rather than after a cache expires. There is no separate query and nothing to invalidate."
            fixed="Next request"
            label="When a change takes effect"
          />
        </div>
      </div>
    </LayerCard>

    <!-- Mounted only while open, like every dialog here that writes and then closes. -->
    <OriginAddDialog
      v-if="addOpen"
      v-model="addOpen"
      :busy="isBusy('add')"
      :error="addError"
      :existing="allowed"
      @confirm="confirmAdd"
    />

    <OriginRemoveDialog
      v-if="removeOpen"
      v-model="removeOpen"
      :busy="isBusy(removing)"
      :error="removeError"
      :last="origins.length === 1"
      :origin="removing"
      @confirm="confirmRemoval"
    />
  </div>
</template>
