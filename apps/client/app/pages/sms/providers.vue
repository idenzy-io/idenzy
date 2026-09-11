<script setup lang="ts">
/**
 * Who carries this project's one-time codes, and what one costs (PROJECT.md 4.8, 5.1,
 * 11.1, notes/sms-providers.md).
 *
 * Two things shape the screen. The first is the one decision a project makes: our routing
 * or an account of its own. It was a segmented switch, which is the wrong control for it
 * — the two are not two settings of one thing, they are two arrangements with different
 * prices, different billing owners and different readiness, and the only way to choose
 * between them is to read them side by side. So they are two panels, each stating its own
 * estimate, who bills, and what is standing in its way, with its own action inside it.
 *
 * The second is what this deployment can actually do. Every vendor adapter is a port with
 * nothing behind it: the route table is what the router *would* choose and the only thing
 * that dispatches is the logging transport. A screen that drew Twilio as "carrying
 * traffic" was making the one claim nobody could check from here, so the vendor states
 * are gated on the deployment, the rates are labelled as examples of what a country costs
 * rather than as a quote, and the meter reads nought because nothing has been carried.
 *
 * The table is still the point of the page: SMS is regional wholesale plus twenty-five
 * percent and the price list promises that figure per country in the dashboard. What
 * changed is whose countries it opens on. A global catalogue answers a question nobody
 * asked; the project's own destinations, with what is blocking each and the screen that
 * settles it, is the one an operator arrived with.
 *
 * What is deliberately not here is everything the fraud guard decides: the allowlist, the
 * velocity ceilings, the attestation requirement and the daily spend cap belong to Policy
 * and spend, and they run before a provider is ever chosen.
 */

