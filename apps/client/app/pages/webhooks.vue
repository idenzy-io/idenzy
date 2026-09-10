<script setup lang="ts">
/**
 * Where a project wants telling about things, and what happened when we told them
 * (`webhooks`, `webhook_deliveries`, PROJECT.md 3.3, 9.4).
 *
 * Two halves, and the second is the one people come back for. The endpoints are set up
 * once; the deliveries are read every time something has not arrived, so the attempts
 * table carries the status, the attempt number and how long the call took, and a row can
 * be sent again from there.
 *
 * The signing secret is a digest at rest, so it exists on the wire once and the panel
 * never holds it. Rolling one keeps the previous secret working for a day, which is what
 * makes a roll a deploy rather than an outage.
 *
 * What the page says out loud is what a receiver has to be written against: delivery is
 * at least once, order is not guaranteed, and anything but a 2xx is a failure. Those are
 * properties of the transport rather than choices, and a webhooks page that leaves them
 * to a doc is one that ships broken receivers.
 */
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { formatDateTime, relativeTimeWords } from "~/utils/time";
import {
  DELIVERY_HEADER,
  deliveryPercent,
  eventInfo,
  FAILURES_BEFORE_DISABLED,
  healthOf,
  healthTone,
  MAX_ATTEMPTS,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  retryWindowSeconds,
  SIGNATURE_HEADER,
  samplePayload,
  signedPayload,
  subscriptionLabel,
  TIMESTAMP_HEADER,
  TIMESTAMP_TOLERANCE_SECONDS,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const projects = useProjectStore();
const store = useWebhooksStore();

const now = useNow({ interval: 30_000 });

const endpoints = computed(() => store.forProject(projects.current.id));
const deliveries = computed(() => store.deliveriesFor(projects.current.id));
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const expanded = reactive({ signing: true, guarantees: false });

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

function ago(stamp: string): string {
  const at = new Date(stamp);
  return relativeTimeWords(stamp, now.value < at ? at : now.value);
}

/*
 * The endpoints.
 */

const editOpen = ref(false);
const removeOpen = ref(false);
const secretOpen = ref(false);
const editing = ref<WebhookEndpoint | null>(null);
const removing = ref<WebhookEndpoint | null>(null);

const revealed = reactive({ secret: "", url: "", rolled: false });
const OVERLAP_HOURS = 24;

function health(endpoint: WebhookEndpoint) {
  return healthOf(deliveries.value, endpoint.id);
}

function addEndpoint() {
  editing.value = null;
  editOpen.value = true;
}

function editEndpoint(endpoint: WebhookEndpoint) {
  editing.value = endpoint;
  editOpen.value = true;
}

async function confirmEdit(draft: {
  url: string;
  description: string;
  events: string[];
  allEvents: boolean;
}) {
  const target = editing.value;
  if (target) {
    await whileBusy(target.id, () => store.patch(projects.current.id, target.id, draft));
    editOpen.value = false;
    return;
  }
  await whileBusy("add", async () => {
    const { endpoint, secret } = await store.add(projects.current.id, {
      ...draft,
      enabled: true,
    });
    editOpen.value = false;
    /* Straight into the secret, because it exists for this one moment and an endpoint
       whose secret nobody kept is an endpoint nobody can verify. */
    revealed.secret = secret;
    revealed.url = endpoint.url;
    revealed.rolled = false;
    secretOpen.value = true;
  });
}

function setEnabled(endpoint: WebhookEndpoint, enabled: boolean) {
  void whileBusy(endpoint.id, () => store.patch(projects.current.id, endpoint.id, { enabled }));
}

async function roll(endpoint: WebhookEndpoint) {
  await whileBusy(endpoint.id, async () => {
    const secret = await store.rollSecret(projects.current.id, endpoint.id);
    revealed.secret = secret;
    revealed.url = endpoint.url;
    revealed.rolled = true;
    secretOpen.value = true;
  });
}

function askRemoval(endpoint: WebhookEndpoint) {
  removing.value = endpoint;
  removeOpen.value = true;
}

async function confirmRemoval() {
  const target = removing.value;
  if (!target) return;
  await whileBusy(target.id, () => store.remove(projects.current.id, target.id));
  removeOpen.value = false;
}

async function disableInstead() {
  const target = removing.value;
  if (!target) return;
  await whileBusy(target.id, () => store.patch(projects.current.id, target.id, { enabled: false }));
  removeOpen.value = false;
}

/*
 * The attempts.
 */

interface DeliveryRow extends WebhookDelivery {
  endpointUrl: string;
}

const deliveryRows = computed<DeliveryRow[]>(() =>
  deliveries.value.map((delivery) => ({
    ...delivery,
    endpointUrl:
      endpoints.value.find((endpoint) => endpoint.id === delivery.endpointId)?.url ?? "Removed",
  })),
);

const DELIVERY_COLUMNS: readonly DataTableColumn<DeliveryRow>[] = [
  { key: "event", title: "Event", fixed: true, minWidth: 220 },
  { key: "outcome", title: "Outcome", width: 140, skeleton: "pill" },
  { key: "status", title: "Answer", width: 120, mono: true },
  { key: "attempt", title: "Attempt", width: 110, mono: true, align: "end" },
  { key: "durationMs", title: "Took", width: 110, mono: true, align: "end" },
  { key: "endpointUrl", title: "Endpoint", width: 280, hidden: true },
  { key: "at", title: "When", width: 150, mono: true },
];

const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.webhook-deliveries.columns",
  defaultColumnState(DELIVERY_COLUMNS),
);
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(DELIVERY_COLUMNS, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});

