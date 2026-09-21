<script setup lang="ts">
/**
 * Where a project is told about things after they happen, and what happened when we told it
 * (notes/webhooks.md; `webhooks`, `webhook_deliveries`, PROJECT.md 3.3, 9.4).
 *
 * In the note's order: the endpoints with their state and health, then the one selected, with
 * Edit and Send test event beside its URL and events; its attempts by outcome over a period,
 * each opening to its evidence and Retry; its signing settings, where rotation lives rather
 * than beside everyday editing; then the verifier and the guarantees, folded.
 *
 * Everything on it is live: events reach endpoints, the table holds real attempts, the figures come
 * from the day counters rather than from the rows on screen, and both Send test event and Retry go
 * down the same path a real event does — each writes a delivery the worker picks up, which is what
 * makes pressing one worth anything.
 *
 * The selected endpoint lives in the query, replaced rather than pushed, so a link names it.
 */
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { RecordColumn, RecordTab } from "~/components/RecordTable.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import { isRefusal, managementMessage } from "~/utils/sign-in-errors";
import { formatDateTime } from "~/utils/time";
import {
  DELIVERY_HEADER,
  type DeliveryOutcome,
  type DeliveryPeriod,
  deliveriesIn,
  deliveryFigures,
  FAILURES_BEFORE_DISABLED,
  FIGURE_DAYS,
  healthOf,
  MAX_ATTEMPTS,
  OUTCOME_LABELS,
  OUTCOMES,
  outcomeCounts,
  ROTATION_OVERLAP_HOURS,
  retryWindowSeconds,
  SIGNATURE_HEADER,
  samplePayload,
  signedPayload,
  subscriptionLabel,
  TEST_SEMANTICS,
  TIMESTAMP_HEADER,
  TIMESTAMP_TOLERANCE_SECONDS,
  VERIFY_SNIPPET,
  WEBHOOK_DELIVERY,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const projects = useProjectStore();
const store = useWebhooksStore();
const route = useRoute();
const router = useRouter();
const now = useNow({ interval: 30_000 });
const { copy, copied } = useClipboard({ copiedDuring: 1600, legacy: true });

const project = computed(() => projects.current.id);

/* The endpoints and the counters, when the screen opens and whenever the project changes. The
   deliveries are per endpoint and wait for a selection, below. */
watch(project, (id) => void store.load(id), { immediate: true });

function reload() {
  void store.load(project.value);
}

/** The reader's own membership on this organisation, so a pause they made reads as theirs. */
const bootstrap = useBootstrapStore();
const viewerMemberId = computed(
  () => bootstrap.organisations.find((org) => org.id === projects.currentOrg.id)?.memberId ?? null,
);

const endpoints = computed(() => store.forProject(project.value));
const deliveries = computed(() => store.deliveriesFor(project.value));
const running = WEBHOOK_DELIVERY.running;

/** A week across every endpoint, from the counters rather than from the deliveries on screen. */
const figures = computed(() => deliveryFigures(store.statsFor(project.value), now.value));

/*
 * Which endpoint is open, in the URL. The first one with a failure, else the first.
 */
const selectedId = computed<string | null>({
  get: () => {
    const asked = route.query["endpoint"];
    const value = Array.isArray(asked) ? asked[0] : asked;
    const list = endpoints.value;
    const failing = list.find((entry) => healthOf(deliveries.value, entry.id).failed > 0);
    return list.find((entry) => entry.id === value)?.id ?? failing?.id ?? list[0]?.id ?? null;
  },
  set: (id) => {
    const rest = Object.fromEntries(
      Object.entries(route.query).filter(([key]) => key !== "endpoint"),
    );
    void router.replace({ query: id ? { ...rest, endpoint: id } : rest });
  },
});

const selected = computed(
  () => endpoints.value.find((entry) => entry.id === selectedId.value) ?? null,
);

/* One endpoint's deliveries are the expensive read, so they follow the selection rather than
   loading for every endpoint the moment the screen opens. */
watch(
  [project, selectedId],
  ([id, endpointId]) => {
    if (endpointId !== null) void store.loadDeliveries(id, endpointId);
  },
  { immediate: true },
);

const ENDPOINT_COLUMNS: readonly RecordColumn[] = [
  { key: "endpoint", label: "Endpoint", width: "minmax(0, 2fr)" },
  { key: "state", label: "Enabled state", width: "minmax(0, 1fr)" },
  { key: "health", label: "Delivery health", width: "minmax(0, 1fr)" },
  { key: "last", label: "Last attempt", width: "minmax(0, 1fr)" },
  { key: "manage", label: "", width: "120px", align: "end" },
];

const endpointsHeading = computed(() => {
  if (store.loading) return "Reading this project's endpoints";
  const count = endpoints.value.length;
  if (count === 0) return "No endpoints";
  const on = endpoints.value.filter((entry) => entry.enabled).length;
  return `${count} ${count === 1 ? "endpoint" : "endpoints"}, ${on} on`;
});

/*
 * The selected endpoint's attempts, by outcome over a period. Failures first.
 */
const outcome = ref<DeliveryOutcome>("failed");
const period = ref<DeliveryPeriod>("7d");

const PERIOD_OPTIONS: readonly SegmentedOption[] = [
  { value: "24h", label: "24h", title: "The last 24 hours" },
  { value: "7d", label: "7d", title: "The last 7 days" },
  { value: "30d", label: "30d", title: "The last 30 days, which is as long as a payload is kept" },
];

const PERIOD_WORDS: Record<DeliveryPeriod, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

const inPeriod = computed(() =>
  selected.value ? deliveriesIn(deliveries.value, selected.value.id, period.value, now.value) : [],
);
const counts = computed(() => outcomeCounts(inPeriod.value));
const outcomeTabs = computed<RecordTab[]>(() =>
  OUTCOMES.map((entry) => ({
    key: entry,
    label: OUTCOME_LABELS[entry],
    count: counts.value[entry],
  })),
);

/** The latest fifty, which is more than anybody reads down and fewer than a page would page. */
const SHOWN_LIMIT = 50;
const shown = computed(() =>
  inPeriod.value.filter((entry) => entry.outcome === outcome.value).slice(0, SHOWN_LIMIT),
);

const ATTEMPT_COLUMNS: readonly RecordColumn[] = [
  { key: "attempt", label: "Attempt", width: "minmax(0, 1fr)" },
  { key: "event", label: "Event", width: "minmax(0, 1.3fr)" },
  { key: "result", label: "HTTP result", width: "minmax(0, 1fr)" },
  { key: "duration", label: "Duration", width: "80px", align: "end" },
  { key: "retry", label: "Next retry", width: "minmax(0, 1fr)" },
  { key: "details", label: "", width: "84px", align: "end" },
];

const attemptsEmpty = computed(() =>
  running
    ? `No ${OUTCOME_LABELS[outcome.value].toLowerCase()} deliveries in the last ${PERIOD_WORDS[period.value]}.`
    : "No attempts. Nothing is sent while delivery is not running, so this list cannot say whether anything would have failed.",
);

/*
 * Busy rows and actions.
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

function setPaused(endpoint: WebhookEndpoint, paused: boolean) {
  void whileBusy(endpoint.id, () =>
    paused ? store.pause(project.value, endpoint.id) : store.resume(project.value, endpoint.id),
  );
}

/**
 * Asks for a test event, which arrives in the table as a pending delivery.
 *
 * Pending and not delivered, because that is what 202 means: the worker sends it a moment later. The
 * list it lands in is the one the reader is already looking at, so the next read of it — or the
 * refresh they will press — shows what came of it.
 */
function sendTest() {
  const target = selected.value;
  if (!target || !WEBHOOK_DELIVERY.testEvent) return;
  void whileBusy(`test:${target.id}`, async () => {
    testError.value = "";
    try {
      await store.sendTest(project.value, target.id);
      outcome.value = "pending";
    } catch {
      testError.value = "The test event was not queued. Nothing was sent, so try again.";
    }
  });
}

/** Why a test event could not be queued, beside the control that asked for it. */
const testError = ref("");

/*
 * Adding and editing.
 */
const editOpen = ref(false);
const editTarget = ref<WebhookEndpoint | null>(null);
const saving = ref(false);
const editError = ref("");

/** The secret, held only while its dialog is open. */
const revealed = ref<{ secret: string; url: string; until: string | null } | null>(null);
const secretOpen = ref(false);

function addEndpoint() {
  editTarget.value = null;
  editError.value = "";
  editOpen.value = true;
}

function editEndpoint(endpoint: WebhookEndpoint) {
  editTarget.value = endpoint;
  editError.value = "";
  editOpen.value = true;
}

async function confirmEdit(draft: {
  url: string;
  description: string;
  events: string[];
  allEvents: boolean;
  enabled: boolean;
}) {
  saving.value = true;
  editError.value = "";
  try {
    const target = editTarget.value;
    if (target) {
      await store.update(project.value, target.id, {
        url: draft.url,
        description: draft.description,
        events: draft.events,
        allEvents: draft.allEvents,
      });
      editOpen.value = false;
      return;
    }
    const made = await store.add(project.value, draft);
    editOpen.value = false;
    selectedId.value = made.endpoint.id;
    revealed.value = { secret: made.secret, url: made.endpoint.url, until: null };
    secretOpen.value = true;
  } catch {
    editError.value = "The endpoint was not saved. What you typed is still here, so try again.";
  } finally {
    saving.value = false;
  }
}

/*
 * Rotating the secret.
 */
const rotateOpen = ref(false);
const rotating = ref(false);
const rotateError = ref("");

function askRotate() {
  rotateError.value = "";
  rotateOpen.value = true;
}

async function confirmRotate() {
  const target = selected.value;
  if (!target) return;
  rotating.value = true;
  rotateError.value = "";
  try {
    const rotated = await store.rotateSecret(project.value, target.id);
    rotateOpen.value = false;
    revealed.value = { secret: rotated.secret, url: target.url, until: rotated.until };
    secretOpen.value = true;
  } catch {
    rotateError.value = "The secret was not rotated. The current one still signs, so try again.";
  } finally {
    rotating.value = false;
  }
}

/*
 * Removing, or pausing instead.
 */
const removeTarget = ref<WebhookEndpoint | null>(null);
const removeOpen = ref(false);
const removing = ref(false);
const removeError = ref("");

function askRemove(endpoint: WebhookEndpoint) {
  removeTarget.value = endpoint;
  removeError.value = "";
  removeOpen.value = true;
}

async function confirmRemove() {
  const target = removeTarget.value;
  if (!target) return;
  removing.value = true;
  removeError.value = "";
  try {
    await store.remove(project.value, target.id);
    removeOpen.value = false;
  } catch {
    removeError.value = "The endpoint was not removed and is still called. Try again.";
  } finally {
    removing.value = false;
  }
}

async function pauseInstead() {
  const target = removeTarget.value;
  if (!target) return;
  removing.value = true;
  try {
    await store.pause(project.value, target.id);
    removeOpen.value = false;
  } catch {
    removeError.value = "The endpoint was not paused. Try again.";
  } finally {
    removing.value = false;
  }
}

/*
 * An attempt in full.
 */
const detailId = ref<string | null>(null);
const detailOpen = ref(false);
const retrying = ref(false);
const detailError = ref("");
const detail = computed(
  () => deliveries.value.find((entry) => entry.id === detailId.value) ?? null,
);

function openDetail(id: string) {
  detailId.value = id;
  detailError.value = "";
  detailOpen.value = true;
}

/**
 * Sends this delivery again, with the same id.
 *
 * Refused by the API in two states, and the message says which: one still being attempted does not
 * need replaying, and one whose body has been cleared cannot be — re-signing something assembled now
 * would be a different delivery wearing an old id.
 */
async function retryDelivery() {
  const target = detail.value;
  if (!target || !WEBHOOK_DELIVERY.replay) return;
  retrying.value = true;
  detailError.value = "";
  try {
    await store.replay(project.value, target.endpointId, target.id);
  } catch (cause: unknown) {
    detailError.value = isRefusal(cause, ErrorCode.Conflict)
      ? managementMessage(cause)
      : "The retry was not queued. The delivery is as it was, so try again.";
  } finally {
    retrying.value = false;
  }
}

/* A dialog belongs to the project it was opened from, and a revealed secret certainly does. */
watch(project, () => {
  editOpen.value = false;
  rotateOpen.value = false;
  removeOpen.value = false;
  detailOpen.value = false;
  secretOpen.value = false;
  revealed.value = null;
});

/*
 * The reference.
 */
const reference = reactive({ verify: false, expect: false });

const SAMPLE_AT = "2026-09-09T18:42:11.203Z";
const SAMPLE_TIMESTAMP = Math.floor(Date.parse(SAMPLE_AT) / 1000);
const SAMPLE_DELIVERY = "dlv_9c1f4a7b20e57d3f8a2b4c6e1d09f85a";
const sampleBody = samplePayload("user.created", SAMPLE_DELIVERY, SAMPLE_AT);
const sampleSigned = signedPayload(SAMPLE_TIMESTAMP, "<the raw body, byte for byte>");
const retryHours = Math.round(retryWindowSeconds() / 3600);
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Webhooks">
      <template v-if="!running" #badge>
        <StatusBadge label="Delivery not running" tone="warning" />
      </template>
      <template #description>
        Where <span class="font-medium text-ink">{{ projects.current.name }}</span> is told
        about things after they happen: signed, retried and delivered at least once. To act
        while a sign-in is happening, use <NuxtLink to="/hooks">Hooks</NuxtLink>.
      </template>
      <template #actions>
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="text"
          @click="addEndpoint"
        >
          Add Endpoint
        </v-btn>
      </template>
    </PageHeader>

    <!-- What is not built, said before the list rather than discovered at a disabled button. It no
         longer says nothing is delivered, because deliveries are what the table below now holds. -->
    <div
      v-if="!WEBHOOK_DELIVERY.testEvent || !WEBHOOK_DELIVERY.replay"
      class="flex items-start gap-2.5 rounded-(--idenzy-radius) border border-line bg-surface px-4 py-3"
      role="status"
    >
      <span aria-hidden="true" class="mt-1.5 size-1.5 flex-none rounded-full bg-warning" />
      <p class="m-0 text-sm text-ink">
        Two controls are not built yet.
        <span class="text-ink/60">{{ WEBHOOK_DELIVERY.reason }}</span>
      </p>
    </div>

    <!-- A read that failed says so and offers the read again, because an endpoint list that came
         back empty for the wrong reason reads as a project with no webhooks. -->
    <div v-if="store.refusal" class="flex flex-col items-start gap-2.5">
      <InfoNote :text="store.refusal" icon="material-symbols:error-outline" tone="warning" />
      <v-btn
        :loading="store.loading"
        class="text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:refresh"
        size="small"
        variant="text"
        @click="reload()"
      >
        Try again
      </v-btn>
    </div>

    <!-- Observed delivery leads, as on the allowed origins screen. While nothing runs every
         tile reads No data, which is the honest answer: nobody is counting, not nothing failed. -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Observed delivery</h2>
        <span class="text-xs text-ink/55">Last {{ FIGURE_DAYS }} days</span>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UsageTile
          v-for="figure in figures"
          :key="figure.id"
          :info="figure.info"
          :label="figure.label"
          :seed="figure.seed"
          :series="figure.series"
          :value="figure.value"
        />
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/55">
        <template v-if="running">
          Counted from every delivery to this project's endpoints, each once however many times
          it was tried.
        </template>
        <template v-else>
          Nothing is delivered yet, so there are no figures. Read an empty tile as nobody
          counting, not as nothing failing.
        </template>
      </p>
    </section>

    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">{{ endpointsHeading }}</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Each is called when something on its list happens. Manage one to see its events, its
          attempts and its signing secret.
        </p>
      </header>

      <RecordTable :columns="ENDPOINT_COLUMNS" framed label="Webhook endpoints">
        <template v-if="store.loading">
          <li v-for="row in 2" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex flex-col gap-1.5">
              <span class="h-2.5 w-56 max-w-full animate-pulse rounded-full bg-ink/8" />
              <span class="h-2 w-32 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--half"><span class="block h-4 w-14 animate-pulse rounded-full bg-ink/8" /></span>
            <span class="record-cell record-cell--half"><span class="block h-2.5 w-20 animate-pulse rounded-full bg-ink/6" /></span>
            <span class="record-cell record-cell--half"><span class="block h-2.5 w-16 animate-pulse rounded-full bg-ink/6" /></span>
            <span class="record-cell record-cell--action" />
          </li>
        </template>

        <template v-else>
          <WebhookEndpointRow
            v-for="endpoint in endpoints"
            :key="endpoint.id"
            :busy="isBusy(endpoint.id)"
            :endpoint="endpoint"
            :health="healthOf(deliveries, endpoint.id)"
            :selected="endpoint.id === selectedId"
            :viewer-member-id="viewerMemberId"
            @edit="editEndpoint(endpoint)"
            @manage="selectedId = endpoint.id"
            @pause="setPaused(endpoint, true)"
            @remove="askRemove(endpoint)"
            @resume="setPaused(endpoint, false)"
          />
        </template>

        <template v-if="!store.loading && endpoints.length === 0" #empty>
          <p class="m-0 px-4 py-10 text-center text-xs leading-5 text-ink/55">
            Nothing is told when an account is created, a session ends or an address bounces.
            An endpoint takes a URL and a list of events.
          </p>
        </template>
      </RecordTable>
    </section>

    <template v-if="selected">
      <!-- The selected endpoint: its URL and events, and the two everyday acts beside them. -->
      <v-card border flat>
        <div class="flex flex-col gap-4 p-4">
          <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-[11px] leading-4 text-ink/45">Selected endpoint</span>
              <p class="m-0 font-mono text-sm break-all text-ink">{{ selected.url }}</p>
              <p v-if="selected.description" class="m-0 text-xs text-ink/60">
                {{ selected.description }}
              </p>
            </div>
            <div class="flex flex-none flex-wrap items-center gap-2">
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:tune"
                size="small"
                variant="text"
                @click="editEndpoint(selected)"
              >
                Edit
              </v-btn>
              <v-btn
                :disabled="!WEBHOOK_DELIVERY.testEvent"
                :loading="isBusy(`test:${selected.id}`)"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:bolt"
                size="small"
                variant="text"
                @click="sendTest"
              >
                Send test event
              </v-btn>
            </div>
          </div>

          <p v-if="testError" class="m-0 text-xs leading-5 text-error" role="alert">
            {{ testError }}
          </p>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] leading-4 text-ink/45">
              {{ subscriptionLabel(selected.events, selected.allEvents) }}
            </span>
            <ul v-if="!selected.allEvents" class="m-0 flex list-none flex-wrap gap-1.5 p-0">
              <li
                v-for="event in selected.events"
                :key="event"
                class="rounded-(--idenzy-radius-x-small) bg-ink/4 px-1.5 py-0.5 font-mono text-[11px] text-ink ring-1 ring-ink/6 ring-inset"
              >
                {{ event }}
              </li>
            </ul>
          </div>

          <p class="m-0 border-t border-line pt-3 text-[11px] leading-4 text-ink/50">
            {{ TEST_SEMANTICS }}
            <template v-if="!running"> Unavailable while delivery is not running.</template>
          </p>
        </div>
      </v-card>

      <section class="flex flex-col gap-3">
        <header class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">Attempts to this endpoint</h2>
          <p class="m-0 text-xs leading-5 text-ink/55">
            <template v-if="running">
              Every delivery made to it over the period, failures first. Details has the
              request, the answer and Retry.
            </template>
            <template v-else>
              None yet, and that is unknown rather than a clean record: nothing is sent while
              delivery is not running.
            </template>
          </p>
        </header>

        <RecordTable
          v-model:tab="outcome"
          :columns="ATTEMPT_COLUMNS"
          :loading="store.loading"
          :tabs="outcomeTabs"
          framed
          label="Delivery attempts"
        >
          <template #toolbar>
            <SegmentedControl v-model="period" :options="PERIOD_OPTIONS" label="Period" />
          </template>

          <WebhookDeliveryRow
            v-for="delivery in shown"
            :key="delivery.id"
            :delivery="delivery"
            @details="openDetail(delivery.id)"
          />

          <template v-if="shown.length === 0" #empty>
            <p class="m-0 px-4 py-10 text-center text-xs leading-5 text-ink/55">{{ attemptsEmpty }}</p>
          </template>
        </RecordTable>

        <p v-if="shown.length === SHOWN_LIMIT" class="m-0 text-xs text-ink/45">
          The latest {{ SHOWN_LIMIT }}. Narrow the period to read further back.
        </p>
      </section>

      <!-- Signing, apart from everyday editing, so rotating is never a click on the way to
           changing a URL. -->
      <section class="flex flex-col gap-3">
        <header class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">Signing</h2>
          <p class="m-0 text-xs leading-5 text-ink/55">
            How deliveries to this endpoint are signed, and replacing the secret.
          </p>
        </header>

        <v-card border flat>
          <div class="divide-y divide-line p-4">
            <SettingRow
              :description="
                selected.previousSecretUntil
                  ? `Rotated ${formatDateTime(selected.rolledAt ?? '')}. The previous secret signs beside it until ${formatDateTime(selected.previousSecretUntil)}.`
                  : selected.rolledAt
                    ? `Last rotated ${formatDateTime(selected.rolledAt)}. It is shown only when it is made, so a lost one is replaced rather than looked up.`
                    : `The original, made ${formatDateTime(selected.createdAt)}. It is shown only when it is made, so a lost one is replaced rather than looked up.`
              "
              label="Signing secret"
            >
              <template #actions>
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:key-outline"
                  size="small"
                  variant="text"
                  @click="askRotate"
                >
                  Rotate secret
                </v-btn>
              </template>
            </SettingRow>
            <SettingRow
              description="Shown once and never again is settled. How we hold the secret so we can sign with it is not: the table keeps a digest, which can check a secret but cannot sign with one, so signing waits on a custody design that can."
              fixed="Not settled"
              label="Where the secret is kept"
            />
          </div>
        </v-card>
      </section>
    </template>

    <LayerCard
      v-model:open="reference.verify"
      description="What arrives, what is signed, and the check a receiver runs before it parses anything."
      expandable
      title="Verifying a delivery"
    >
      <div class="grid gap-5 xl:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-4">
          <SamplePanel
            meta="Headers"
            note="The signature covers the timestamp and the raw body together, so a captured delivery cannot be replayed with its timestamp moved. During a rotation there are two signatures, one per secret."
            title="What arrives"
          >
            <div class="flex flex-col gap-0.5">
              <SampleLine icon="material-symbols:tag" mono>{{ DELIVERY_HEADER }}: {{ SAMPLE_DELIVERY }}</SampleLine>
              <SampleLine icon="material-symbols:schedule-outline" mono>{{ TIMESTAMP_HEADER }}: {{ SAMPLE_TIMESTAMP }}</SampleLine>
              <SampleLine icon="material-symbols:fingerprint" mono>{{ SIGNATURE_HEADER }}: sha256=&lt;64 hex characters&gt;</SampleLine>
            </div>
          </SamplePanel>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-ink/55">The string that is signed</span>
            <CopyField :value="sampleSigned" label="Copy the signed string" />
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              A receiver that parses the JSON and re-serialises it signs a different string and
              never matches. Read the body as text first.
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-ink/55">A body</span>
            <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
              <CodeBlock :code="sampleBody" lang="json" />
            </div>
          </div>
        </div>

        <div class="flex min-w-0 flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-ink/55">Node, and anywhere with node:crypto</span>
            <v-btn
              :prepend-icon="copied ? 'material-symbols:check' : 'material-symbols:content-copy-outline'"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="copy(VERIFY_SNIPPET)"
            >
              {{ copied ? "Copied" : "Copy" }}
            </v-btn>
          </div>
          <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
            <CodeBlock :code="VERIFY_SNIPPET" lang="typescript" />
          </div>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            This exact text is run by the panel's tests against signed requests, malformed
            signatures included. No server SDK ships a webhook verifier yet, so this is the one
            to copy.
          </p>
        </div>
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="reference.expect"
      description="How delivery is designed: what it promises, what it does not, and what a receiver is written against."
      expandable
      title="What to expect"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="An event is written to the outbox in the same transaction as the change it describes, so a rolled-back write never produces a webhook."
          fixed="Never phantom"
          label="An event means it happened"
        />
        <SettingRow
          :description="`The same delivery can arrive twice. Every one carries ${DELIVERY_HEADER}, stable across retries: key your side on it and do nothing the second time.`"
          fixed="At least once"
          label="How often a delivery arrives"
        />
        <SettingRow
          description="Two events a millisecond apart can arrive in either order. The payload carries when the thing happened, so anything that needs an order reads it there."
          fixed="Not guaranteed"
          label="What order they arrive in"
        />
        <SettingRow
          description="A 2xx is taken and anything else is not, timeouts and redirects included."
          fixed="2xx only"
          label="What counts as taken"
        />
        <SettingRow
          :description="`Tried ${MAX_ATTEMPTS} times in all, with a growing gap out to about ${retryHours} hours, so an endpoint down for an afternoon loses nothing. Answer first and do the work after.`"
          :fixed="`${MAX_ATTEMPTS} attempts`"
          label="When a call fails"
        />
        <SettingRow
          :description="`After ${FAILURES_BEFORE_DISABLED} failures in a row the endpoint is switched off, and its row says so. Resuming it replays nothing: a webhook is a notification and never a log.`"
          :fixed="`${FAILURES_BEFORE_DISABLED} in a row`"
          label="When an endpoint is switched off"
        />
        <SettingRow
          :description="`Refuse a delivery whose timestamp is more than ${TIMESTAMP_TOLERANCE_SECONDS / 60} minutes out, before checking the signature. That is what makes it replay-safe rather than merely authentic.`"
          :fixed="`${TIMESTAMP_TOLERANCE_SECONDS / 60} minutes`"
          label="How old a delivery may be"
        />
        <SettingRow
          :description="`After a rotation both secrets sign each delivery for ${ROTATION_OVERLAP_HOURS} hours, and the verifier above accepts either, so deploying the new one is not an outage.`"
          :fixed="`${ROTATION_OVERLAP_HOURS} hours`"
          label="Rotating a secret"
        />
      </div>
    </LayerCard>

    <!-- Mounted only while open, like every dialog here that writes and then closes. -->
    <WebhookEndpointDialog
      v-if="editOpen"
      v-model="editOpen"
      :busy="saving"
      :endpoint="editTarget"
      :error="editError"
      :existing="endpoints.map((entry) => entry.url)"
      :project-name="projects.current.name"
      @confirm="confirmEdit"
    />

    <WebhookSecretDialog
      v-if="secretOpen && revealed"
      v-model="secretOpen"
      :secret="revealed.secret"
      :until="revealed.until"
      :url="revealed.url"
      @done="revealed = null"
    />

    <WebhookRotateDialog
      v-if="rotateOpen && selected"
      v-model="rotateOpen"
      :busy="rotating"
      :endpoint="selected"
      :error="rotateError"
      @confirm="confirmRotate"
    />

    <WebhookRemoveDialog
      v-if="removeOpen && removeTarget"
      v-model="removeOpen"
      :busy="removing"
      :endpoint="removeTarget"
      :error="removeError"
      @confirm="confirmRemove"
      @pause="pauseInstead"
    />

    <WebhookDeliveryDialog
      v-if="detailOpen && detail"
      v-model="detailOpen"
      :busy="retrying"
      :delivery="detail"
      :endpoint-url="endpoints.find((entry) => entry.id === detail?.endpointId)?.url ?? 'Removed'"
      :error="detailError"
      @retry="retryDelivery"
    />
  </div>
</template>