import {
  type ColumnState,
  type DataTableColumn,
  type DataTableSort,
  defaultColumnState,
  reconcileColumnState,
} from "~/utils/data-table";
import { countryFlag, countryName } from "~/utils/sessions";
import { canSendSms } from "~/utils/sms-policy";
import {
  type ByoDraft,
  byoVendorInfo,
  DESTINATION_FILTERS,
  type DestinationFilter,
  formatPrice,
  GSM7_SEGMENT,
  isAllowed,
  liveTransport,
  PROVIDER_STATE_LABELS,
  priceFor,
  priceRange,
  providerLabel,
  RATE_SOURCE,
  REGISTRATIONS,
  type Registration,
  type RouteReadiness,
  routeReadiness,
  SENDER_LABELS,
  SENDER_NOTES,
  type SenderKind,
  SMS_MARGIN,
  SMS_PROVIDERS,
  SMS_ROUTES,
  transportWired,
  UCS2_SEGMENT,
} from "~/utils/sms-providers";
import { relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useSmsProvidersStore();
const policies = useSmsPolicyStore();

const now = useNow({ interval: 60_000 });

const mode = computed(() => store.modeFor(projects.current.id));
const account = computed(() => store.accountFor(projects.current.id));
const managed = computed(() => mode.value === "managed");
const traffic = computed(() => store.traffic(projects.current.id));
const check = computed(() => store.checkFor(projects.current.id));

const policy = computed(() => policies.policyFor(projects.current.id));
const allowedCountries = computed(() => policy.value?.allowedCountries ?? []);

/* What the deployment can do, which no setting on this screen changes. */
const wired = transportWired();
const transport = liveTransport();

/* Which cards start unfolded. The table is what most visits are for. */
const expanded = reactive({ vendors: false, router: false });

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
 * Whose account carries it. Two arrangements read side by side, not two settings of one.
 */

const accountOpen = ref(false);

function useManaged() {
  void whileBusy("mode", () => store.setMode(projects.current.id, "managed"));
}

function useOwn() {
  if (account.value === null) {
    accountOpen.value = true;
    return;
  }
  void whileBusy("mode", () => store.setMode(projects.current.id, "byo"));
}

async function verifyAccount(draft: ByoDraft) {
  await whileBusy("check", async () => {
    await store.verifyAccount(projects.current.id, draft);
  });
}

async function saveAccount(draft: ByoDraft) {
  await whileBusy("account", () => store.saveAccount(projects.current.id, draft));
  accountOpen.value = false;
}

function removeAccount() {
  void whileBusy("account", () => store.removeAccount(projects.current.id));
}

const vendorLabel = computed(() =>
  account.value === null ? "" : (byoVendorInfo(account.value.vendor)?.label ?? ""),
);

const secretAge = computed(() => {
  const at = account.value?.secretUpdatedAt ?? null;
  if (at === null) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

/** What the own-account panel says about itself, which is not the same as being in use. */
const ownReadiness = computed(() => {
  if (account.value === null) {
    return { label: "Not connected", tone: "neutral" as const, detail: "No credentials stored." };
  }
  if (!account.value.secretSet) {
    return {
      label: "No secret",
      tone: "warning" as const,
      detail: "The key is stored and the secret is not, so the vendor would refuse every message.",
    };
  }
  return {
    label: "Connected",
    tone: "success" as const,
    detail: `Secret written ${secretAge.value}, and never read back.`,
  };
});

const range = computed(() => priceRange(SMS_ROUTES));

/*
 * Destinations. The project's own first, which is the question an operator arrived with.
 */

interface RouteRow {
  country: string;
  name: string;
  provider: string;
  failover: string;
  price: number;
  sender: SenderKind;
  registration: Registration;
  allowed: boolean;
  readiness: RouteReadiness;
}

const filter = ref<DestinationFilter>("allowed_first");
const query = ref("");

const search = computed({
  get: () => query.value,
  set: (value: string | null) => {
    query.value = value ?? "";
  },
});

const allRows = computed<RouteRow[]>(() =>
  SMS_ROUTES.map((route) => ({
    country: route.country,
    name: countryName(route.country) ?? route.country,
    provider: providerLabel(route.provider),
    failover: route.failover === null ? "" : providerLabel(route.failover),
    price: priceFor(route.wholesale),
    sender: route.sender,
    registration: route.registration,
    allowed: isAllowed(route.country, allowedCountries.value),
    readiness: routeReadiness(route, allowedCountries.value),
  })),
);

const routeRows = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return allRows.value
    .filter((row) => filter.value !== "allowed_only" || row.allowed)
    .filter(
      (row) =>
        needle === "" ||
        row.name.toLowerCase().includes(needle) ||
        row.country.toLowerCase() === needle,
    );
});

const READY_RANK: Record<RouteReadiness["state"], number> = {
  ready: 0,
  registration: 1,
  not_allowed: 2,
};

const ROUTE_COLUMNS: readonly DataTableColumn<RouteRow>[] = [
  { key: "name", title: "Country", fixed: true, minWidth: 190 },
  { key: "price", title: "Price per segment", width: 150, mono: true },
  {
    key: "readiness",
    title: "Route ready?",
    width: 160,
    skeleton: "pill",
    value: (row) => READY_RANK[row.readiness.state],
  },
  {
    key: "registration",
    title: "Registration",
    width: 150,
    skeleton: "pill",
    value: (row) => REGISTRATIONS[row.registration].label,
  },
  { key: "fix", title: "Action", width: 150, value: (row) => row.readiness.fix?.label ?? "" },
  /* Illustrative, and hidden by default for that reason: this is the route the router
     would pick, on a deployment where nothing is wired to pick it. */
  { key: "provider", title: "Intended route", width: 190, hidden: true },
  { key: "failover", title: "Falls back to", width: 170, hidden: true },
  {
    key: "sender",
    title: "Sender",
    width: 150,
    hidden: true,
    value: (row) => SENDER_LABELS[row.sender],
  },
];

/** Ours to route and ours to price, so they say nothing about a project on its own vendor. */
const OURS_ONLY: readonly string[] = ["provider", "failover", "price"];

const routeColumns = computed(() =>
  managed.value ? ROUTE_COLUMNS : ROUTE_COLUMNS.filter((column) => !OURS_ONLY.includes(column.key)),
);

/* A new key, because the column set is not the one the old arrangement stored: the
   reconciler would keep a reader's remembered visibility and quietly bring back the
   illustrative route column this table hides on purpose. */
const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.sms-destinations.columns",
  defaultColumnState(ROUTE_COLUMNS),
);
const routeColumnState = computed<ColumnState>({
  get: () => reconcileColumnState(routeColumns.value, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});

const BY_NAME: DataTableSort = { key: "name", order: "asc" };
const READY_FIRST: DataTableSort = { key: "readiness", order: "asc" };

const routeSort = ref<DataTableSort[]>([READY_FIRST, BY_NAME]);

/* The filter sets the order it implies; a column heading then overrides it, which is what
   a heading is for. */
watch(filter, (value) => {
  routeSort.value = value === "allowed_first" ? [READY_FIRST, BY_NAME] : [BY_NAME];
});

const allowedCount = computed(() => allRows.value.filter((row) => row.allowed).length);
const readyCount = computed(
  () => allRows.value.filter((row) => row.readiness.state === "ready").length,
);

/* Written out for the reference list at the foot: the table's cell holds the word and
   this holds the sentence, so nothing on the screen is explained by hover alone. */
const REGISTRATION_LIST = Object.values(REGISTRATIONS);

const GUIDES_URL = "https://idenzy.dev/docs/sms";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="SMS providers">
      <template #badge>
        <StatusBadge
          :label="managed ? 'Our routing' : 'Your own account'"
          :tone="managed ? 'neutral' : 'success'"
        />
      </template>
      <template #description>
        Who carries the codes
        <span class="font-medium text-ink">{{ projects.current.name }}</span> sends, and what
        each one costs. Where a message may go and what it may spend are
        <NuxtLink to="/sms/policy">Policy and spend</NuxtLink>.
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
          SMS guides
        </v-btn>
      </template>
    </PageHeader>

    <!--
      What the meter counted. Nought everywhere while nothing is wired, and the tiles say
      so in words rather than drawing a chart of nothing.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Delivery health</h2>
        <span class="text-xs text-ink/55">Last 30 days</span>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UsageTile :seed="23" :series="traffic.sentDaily" :value="traffic.sent" label="Sent" />
        <UsageTile
          :seed="29"
          :value="traffic.delivered"
          info="Accepted by the carrier. Not a code anybody typed in, which is the ratio the fraud guard watches."
          label="Delivered"
        />
        <UsageTile
          :seed="31"
          :value="traffic.failed"
          info="Refused by the carrier or the vendor. The spend is reserved either way, because a failed dispatch cannot know whether the message went out."
          label="Failed"
        />
        <UsageTile
          :info="
            managed
              ? 'Wholesale plus our margin, over the same thirty days.'
              : 'You bring your own account, so we charge nothing for carriage. Your vendor bills you directly.'
          "
          :seed="37"
          :value="managed ? traffic.spend : 0"
          label="Our charge"
        />
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/55">
        <template v-if="!wired">
          Nothing has been carried on this deployment: no vendor adapter is wired, so the
          meter has nothing to count and these are the tiles as they will read. Delivered and
          failed are carrier events in any case, and that pipeline arrives with the adapter.
        </template>
        <template v-else-if="!managed">
          Your vendor carries every message, so what we can count is what we handed over.
          Whether it arrived is answered in your own {{ vendorLabel }} console.
        </template>
        <template v-else>
          Counted by the same meter this project is billed on.
        </template>
      </p>
    </section>

    <!--
      Two arrangements, read side by side. A segmented switch made them two settings of
      one thing; they are not, and the estimate, the billing owner and the readiness are
      three answers that differ between them and cannot be compared through a toggle.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">How delivery is carried</h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          One decision, and it changes who bills you rather than what your users get. The
          fraud guard, the allowlist and the spend cap run either way.
        </p>
      </header>

      <div class="grid items-stretch gap-4 lg:grid-cols-2">
        <!-- Ours -->
        <v-card
          :class="managed ? 'ring-1 ring-primary/40' : ''"
          border
          class="flex flex-col"
          flat
        >
          <div class="flex flex-wrap items-start justify-between gap-3 p-4">
            <div class="flex min-w-0 flex-col gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="m-0 text-sm font-medium text-ink">Idenzy-managed delivery</h3>
                <StatusBadge v-if="managed" label="In use" tone="success" />
              </div>
              <p class="m-0 text-xs leading-5 text-ink/55">
                We pick the cheapest acceptable vendor for each country and hand the message
                over ourselves.
              </p>
            </div>
          </div>

          <dl class="m-0 flex flex-col divide-y divide-line border-t border-line">
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="text-xs leading-4 font-medium text-ink">Estimate</dt>
              <dd class="m-0 flex-none text-right">
                <span class="font-mono text-xs text-ink tabular-nums">
                  {{ formatPrice(range.low) }}–{{ formatPrice(range.high) }}
                </span>
                <span class="block text-[10px] leading-4 text-ink/45">per segment</span>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Billing owner</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Regional wholesale plus {{ Math.round(SMS_MARGIN * 100) }} percent, drawn
                  from this project's balance. There is no plan tier that lowers it.
                </span>
              </dt>
              <dd class="m-0 flex-none text-xs text-ink/70">Us</dd>
            </div>
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Availability</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  <template v-if="wired">
                    {{ transport?.label }} is wired and dispatching on this deployment.
                  </template>
                  <template v-else>
                    No vendor adapter is wired on this deployment yet, so the routes below are
                    what the router would choose rather than what it does. Nothing reaches a
                    carrier today.
                  </template>
                </span>
              </dt>
              <dd class="m-0 flex-none">
                <StatusBadge
                  :label="wired ? 'Carrying traffic' : 'Not wired yet'"
                  :tone="wired ? 'success' : 'warning'"
                />
              </dd>
            </div>
          </dl>

          <div class="mt-auto border-t border-line px-4 py-3">
            <v-btn
              v-if="!managed"
              :loading="isBusy('mode')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:swap-horiz"
              size="small"
              variant="outlined"
              @click="useManaged"
            >
              Use our routing
            </v-btn>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/50">
              In use. Every message this project sends goes through our router.
            </p>
          </div>
        </v-card>

        <!-- Theirs -->
        <v-card
          :class="!managed ? 'ring-1 ring-primary/40' : ''"
          border
          class="flex flex-col"
          flat
        >
          <div class="flex flex-wrap items-start justify-between gap-3 p-4">
            <div class="flex min-w-0 flex-col gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="m-0 text-sm font-medium text-ink">Use my provider account</h3>
                <StatusBadge v-if="!managed" label="In use" tone="success" />
              </div>
              <p class="m-0 text-xs leading-5 text-ink/55">
                We hand every message to your own Twilio or Vonage. Our routing and our
                prices stop applying.
              </p>
            </div>
          </div>

          <dl class="m-0 flex flex-col divide-y divide-line border-t border-line">
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="text-xs leading-4 font-medium text-ink">Vendor</dt>
              <dd class="m-0 flex-none text-right">
                <template v-if="account">
                  <span class="text-xs text-ink">{{ vendorLabel }}</span>
                  <span class="block truncate font-mono text-[10px] leading-4 text-ink/45">
                    {{ account.key }}
                  </span>
                </template>
                <span v-else class="text-xs text-ink/45">Twilio or Vonage</span>
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Billing owner</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Your vendor bills you directly for every message, at their rates. We charge
                  nothing for carriage, which is not the same as SMS being free.
                </span>
              </dt>
              <dd class="m-0 flex-none text-xs text-ink/70">Your vendor</dd>
            </div>
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Readiness</span>
                <span class="text-[11px] leading-4 text-ink/55">{{ ownReadiness.detail }}</span>
              </dt>
              <dd class="m-0 flex-none">
                <StatusBadge :label="ownReadiness.label" :tone="ownReadiness.tone" />
              </dd>
            </div>
          </dl>

          <div
            class="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-3"
          >
            <v-btn
              v-if="account === null"
              class="text-xs font-medium"
              color="primary"
              prepend-icon="material-symbols:key-outline"
              size="small"
              variant="flat"
              @click="accountOpen = true"
            >
              Connect account
            </v-btn>
            <template v-else>
              <v-btn
                v-if="managed"
                :loading="isBusy('mode')"
                class="text-xs font-medium"
                color="primary"
                prepend-icon="material-symbols:swap-horiz"
                size="small"
                variant="flat"
                @click="useOwn"
              >
                Use this account
              </v-btn>
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:key-outline"
                size="small"
                variant="outlined"
                @click="accountOpen = true"
              >
                Manage
              </v-btn>
              <v-btn
                :loading="isBusy('account')"
                class="ml-auto text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="removeAccount"
              >
                Remove account
              </v-btn>
            </template>
          </div>
        </v-card>
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/50">
        Handing carriage back is not an outage: our routing takes over on the next message
        and the prices below apply again from that moment. Removing the account clears the
        credentials with it.
      </p>
    </section>

    <!--
      The project's own destinations first. A global catalogue answers a question nobody
      asked; what is blocking each country a project actually sends to is the one an
      operator arrived with, and each blocker names the screen that settles it.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">
            {{
              store.loading || policies.loading
                ? "Reading this project's destinations"
                : canSendSms(policy)
                  ? `${readyCount} of ${allowedCount} allowed destinations ready`
                  : "No destination is allowed yet"
            }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/55">
            Every country the router reaches, what it would cost per segment, and what has to
            be true before it carries anything for this project.
          </p>
        </div>
      </header>

      <v-card border flat>
        <div
          class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl v-model="filter" :options="DESTINATION_FILTERS" label="Destinations" />
          <div class="flex items-center gap-2">
            <v-text-field
              v-model="search"
              aria-label="Search countries"
              class="routes__search"
              clearable
              density="compact"
              hide-details
              placeholder="Search a country"
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />
            <DataTableColumnsMenu v-model="routeColumnState" :columns="routeColumns" />
          </div>
        </div>

        <DataTable
          v-model:column-state="routeColumnState"
          v-model:sort-by="routeSort"
          :columns="routeColumns"
          :items="routeRows"
          :loading="store.loading || policies.loading"
          :paged="false"
          empty-description="Every country the router reaches is here; the filter and the search are what is hiding them."
          empty-title="No country matches that"
          item-value="country"
          label="SMS destinations"
        >
          <template #cell.name="{ item }">
            <span class="inline-flex max-w-full items-center gap-2">
              <!-- Fixed width so the names line up down the column whether the flag drew
                   as a flag, as two letter tiles, or as nothing at all. -->
              <span
                v-if="countryFlag(item.country)"
                aria-hidden="true"
                class="w-5 flex-none overflow-hidden text-sm leading-none whitespace-nowrap"
              >
                {{ countryFlag(item.country) }}
              </span>
              <span class="truncate text-ink">{{ item.name }}</span>
              <span class="flex-none font-mono text-[10px] text-ink/40">{{ item.country }}</span>
            </span>
          </template>

          <template #cell.price="{ item }">
            <span class="font-mono text-ink tabular-nums">{{ formatPrice(item.price) }}</span>
          </template>

          <template #cell.readiness="{ item }">
            <v-tooltip :text="item.readiness.detail" location="top" max-width="320">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="inline-flex">
                  <StatusBadge
                    :label="item.readiness.label"
                    :tone="
                      item.readiness.state === 'ready'
                        ? 'success'
                        : item.readiness.state === 'registration'
                          ? 'warning'
                          : 'neutral'
                    "
                  />
                </span>
              </template>
            </v-tooltip>
          </template>

          <template #cell.registration="{ item }">
            <v-tooltip
              :text="REGISTRATIONS[item.registration].note"
              location="top"
              max-width="320"
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="text-ink/70">
                  {{ REGISTRATIONS[item.registration].label }}
                </span>
              </template>
            </v-tooltip>
          </template>

          <!-- The specific setup flow, never a general guide (notes/sms-providers.md P2). -->
          <template #cell.fix="{ item }">
            <NuxtLink
              v-if="item.readiness.fix?.to"
              :to="item.readiness.fix.to"
              class="inline-flex items-center gap-0.5 text-xs font-medium text-ink no-underline hover:underline"
            >
              {{ item.readiness.fix.label }}
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
            </NuxtLink>
            <a
              v-else-if="item.readiness.fix?.href"
              :href="item.readiness.fix.href"
              class="inline-flex items-center gap-1 text-xs font-medium text-ink no-underline hover:underline"
              rel="noopener"
              target="_blank"
            >
              {{ item.readiness.fix.label }}
              <Icon aria-hidden="true" class="text-xs" name="material-symbols:open-in-new" />
            </a>
            <span v-else class="text-ink/35">Nothing to do</span>
          </template>

          <template #cell.provider="{ item }">
            <span class="block truncate text-ink/70">{{ item.provider }}</span>
          </template>

          <template #cell.failover="{ item }">
            <span v-if="item.failover" class="block truncate text-ink/70">
              {{ item.failover }}
            </span>
            <span v-else class="text-ink/35">One route only</span>
          </template>

          <template #cell.sender="{ item }">
            <v-tooltip :text="SENDER_NOTES[item.sender]" location="top" max-width="300">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="block truncate text-ink/70">
                  {{ SENDER_LABELS[item.sender] }}
                </span>
              </template>
            </v-tooltip>
          </template>
        </DataTable>

        <div
          class="flex flex-col gap-1.5 border-t border-line px-4 py-3 text-[11px] leading-4 text-ink/55"
        >
          <p class="m-0">{{ RATE_SOURCE }}</p>
          <p class="m-0">
            A price is per segment and not per message: the 161st plain character costs a
            second one, and a single curly apostrophe drops the whole body from
            {{ GSM7_SEGMENT }} characters to {{ UCS2_SEGMENT }}. The built-in copy is ASCII
            and fits one.
          </p>
          <p v-if="!canSendSms(policy)" class="m-0">
            This project allows nowhere, so every row reads as refused. The allowlist starts
            empty on purpose and is settled on
            <NuxtLink class="font-medium text-ink" to="/sms/policy">Policy and spend</NuxtLink>.
          </p>
        </div>
      </v-card>
    </section>

    <LayerCard
      v-model:open="expanded.vendors"
      :padded="false"
      description="What the router would have to choose between, what each one is for, and where the rates on the table come from."
      expandable
      title="Vendor catalogue and rate assumptions"
    >
      <template #badge>
        <StatusBadge
          :label="wired ? 'One wired' : 'None wired'"
          :tone="wired ? 'success' : 'neutral'"
        />
      </template>

      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="provider in SMS_PROVIDERS"
          :key="provider.id"
          class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5"
        >
          <span
            class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) bg-ink/4 text-ink/70 ring-1 ring-ink/6 ring-inset"
          >
            <Icon :name="provider.icon" aria-hidden="true" class="text-lg" />
          </span>
          <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-ink">{{ provider.label }}</span>
              <StatusBadge
                :label="PROVIDER_STATE_LABELS[provider.state]"
                :tone="provider.state === 'live' ? 'success' : 'neutral'"
              />
              <span
                class="rounded-full bg-ink/4 px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55 ring-1 ring-ink/6 ring-inset"
              >
                {{ provider.role }}
              </span>
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/55">{{ provider.note }}</p>
          </div>
        </li>
      </ul>

      <!-- The registrations written out, because the table can only carry the word and
           the note asks for the explanation to be readable without hovering anything. -->
      <div class="border-t border-line">
        <h3 class="m-0 px-4 pt-3.5 text-xs font-medium text-ink">
          What a country asks to be registered
        </h3>
        <ul class="m-0 flex list-none flex-col divide-y divide-line p-0">
          <li
            v-for="entry in REGISTRATION_LIST"
            :key="entry.id"
            class="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-4 gap-y-1 px-4 py-3"
          >
            <span class="flex flex-col gap-0.5">
              <span class="text-xs leading-4 font-medium text-ink">{{ entry.label }}</span>
              <span
                :class="entry.blocking ? 'text-warning' : 'text-ink/45'"
                class="text-[10px] leading-4"
              >
                {{ entry.blocking ? "Blocks sending" : "Nothing to file" }}
              </span>
            </span>
            <span class="text-[11px] leading-4 text-ink/55">{{ entry.note }}</span>
          </li>
        </ul>
      </div>

      <p class="m-0 border-t border-line px-4 py-3 text-[11px] leading-4 text-ink/55">
        {{ RATE_SOURCE }} A vendor reads as carrying traffic only where an adapter is
        registered on the deployment, which is what keeps the route table an intention
        rather than a claim.
      </p>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.router"
      description="What the router does with a message, and the parts of it nobody configures."
      expandable
      title="How a message is carried"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="The route on the table is where a country would go, not a vendor a project is pinned to. The router holds the per-country table, picks the cheapest vendor with acceptable delivery, and moves traffic as rates and error rates change. Nothing on this screen pins one, because a customer pinning a vendor is a customer paying more to be less reachable."
          fixed="Per country"
          label="How a vendor is chosen"
        />
        <SettingRow
          description="A failed dispatch has already reserved the spend and already spent the number's velocity, and a gateway timeout is the case where the message usually did go out. Retrying would send a second code and charge for it. Failover happens on the next request instead, which is the same reasoning that stops a refresh ever being retried."
          fixed="Never"
          label="Whether a failed send is retried"
        />
        <SettingRow
          description="A dispatch that threw may still have put a message on the wire, so the day is left overstated rather than released. The reservation and the settlement are separate for that reason: the ledger holds the day's total, not this send's share of it."
          fixed="Stands"
          label="What an unsettled reservation does"
        />
        <SettingRow
          description="Every vendor passes the same conformance suite before it can be registered, so a new route cannot behave differently from the one it replaces. What varies between them is the transport; suppression, quota and metering belong to the base and are not an adapter's to skip."
          fixed="Before registration"
          label="What a new vendor has to pass"
        />
        <SettingRow
          description="We generate the code, template it and check it ourselves rather than paying a vendor about five cents a verification on top of the message. Raw SMS is three to five times cheaper, and the template, the retry policy and the fraud logic stay where we can see them."
          fixed="Ours"
          label="Who generates the code"
        />
        <SettingRow
          description="Everything the fraud guard decides runs before a vendor is chosen, in a fixed order: where the number is, whether the caller proved they are human, then the counters, then the spend cap. Attestation is checked before any counter on purpose, or anybody could exhaust a stranger's daily allowance by naming their number."
          fixed="Before routing"
          label="What runs first"
        />
      </div>
    </LayerCard>

    <!-- Mounted only while open, like every dialog here that writes and then closes. -->
    <SmsAccountDialog
      v-if="accountOpen"
      v-model="accountOpen"
      :account="account"
      :busy="isBusy('account')"
      :check="check"
      :checking="isBusy('check')"
      @confirm="saveAccount"
      @verify="verifyAccount"
    />
  </div>
</template>

<style scoped>
.routes__search {
  min-width: 200px;
}

.routes__search :deep(.v-field) {
  --v-input-control-height: 32px;

  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.routes__search :deep(.v-field__input),
.routes__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
  min-height: 32px;
}

.routes__search :deep(.v-field__prepend-inner > .v-icon),
.routes__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}
</style>