const sortBy = ref<DataTableSort[]>([{ key: "at", order: "desc" }]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.webhook-deliveries.page-size", 10);

function redeliver(row: DeliveryRow) {
  void whileBusy(row.id, () => store.redeliver(projects.current.id, row));
}

/*
 * What arrives, and what it is signed with.
 */

const SAMPLE_AT = "2026-09-09T18:42:11.203Z";
const SAMPLE_TIMESTAMP = Math.floor(new Date(SAMPLE_AT).getTime() / 1000);
const SAMPLE_DELIVERY = "dlv_9c1f4a7b20e5";

const sampleBody = samplePayload("user.created", SAMPLE_DELIVERY, SAMPLE_AT);
const sampleSigned = signedPayload(SAMPLE_TIMESTAMP, "<the raw body, byte for byte>");

const VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto";

// The raw body, not the parsed one: re-serialising JSON signs a different string.
export function verify(body: string, headers: Headers, secret: string) {
  const timestamp = Number(headers.get("${TIMESTAMP_HEADER}"));
  const signature = headers.get("${SIGNATURE_HEADER}") ?? "";

  if (Math.abs(Date.now() / 1000 - timestamp) > ${TIMESTAMP_TOLERANCE_SECONDS}) {
    throw new Error("too old");
  }

  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${body}\`)
    .digest("hex");

  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new Error("bad signature");
  }
}`;

const retryHours = Math.round(retryWindowSeconds() / 3600);
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:webhook" title="Webhooks">
      <template #description>
        Where
        <span class="font-medium text-ink">{{ projects.current.name }}</span> wants telling
        about things. Signed, retried, and delivered at least once: a receiver has to be
        idempotent on the delivery id.
      </template>
      <template #actions>
        <FancyButton @click="addEndpoint">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add an endpoint
        </FancyButton>
      </template>
    </PageHeader>

    <LayerCard
      :padded="false"
      description="Called when something on its list happens. Anything but a 2xx is a failure and gets retried."
      title="Endpoints"
    >
      <template #badge>
        <StatusBadge
          :label="`${endpoints.filter((entry) => entry.enabled).length} on`"
          :tone="endpoints.length === 0 ? 'neutral' : 'success'"
        />
      </template>

      <div v-if="store.loading" class="divide-y divide-line">
        <div v-for="row in 2" :key="row" class="flex items-center gap-4 px-4 py-4">
          <span class="size-9 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8" />
          <span class="flex min-w-0 flex-1 flex-col gap-2">
            <span class="h-3 w-64 animate-pulse rounded-full bg-ink/8" />
            <span class="h-2.5 w-40 animate-pulse rounded-full bg-ink/6" />
          </span>
          <span class="h-5 w-9 flex-none animate-pulse rounded-full bg-ink/8" />
        </div>
      </div>

      <EmptyState
        v-else-if="endpoints.length === 0"
        description="Nothing is told when an account is created, a session ends or an address bounces. An endpoint takes a URL and a list of events, and about a minute."
        icon="material-symbols:webhook"
        title="No endpoint yet"
      >
        <template #actions>
          <FancyButton @click="addEndpoint">
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
            Add an endpoint
          </FancyButton>
        </template>
      </EmptyState>

      <div v-else class="divide-y divide-line">
        <div
          v-for="endpoint in endpoints"
          :key="endpoint.id"
          :class="endpoint.enabled ? '' : 'opacity-60'"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-opacity duration-150"
        >
          <span
            class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-canvas text-ink/70"
          >
            <Icon aria-hidden="true" class="text-lg" name="material-symbols:webhook" />
          </span>

          <div class="flex min-w-0 flex-1 basis-72 flex-col gap-1">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="truncate font-mono text-sm text-ink">{{ endpoint.url }}</span>
              <StatusBadge
                :detail="deliveryPercent(health(endpoint).rate)"
                :label="OUTCOME_LABELS.delivered"
                :tone="healthTone(health(endpoint))"
              />
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
              <span v-if="endpoint.description" class="truncate">{{ endpoint.description }}</span>
              <span class="flex items-center gap-1.5">
                <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:bolt" />
                {{ subscriptionLabel(endpoint.events, endpoint.allEvents) }}
              </span>
              <span v-if="health(endpoint).last" class="flex items-center gap-1.5">
                <Icon
                  aria-hidden="true"
                  class="flex-none text-xs"
                  name="material-symbols:schedule-outline"
                />
                Last called {{ ago(health(endpoint).last?.at ?? "") }}
              </span>
              <span v-if="endpoint.rolledAt" class="flex items-center gap-1.5">
                <Icon
                  aria-hidden="true"
                  class="flex-none text-xs"
                  name="material-symbols:lock-outline"
                />
                Secret rolled {{ ago(endpoint.rolledAt) }}
              </span>
            </div>
          </div>

          <div class="ml-auto flex flex-none items-center gap-3">
            <v-switch
              :aria-label="`Deliver to ${endpoint.url}`"
              :disabled="isBusy(endpoint.id)"
              :loading="isBusy(endpoint.id)"
              :model-value="endpoint.enabled"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="setEnabled(endpoint, $event === true)"
            />

            <v-menu :offset="4" location="bottom end">
              <template #activator="{ props: activator }">
                <button
                  v-bind="activator"
                  :aria-label="`Actions for ${endpoint.url}`"
                  class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                >
                  <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
                </button>
              </template>
              <v-list density="compact" min-width="232" nav>
                <v-list-item
                  prepend-icon="material-symbols:tune"
                  title="URL and events"
                  @click="editEndpoint(endpoint)"
                />
                <v-list-item
                  prepend-icon="material-symbols:key-outline"
                  title="Roll the signing secret"
                  @click="roll(endpoint)"
                />
                <v-divider class="my-1" />
                <v-list-item
                  class="webhooks__danger"
                  prepend-icon="material-symbols:link-off"
                  title="Remove endpoint"
                  @click="askRemoval(endpoint)"
                />
              </v-list>
            </v-menu>
          </div>
        </div>
      </div>
    </LayerCard>

    <LayerCard
      :padded="false"
      description="Every call we made, whether it landed, and how long it took. A row can be sent again."
      title="Recent attempts"
    >
      <template #actions>
        <DataTableColumnsMenu v-model="columnState" :columns="DELIVERY_COLUMNS" />
      </template>

      <DataTable
        v-model:column-state="columnState"
        v-model:items-per-page="pageSize"
        v-model:page="page"
        v-model:sort-by="sortBy"
        :columns="DELIVERY_COLUMNS"
        :items="deliveryRows"
        :loading="store.loading"
        empty-description="Nothing has been sent yet. An attempt appears here within a second of the event that caused it."
        empty-title="No attempts yet"
        item-value="id"
        label="Webhook attempts"
      >
        <template #cell.event="{ item }">
          <v-tooltip
            :text="eventInfo(item.event)?.note ?? item.event"
            location="top"
            max-width="320"
          >
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="block truncate font-mono text-ink">{{ item.event }}</span>
            </template>
          </v-tooltip>
        </template>

        <template #cell.outcome="{ item }">
          <StatusBadge :label="OUTCOME_LABELS[item.outcome]" :tone="OUTCOME_TONES[item.outcome]" />
        </template>

        <template #cell.status="{ item }">
          <span v-if="item.status !== null" class="font-mono tabular-nums text-ink/80">
            {{ item.status }}
          </span>
          <v-tooltip v-else :text="item.error ?? ''" location="top">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="text-ink/45">No answer</span>
            </template>
          </v-tooltip>
        </template>

        <template #cell.attempt="{ item }">
          <span class="font-mono tabular-nums text-ink/70">
            {{ item.attempt }}<span class="text-ink/35">/{{ MAX_ATTEMPTS }}</span>
          </span>
        </template>

        <template #cell.durationMs="{ item }">
          <span
            :class="item.durationMs > 5000 ? 'text-warning' : 'text-ink/70'"
            class="font-mono tabular-nums"
          >
            {{ (item.durationMs / 1000).toFixed(2) }}s
          </span>
        </template>

        <template #cell.endpointUrl="{ item }">
          <span class="block truncate font-mono text-[11px] text-ink/60">
            {{ item.endpointUrl }}
          </span>
        </template>

        <template #cell.at="{ item }">
          <v-tooltip :text="formatDateTime(item.at)" location="top">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="text-ink/70">{{ ago(item.at) }}</span>
            </template>
          </v-tooltip>
        </template>

        <template #actions="{ item }">
          <v-tooltip location="top" text="Send this event again">
            <template #activator="{ props: tip }">
              <button
                v-bind="tip"
                :aria-label="`Send ${item.event} again`"
                :disabled="isBusy(item.id)"
                class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                type="button"
                @click="redeliver(item)"
              >
                <Icon aria-hidden="true" class="text-base" name="material-symbols:refresh" />
              </button>
            </template>
          </v-tooltip>
        </template>
      </DataTable>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.signing"
      description="What arrives, what is signed, and the check a receiver runs before it parses anything."
      expandable
      title="Verifying a delivery"
    >
      <div class="grid gap-4 xl:grid-cols-2">
        <div class="flex flex-col gap-3">
          <SamplePanel
            meta="Headers"
            note="The signature covers the timestamp and the raw body together, so a captured delivery cannot be replayed with its timestamp moved forward."
            title="What arrives"
          >
            <div class="flex flex-col gap-0.5">
              <SampleLine icon="material-symbols:fingerprint" mono>
                {{ SIGNATURE_HEADER }}: sha256=…
              </SampleLine>
              <SampleLine icon="material-symbols:schedule-outline" mono>
                {{ TIMESTAMP_HEADER }}: {{ SAMPLE_TIMESTAMP }}
              </SampleLine>
              <SampleLine icon="material-symbols:tag" mono>
                {{ DELIVERY_HEADER }}: {{ SAMPLE_DELIVERY }}
              </SampleLine>
            </div>
          </SamplePanel>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-ink/55">The string that is signed</span>
            <CopyField :value="sampleSigned" label="Copy the signed string" />
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              A receiver that parses the JSON and re-serialises it is signing a different
              string and will never match. Read the body as text first.
            </p>
          </div>

          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] text-ink/55">A body</span>
            <pre
              class="m-0 overflow-x-auto rounded-(--idenzy-radius-x-small) border border-line bg-canvas p-3 font-mono text-[11px] leading-5 text-ink/80"
            >{{ sampleBody }}</pre>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] text-ink/55">Node</span>
          <pre
            class="m-0 overflow-x-auto rounded-(--idenzy-radius-x-small) border border-line bg-canvas p-3 font-mono text-[11px] leading-5 text-ink/80"
          >{{ VERIFY }}</pre>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            The server SDKs do this for you. This is what they do, for anywhere there is not
            one yet.
          </p>
        </div>
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.guarantees"
      description="What the transport promises, what it does not, and what a receiver has to be written against."
      expandable
      title="What to expect"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="An event is written to the outbox in the same transaction as the change it describes, and relayed from there. A rolled-back write never produces a webhook, so a receiver never has to defend against being told about something that did not happen."
          fixed="Never phantom"
          label="An event means it happened"
        />
        <SettingRow
          :description="`The same delivery can arrive twice, and eventually will. Every one carries ${DELIVERY_HEADER}, which is unique and stable across retries: key your side on it and do nothing the second time.`"
          fixed="At least once"
          label="How often a delivery arrives"
        />
        <SettingRow
          description="Two events raised a millisecond apart can arrive in either order, because the fan-out is parallel. The payload carries the instant the thing happened, so anything that needs an order reads it there rather than from arrival."
          fixed="Not guaranteed"
          label="What order they arrive in"
        />
        <SettingRow
          description="A 2xx is taken, anything else is not, timeouts included. A redirect is a failure rather than a hop we follow: treating one as success is how six months of events go to a URL that moved."
          fixed="2xx only"
          label="What counts as taken"
        />
        <SettingRow
          :description="`Retried ${MAX_ATTEMPTS - 1} times with a growing gap, out to about ${retryHours} hours, so an endpoint down for an afternoon loses nothing. Do the work after you answer: a handler that finishes its own job before replying is a handler that times out.`"
          :fixed="`${MAX_ATTEMPTS} attempts`"
          label="What happens when a call fails"
        />
        <SettingRow
          :description="`After ${FAILURES_BEFORE_DISABLED} failures in a row the endpoint is switched off, because a URL nobody is listening on is not worth a queue that grows until somebody notices. Switching it back on is one click, and the events in between are gone: a webhook is a notification and never a log.`"
          :fixed="`${FAILURES_BEFORE_DISABLED} in a row`"
          label="When an endpoint is switched off"
        />
        <SettingRow
          :description="`Refuse a delivery whose timestamp is more than ${TIMESTAMP_TOLERANCE_SECONDS / 60} minutes out, before you check the digest. That is what makes the signature replay-safe rather than merely authentic.`"
          :fixed="`${TIMESTAMP_TOLERANCE_SECONDS / 60} minutes`"
          label="How old a delivery may be"
        />
        <SettingRow
          description="We keep a hash of the signing secret and never the value, so it is shown once when it is made and once when it is rolled. A roll keeps the previous secret working for a day, so deploying the new one is not an outage."
          fixed="Shown once"
          label="Where the secret lives"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <WebhookEndpointDialog
      v-model="editOpen"
      :busy="isBusy('add') || (editing !== null && isBusy(editing.id))"
      :endpoint="editing"
      :existing="endpoints.map((entry) => entry.url)"
      @confirm="confirmEdit"
    />
    <WebhookSecretDialog
      v-model="secretOpen"
      :overlap-hours="OVERLAP_HOURS"
      :rolled="revealed.rolled"
      :secret="revealed.secret"
      :url="revealed.url"
    />
    <WebhookRemoveDialog
      v-model="removeOpen"
      :busy="removing !== null && isBusy(removing.id)"
      :endpoint="removing"
      @confirm="confirmRemoval"
      @disable="disableInstead"
    />
  </div>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.webhooks__danger,
.v-list--nav .v-list-item.webhooks__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
