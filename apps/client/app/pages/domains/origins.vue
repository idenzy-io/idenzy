<script setup lang="ts">
/**
 * The origins a project trusts with a credentialed response (ADR-0006, PROJECT.md 4.10).
 *
 * The whole difficulty of this screen is that a missing entry fails silently. The request
 * reaches us, we answer it normally, and the browser throws the response away: there is no
 * status to look at, nothing in anybody's server log, and the customer's first reading is
 * that the SDK is broken. So the screen is arranged around making the invisible visible.
 * The list is first, what we have actually seen arrive is beside it, and a sample of the
 * two responses is on the page rather than in a guide.
 *
 * The ADR asks the dashboard to suggest origins from the lists a project has already
 * filled in, and to have somebody confirm each one. That is the card under the list, and
 * it is suggestion in both directions: adding one from there is an ordinary write, and
 * nothing about a magic link or a passkey origin changes this list on its own. Two
 * deliberate acts was the point of keeping the tables apart.
 */
import {
  ALLOW_ORIGIN_HEADER,
  corsSample,
  ORIGIN_SOURCES,
  type OriginSource,
  suggestionsFrom,
} from "~/utils/origins";
import { relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useOriginsStore();
const otp = useOtpStore();
const passkeys = usePasskeysStore();

const now = useNow({ interval: 60_000 });

const origins = computed(() => store.forProject(projects.current.id));
const allowed = computed(() => origins.value.map((entry) => entry.origin));
const unknown = computed(() => store.unknownFor(projects.current.id));
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/* Which cards start unfolded. The rules are the reference half of the screen. */
const expanded = reactive({ rules: false });

const busy = ref<Set<string>>(new Set());
const saving = computed(() => busy.value.size > 0);

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
    otp.settingsFor(projects.current.id).magicLink.redirectUris,
    passkeys.settingsFor(projects.current.id).relyingParty?.origins ?? [],
    allowed.value,
  ),
);

/*
 * Adding and removing.
 */

const addOpen = ref(false);
const removeOpen = ref(false);
const removing = ref("");

async function confirmAdd(origin: string) {
  await whileBusy("add", () => store.add(projects.current.id, origin));
  addOpen.value = false;
}

function accept(origin: string, source: OriginSource | null) {
  void whileBusy(origin, () => store.add(projects.current.id, origin, source));
}

function askRemoval(origin: string) {
  removing.value = origin;
  removeOpen.value = true;
}

async function confirmRemoval() {
  await whileBusy(removing.value, () => store.remove(projects.current.id, removing.value));
  removeOpen.value = false;
}

function ago(stamp: string): string {
  const at = new Date(stamp);
  return relativeTimeWords(stamp, now.value < at ? at : now.value);
}

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
    sample: corsSample(unknown.value[0]?.origin ?? "https://elsewhere.example", false),
  },
]);

