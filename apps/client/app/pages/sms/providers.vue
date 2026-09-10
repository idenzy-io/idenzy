<script setup lang="ts">
/**
 * Who carries this project's one-time codes, and what one costs (PROJECT.md 4.8, 5.1,
 * 11.1).
 *
 * The table is the screen. SMS is priced at regional wholesale plus twenty-five percent
 * and the price list promises that figure per country in the dashboard, so the per-country
 * rate is the content and the vendors behind it are context. A channel that bills per
 * message and hides the per-message price is one nobody can budget for.
 *
 * The one decision a project makes here is whose account carries the traffic. On ours,
 * `ProviderRouter` picks the cheapest acceptable vendor per country and moves traffic
 * between them on error rates; on the customer's own Twilio or Vonage we hand every
 * message over and charge nothing, which also means our routing and our prices stop
 * applying and the two columns that describe them come out of the table.
 *
 * What is deliberately not here is everything the fraud guard decides: the allowlist, the
 * velocity ceilings, the attestation requirement and the daily spend cap belong to Policy
 * and spend, and they run before a provider is ever chosen. This screen reads that policy
 * only to say whether the project can send at all, so the two cannot disagree.
 */

import {
  type ColumnState,
  type DataTableColumn,
  type DataTableSort,
  defaultColumnState,
  reconcileColumnState,
} from "~/utils/data-table";
import { countryFlag, countryName } from "~/utils/sessions";
import { canSendSms, evaluateReadiness, formatMoney, SMS_BLOCKERS } from "~/utils/sms-policy";
import {
  type ByoDraft,
  byoVendorInfo,
  formatPrice,
  GSM7_SEGMENT,
  isAllowed,
  MODE_LABELS,
  PROVIDER_STATE_LABELS,
  priceFor,
  priceRange,
  providerLabel,
  REGISTRATIONS,
  type Registration,
  SENDER_LABELS,
  SENDER_NOTES,
  type SenderKind,
  SMS_MARGIN,
  SMS_PROVIDERS,
  SMS_ROUTES,
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
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const policy = computed(() => policies.policyFor(projects.current.id));
const readiness = computed(() =>
  evaluateReadiness(
    policy.value,
    policies.spentToday(projects.current.id),
    policies.attestationWired,
  ),
);

/* Which cards start unfolded. The table is what most visits are for. */
const expanded = reactive({ vendors: false, router: false });

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
 * Whose account carries it.
 */

const accountOpen = ref(false);

const modeOptions = computed(() => [
  { value: "managed", label: MODE_LABELS.managed },
  {
    value: "byo",
    label: MODE_LABELS.byo,
    /* Choosing it without credentials would put the project on a vendor it cannot reach,
       so the segment opens the dialog instead of being a choice on its own. */
    disabled: account.value === null,
  },
]);

function chooseMode(next: string) {
  if (next === "byo" && account.value === null) {
    accountOpen.value = true;
    return;
  }
  void whileBusy("mode", () =>
    store.setMode(projects.current.id, next === "byo" ? "byo" : "managed"),
  );
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

/*
 * The routing table.
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
}

const routeRows = computed<RouteRow[]>(() =>
  SMS_ROUTES.map((route) => ({
    country: route.country,
    name: countryName(route.country) ?? route.country,
    provider: providerLabel(route.provider),
    failover: route.failover === null ? "" : providerLabel(route.failover),
    price: priceFor(route.wholesale),
    sender: route.sender,
    registration: route.registration,
    allowed: isAllowed(route.country, policy.value?.allowedCountries ?? []),
  })),
);

const ROUTE_COLUMNS: readonly DataTableColumn<RouteRow>[] = [
  { key: "name", title: "Country", fixed: true, minWidth: 200 },
  { key: "provider", title: "Carried by", width: 190 },
  { key: "failover", title: "Falls back to", width: 170, hidden: true },
  { key: "price", title: "Per message", width: 140, mono: true },
  { key: "sender", title: "Sender", width: 160, value: (row) => SENDER_LABELS[row.sender] },
  {
    key: "registration",
    title: "Registration",
    width: 160,
    skeleton: "pill",
    value: (row) => REGISTRATIONS[row.registration].label,
  },
  { key: "allowed", title: "On the allowlist", width: 160, value: (row) => (row.allowed ? 0 : 1) },
];

/** Ours to route and ours to price, so they say nothing about a project on its own vendor. */
const OURS_ONLY: readonly string[] = ["provider", "failover", "price"];

const routeColumns = computed(() =>
  managed.value ? ROUTE_COLUMNS : ROUTE_COLUMNS.filter((column) => !OURS_ONLY.includes(column.key)),
);

const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.sms-routes.columns",
  defaultColumnState(ROUTE_COLUMNS),
);
const routeColumnState = computed<ColumnState>({
  get: () => reconcileColumnState(routeColumns.value, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});

const routeSort = ref<DataTableSort[]>([{ key: "name", order: "asc" }]);

const range = computed(() => priceRange(SMS_ROUTES));
const allowedCount = computed(() => routeRows.value.filter((row) => row.allowed).length);

const GUIDES_URL = "https://idenzy.dev/docs/sms";

const GUIDES = [
  {
    icon: "material-symbols:route",
    title: "How a message is routed",
    detail: "Cheapest acceptable vendor per country, and why nothing is ever retried.",
    href: `${GUIDES_URL}/routing`,
  },
  {
    icon: "material-symbols:approval-outline",
    title: "10DLC, DLT and IYS",
    detail: "What has to be registered before a country will carry your codes.",
    href: `${GUIDES_URL}/registration`,
  },
  {
    icon: "material-symbols:swap-horiz",
    title: "Bringing your own Twilio",
    detail: "What changes, what does not, and what we stop charging for.",
    href: `${GUIDES_URL}/byo`,
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:sms-outline" title="SMS providers">
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
        <FancyButton @click="accountOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:key-outline" />
          {{ account ? "Replace credentials" : "Use your own account" }}
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          description="Ours picks the cheapest acceptable vendor per country and bills you for the message. Yours hands every message to your account and we charge nothing for carriage."
          title="Whose account carries it"
        >
          <template #actions>
            <SegmentedControl
              :disabled="isBusy('mode') || store.loading"
              :model-value="mode"
              :options="modeOptions"
              label="Whose account carries it"
              @update:model-value="chooseMode"
            />
          </template>

          <div v-if="managed" class="divide-y divide-line">
            <SettingRow
              :description="`Regional wholesale plus ${Math.round(SMS_MARGIN * 100)} percent, per segment, with every country's rate on the table below. Nothing on this screen changes it, and there is no plan tier that lowers it.`"
              :fixed="`${formatPrice(range.low)} to ${formatPrice(range.high)}`"
              label="What you pay"
            />
            <SettingRow
              description="A message is billed per segment and not per message: the 161st plain character costs a second one, and a single curly apostrophe drops the whole body from 160 characters to 70. The built-in copy is ASCII and fits one segment."
              :fixed="`${GSM7_SEGMENT} or ${UCS2_SEGMENT}`"
              label="What a segment is"
            />
          </div>

          <div v-else-if="account" class="flex flex-col gap-4">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
              <span
                class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-canvas text-ink/70"
              >
                <Icon aria-hidden="true" class="text-lg" name="material-symbols:key-outline" />
              </span>
              <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="text-sm font-medium text-ink">{{ vendorLabel }}</span>
                  <StatusBadge label="Your account" tone="success" />
                </div>
                <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:badge-outline" />
                    <span class="truncate font-mono">{{ account.key }}</span>
                  </span>
                  <span v-if="secretAge" class="flex items-center gap-1.5">
                    <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:lock-outline" />
                    Secret written {{ secretAge }}
                  </span>
                </div>
              </div>
              <v-btn
                :loading="isBusy('account')"
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="outlined"
                @click="removeAccount"
              >
                Hand back to our routing
              </v-btn>
            </div>

            <p class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/55">
              <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm" name="material-symbols:info-outline" />
              <span>
                Handing it back is not an outage: our routing takes over on the next message
                and the pricing below applies again from that moment. The fraud guard, the
                allowlist and the spend cap run either way.
              </span>
            </p>
          </div>
        </LayerCard>

        <LayerCard
          :padded="false"
          :description="
            managed
              ? 'Every country the router reaches, what it costs you per segment, and what has to be registered before it will carry anything.'
              : 'Your account carries every country, so the route and the price are yours. What a sender may be called and what has to be registered are the carrier\'s and still apply.'
          "
          title="Where a message goes"
        >
          <template #badge>
            <StatusBadge
              :label="canSendSms(policy) ? `${allowedCount} allowed` : 'None allowed'"
              :tone="canSendSms(policy) ? 'success' : 'warning'"
            />
          </template>
          <template #actions>
            <DataTableColumnsMenu v-model="routeColumnState" :columns="routeColumns" />
          </template>

          <DataTable
            v-model:column-state="routeColumnState"
            v-model:sort-by="routeSort"
            :columns="routeColumns"
            :items="routeRows"
            :loading="store.loading || policies.loading"
            :paged="false"
            item-value="country"
            label="SMS routes"
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

            <template #cell.provider="{ item }">
              <span class="block truncate text-ink/80">{{ item.provider }}</span>
            </template>

            <template #cell.failover="{ item }">
              <span v-if="item.failover" class="block truncate text-ink/70">
                {{ item.failover }}
              </span>
              <span v-else class="text-ink/35">One route only</span>
            </template>

            <template #cell.price="{ item }">
              <span class="font-mono tabular-nums text-ink">{{ formatPrice(item.price) }}</span>
            </template>

            <template #cell.sender="{ item }">
              <v-tooltip :text="SENDER_NOTES[item.sender]" location="top" max-width="300">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="block truncate text-ink/80">
                    {{ SENDER_LABELS[item.sender] }}
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
                  <span v-bind="tip" class="inline-flex">
                    <StatusBadge
                      :label="REGISTRATIONS[item.registration].label"
                      :tone="REGISTRATIONS[item.registration].blocking ? 'warning' : 'neutral'"
                    />
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.allowed="{ item }">
              <span v-if="item.allowed" class="flex items-center gap-1.5 text-ink/80">
                <Icon
                  aria-hidden="true"
                  class="flex-none text-sm text-success"
                  name="material-symbols:check-circle-outline"
                />
                Allowed
              </span>
              <span v-else class="text-ink/40">Not allowed</span>
            </template>
          </DataTable>

          <p class="m-0 border-t border-line px-4 py-3 text-[11px] leading-4 text-ink/55">
            A country the router reaches is not a country this project sends to. The
            allowlist is
            <NuxtLink class="font-medium text-ink" to="/sms/policy">Policy and spend</NuxtLink>,
            it starts empty, and it stays that way until somebody chooses: pumping picks the
            destination, so the countries a product does not serve are exactly the ones an
            attacker sends to.
          </p>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.vendors"
          :padded="false"
          description="What the router has to choose between on this deployment, and what each one is for."
          expandable
          title="The vendors behind it"
        >
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="provider in SMS_PROVIDERS"
              :key="provider.id"
              class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5"
            >
              <span
                class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) border border-line bg-canvas text-ink/70"
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
                    class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
                  >
                    {{ provider.role }}
                  </span>
                </div>
                <p class="m-0 text-[11px] leading-4 text-ink/55">{{ provider.note }}</p>
              </div>
            </li>
          </ul>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.router"
          description="What the router does with a message, and the parts of it nobody configures."
          expandable
          title="How a message is carried"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="The route on the table is where a country goes today, not a vendor a project is pinned to. The router holds the per-country table, picks the cheapest vendor with acceptable delivery, and moves traffic as rates and error rates change. Nothing on this screen pins one, because a customer pinning a vendor is a customer paying more to be less reachable."
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
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Traffic</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
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

        <LayerCard
          :padded="false"
          description="Read from Policy and spend, so this screen cannot promise what the guard refuses."
          title="Can this project send?"
        >
          <div v-if="readiness.sendable" class="flex items-start gap-2.5 p-4 text-xs">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-base text-success"
              name="material-symbols:check-circle-outline"
            />
            <span class="text-ink/70">
              Nothing is standing in the way. Today's cap has
              {{ formatMoney(Math.max(0, (policy?.dailySpendCap ?? 0) - policies.spentToday(projects.current.id)), policy?.currency ?? "USD") }}
              left in it.
            </span>
          </div>

          <ul v-else class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="blocker in readiness.blockers"
              :key="blocker"
              class="flex items-start gap-2.5 p-4"
            >
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-base text-warning"
                name="material-symbols:warning-outline"
              />
              <span class="flex min-w-0 flex-col gap-1">
                <span class="text-xs font-medium text-ink">{{ SMS_BLOCKERS[blocker].title }}</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  {{ SMS_BLOCKERS[blocker].detail }}
                </span>
                <span class="font-mono text-[10px] text-ink/45">
                  {{ SMS_BLOCKERS[blocker].errorCode }}
                </span>
              </span>
            </li>
          </ul>

          <div class="border-t border-line px-4 py-3">
            <NuxtLink
              class="inline-flex items-center gap-1 text-[11px] font-medium text-ink no-underline hover:underline"
              to="/sms/policy"
            >
              Open Policy and spend
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:arrow-forward" />
            </NuxtLink>
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

        <SaveStatus :last-saved="lastSaved" :saving="saving" />
      </aside>
    </div>

    <SmsAccountDialog
      v-model="accountOpen"
      :account="account"
      :busy="isBusy('account')"
      @confirm="saveAccount"
    />
  </div>
</template>