const GUIDES_URL = "https://idenzy.dev/docs/origins";
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:language" title="Allowed origins">
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
        <FancyButton @click="addOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Allow an origin
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          :padded="false"
          description="Compared against the Origin header as one exact string. A change takes effect on the next request, because the list rides the lookup that resolves the project."
          title="On this project"
        >
          <template #badge>
            <StatusBadge
              :label="origins.length === 0 ? 'None allowed' : `${origins.length} allowed`"
              :tone="origins.length === 0 ? 'warning' : 'success'"
            />
          </template>

          <!-- Two rows of nothing while the store answers, so the card keeps its height
               and the list does not arrive as a jump. -->
          <div v-if="store.loading" class="divide-y divide-line">
            <div v-for="row in 2" :key="row" class="flex items-center gap-4 px-4 py-4">
              <span class="size-9 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8" />
              <span class="flex min-w-0 flex-1 flex-col gap-2">
                <span class="h-3 w-52 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2.5 w-36 animate-pulse rounded-full bg-ink/6" />
              </span>
            </div>
          </div>

          <EmptyState
            v-else-if="origins.length === 0"
            description="No browser can complete a sign-in on this project. The API still answers, so nothing in a log says why: the response comes back without an allow header and the browser discards it, which reads as the SDK being broken."
            icon="material-symbols:language"
            title="No origin is allowed"
          >
            <template #actions>
              <FancyButton @click="addOpen = true">
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                Allow an origin
              </FancyButton>
            </template>
          </EmptyState>

          <ul v-else class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="entry in origins"
              :key="entry.origin"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
            >
              <span
                class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-canvas text-ink/70"
              >
                <Icon aria-hidden="true" class="text-lg" name="material-symbols:public" />
              </span>
              <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <span class="truncate font-mono text-sm text-ink">{{ entry.origin }}</span>
                <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
                  <span class="flex items-center gap-1.5">
                    <Icon
                      aria-hidden="true"
                      class="flex-none text-xs"
                      name="material-symbols:schedule-outline"
                    />
                    Added {{ ago(entry.addedAt) }}
                  </span>
                  <span v-if="entry.source" class="flex items-center gap-1.5">
                    <Icon
                      :name="ORIGIN_SOURCES[entry.source].icon"
                      aria-hidden="true"
                      class="flex-none text-xs"
                    />
                    Suggested by {{ ORIGIN_SOURCES[entry.source].label.toLowerCase() }}
                  </span>
                </div>
              </div>
              <v-btn
                :aria-label="`Stop allowing ${entry.origin}`"
                :loading="isBusy(entry.origin)"
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="askRemoval(entry.origin)"
              >
                Remove
              </v-btn>
            </li>
          </ul>
        </LayerCard>

        <LayerCard
          v-if="suggestions.length > 0"
          :padded="false"
          description="Origins the rest of this project already implies. Offered rather than added: reading a credentialed response is a privilege of its own, and nothing on another screen grants it."
          title="Suggested from what you have registered"
        >
          <template #badge>
            <StatusBadge :label="`${suggestions.length} to confirm`" tone="neutral" />
          </template>

          <ul class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="suggestion in suggestions"
              :key="suggestion.origin"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
            >
              <span
                class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-canvas text-ink/70"
              >
                <Icon
                  :name="ORIGIN_SOURCES[suggestion.source].icon"
                  aria-hidden="true"
                  class="text-lg"
                />
              </span>
              <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <span class="truncate font-mono text-sm text-ink">{{ suggestion.origin }}</span>
                <span class="flex min-w-0 items-center gap-1.5 text-[11px] text-ink/55">
                  {{ ORIGIN_SOURCES[suggestion.source].label }}
                  <span class="truncate font-mono text-ink/45">{{ suggestion.from }}</span>
                </span>
              </div>
              <v-btn
                :loading="isBusy(suggestion.origin)"
                class="text-xs font-medium"
                color="primary"
                size="small"
                variant="tonal"
                @click="accept(suggestion.origin, suggestion.source)"
              >
                Allow it
              </v-btn>
            </li>
          </ul>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.rules"
          description="What the check is, where it runs, and what a refusal looks like from either side."
          expandable
          title="How the check works"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="A preflight cannot see the publishable-key header, so it can only be strict where the Host names a project. The real check is on the response the browser actually reads, which is the one that carries the credential and the one that matters."
              fixed="On the response"
              label="Where CORS is enforced"
            />
            <SettingRow
              :description="`An unregistered origin gets an ordinary answer with no ${ALLOW_ORIGIN_HEADER} header, and never a 403. The refusal is the browser's to make, and a hard status would tell a prober the difference between an origin that was checked and refused and one nothing is configured for.`"
              fixed="Never a 403"
              label="What a refusal is"
            />
            <SettingRow
              description="One exact string against another. A pattern would match nothing, a subdomain is not covered by its parent, and http is not the same origin as https on the same host. That is CORS's rule rather than ours, and matching more loosely than the browser does would only mean allowing what it then refuses."
              fixed="Exact"
              label="How an origin is matched"
            />
            <SettingRow
              description="Localhost is allowed while the deployment is running in development, by code that reads the environment rather than this table. It cannot be switched on by data, which is what stops a production project ever trusting a page on somebody's machine."
              fixed="Not data"
              label="Development loopback"
            />
            <SettingRow
              description="Both project lookups return the allowed origins with the project, so the check costs nothing on the request path and a change lands on the next request rather than after a cache expires. There is no separate query and nothing to invalidate."
              fixed="Next request"
              label="When a change takes effect"
            />
            <SettingRow
              description="Redirect URIs are where a flow lands and may be a custom scheme a browser never sends; passkey origins are confined to the relying party's own domain, which CORS is not. Neither is derived from the other, because adding a redirect while looking at a dialog about OAuth should not widen what a page may read."
              fixed="Three lists"
              label="Why this is its own list"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <LayerCard
          :padded="false"
          description="Origins we answered for and did not allow, over the last thirty days. Usually a deployment nobody added, not an attack."
          title="Seen but not allowed"
        >
          <ul v-if="unknown.length > 0" class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="entry in unknown"
              :key="entry.origin"
              class="flex flex-col gap-2 px-4 py-3"
            >
              <span class="truncate font-mono text-xs text-ink">{{ entry.origin }}</span>
              <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/55">
                <span>
                  <span class="font-mono tabular-nums text-ink/80">
                    {{ entry.calls.toLocaleString("en") }}
                  </span>
                  calls, last {{ ago(entry.lastSeen) }}
                </span>
                <v-btn
                  :loading="isBusy(entry.origin)"
                  class="text-xs font-medium"
                  color="primary"
                  size="x-small"
                  variant="tonal"
                  @click="accept(entry.origin, null)"
                >
                  Allow it
                </v-btn>
              </div>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            Nothing has called from an origin this project does not allow.
          </p>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="The same status either way. One header is the whole difference."
          title="What a browser gets"
        >
          <div class="flex flex-col gap-3 p-4">
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
        </LayerCard>

        <SaveStatus :last-saved="lastSaved" :saving="saving" />
      </aside>
    </div>

    <OriginAddDialog
      v-model="addOpen"
      :busy="isBusy('add')"
      :existing="allowed"
      @confirm="confirmAdd"
    />
    <OriginRemoveDialog
      v-model="removeOpen"
      :busy="isBusy(removing)"
      :last="origins.length === 1"
      :origin="removing"
      @confirm="confirmRemoval"
    />
  </div>
</template>
