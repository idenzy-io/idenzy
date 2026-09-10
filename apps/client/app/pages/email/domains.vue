<script setup lang="ts">
/**
 * Where a project's mail comes from (PROJECT.md 11.1, 11.2).
 *
 * The screen opens with the answer rather than the list, because the question an operator
 * arrives with is "what address do my users see", and that is one line. Everything under
 * it is how to change that line: the domains the project holds, the DNS each one is
 * waiting on, and the rules that do not move.
 *
 * A project is never without a sending domain. `mail.idenzy.dev` is there from the first
 * day and cannot be removed, so nothing here is a setup that has to be finished before
 * mail works, and every consequence on this screen is a change of sender rather than an
 * outage. That is also why adding a domain and sending from it are two separate acts: a
 * From line pointed at a domain whose DKIM is not published is mail no receiver can
 * check, so the second is refused until the records resolve.
 *
 * The panel displays records and never computes them. The DKIM tokens are minted with the
 * identity and arrive on the row, so a screen that built one would show a plausible token
 * that does not exist, and the customer would paste it into DNS and wait.
 */
import {
  BOUNCE_LIMIT,
  BREAK_EVEN_SENDS,
  COMPLAINT_LIMIT,
  CUSTOM_DOMAIN_MONTHLY,
  isReadyToSend,
  monthlyCost,
  ratePercent,
  reputationTone,
  type SendingDomain,
  SHARED_DOMAIN,
  senderLine,
} from "~/utils/sending-domains";

const projects = useProjectStore();
const store = useSendingDomainsStore();

const domains = computed(() => store.forProject(projects.current.id));
const sending = computed(() => store.sendingFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/* Which cards start unfolded. The rules are the reference half of the screen. */
const expanded = reactive({ rules: false });

/* The rows on their way to the server, so each one shows its own wait. */
const busy = ref<Set<string>>(new Set());
const saving = computed(() => busy.value.size > 0);

function isBusy(id: string): boolean {
  return busy.value.has(id);
}

async function whileBusy(id: string, work: () => Promise<void>) {
  busy.value = new Set([...busy.value, id]);
  try {
    await work();
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== id));
  }
}

/*
 * The list. The shared domain is first and the customer's follow in the order they were
 * added, so a row never moves under the pointer that is about to click it.
 */
const own = computed(() => domains.value.filter((domain) => !domain.shared));
const verifiedCount = computed(() => own.value.filter(isReadyToSend).length);

const onShared = computed(() => sending.value?.shared !== false);
const senderSample = computed(() =>
  senderLine(projects.current.name, sending.value?.domain ?? SHARED_DOMAIN),
);

/**
 * What a month of this project's mail costs on either domain. Both figures rather than
 * the difference: a domain of your own is dearer under fifty thousand mails a month, and
 * a screen that showed only the saving would be quoting a saving that is not there.
 */
const cost = computed(() => ({
  shared: monthlyCost(stats.value.sent, false),
  own: monthlyCost(stats.value.sent, true),
}));

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const bounceRate = computed(() =>
  stats.value.sent === 0 ? 0 : stats.value.bounced / stats.value.sent,
);
const complaintRate = computed(() =>
  stats.value.sent === 0 ? 0 : stats.value.complained / stats.value.sent,
);

const TONE_INK: Record<string, string> = {
  good: "text-success",
  watch: "text-warning",
  over: "text-error",
};
const TONE_FILL: Record<string, string> = {
  good: "bg-success",
  watch: "bg-warning",
  over: "bg-error",
};

const reputation = computed(() => [
  {
    id: "bounced",
    label: "Hard bounces",
    rate: bounceRate.value,
    limit: BOUNCE_LIMIT,
    tone: reputationTone(bounceRate.value, BOUNCE_LIMIT),
    note: "The receiving server said the address does not exist. Every one of these is added to the suppression list and never sent to again.",
  },
  {
    id: "complained",
    label: "Marked as spam",
    rate: complaintRate.value,
    limit: COMPLAINT_LIMIT,
    tone: reputationTone(complaintRate.value, COMPLAINT_LIMIT),
    note: "Weighted far more heavily than a bounce by every mailbox provider, and the one signal that gets a domain blocked outright.",
  },
]);

/** How full the bar is: the rate against its own limit, never past the end. */
function meter(rate: number, limit: number): string {
  return `${Math.min(rate / limit, 1) * 100}%`;
}

const ceilingUsed = computed(() =>
  stats.value.dailyCeiling === 0
    ? 0
    : Math.min(stats.value.sentToday / stats.value.dailyCeiling, 1),
);

/*
 * Adding, verifying and removing.
 */

const addOpen = ref(false);
const recordsOpen = ref(false);
const removeOpen = ref(false);
const openId = ref<string | null>(null);

const openDomain = computed<SendingDomain | null>(
  () => domains.value.find((domain) => domain.id === openId.value) ?? null,
);

async function confirmAdd(domain: string) {
  await whileBusy("add", async () => {
    const created = await store.add(projects.current.id, domain);
    addOpen.value = false;
    /* Straight into the records, because the records are the whole of what is left to
       do and a list row that says "verifying" answers nothing on its own. */
    openId.value = created.id;
    recordsOpen.value = true;
  });
}

function showRecords(id: string) {
  openId.value = id;
  recordsOpen.value = true;
}

function askRemoval(id: string) {
  openId.value = id;
  removeOpen.value = true;
}

async function confirmRemoval() {
  const id = openId.value;
  if (id === null) return;
  await whileBusy(id, () => store.remove(projects.current.id, id));
  removeOpen.value = false;
}

async function check() {
  const id = openId.value;
  if (id === null) return;
  await whileBusy(id, () => store.recheck(projects.current.id, id));
}

async function use(id: string) {
  await whileBusy(id, () => store.use(projects.current.id, id));
}

const GUIDES_URL = "https://idenzy.dev/docs/email";

const GUIDES = [
  {
    icon: "material-symbols:dns-outline",
    title: "The five records",
    detail: "What each one proves, and the one everybody forgets.",
    href: `${GUIDES_URL}/sending-domains`,
  },
  {
    icon: "material-symbols:policy",
    title: "DMARC without breaking your mail",
    detail: "From p=none to p=reject, and how to read the reports.",
    href: `${GUIDES_URL}/dmarc`,
  },
  {
    icon: "material-symbols:trending-up",
    title: "Warming a new domain",
    detail: "Why the daily ceiling starts low and what raises it.",
    href: `${GUIDES_URL}/warm-up`,
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:mail-outline" title="Sending domains">
      <template #description>
        The address auth mail on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> comes from.
        Every project sends from ours until a domain of yours is verified, and nothing here
        can leave a project unable to send.
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
          Email guides
        </v-btn>
        <FancyButton @click="addOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add a domain
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          description="One address for every auth mail this project sends, and the subdomain rejections come back to."
          title="Sending from"
        >
          <template #badge>
            <StatusBadge
              :label="onShared ? 'Our shared domain' : 'Your domain'"
              :tone="onShared ? 'neutral' : 'success'"
            />
          </template>

          <div class="flex flex-col gap-4">
            <SamplePanel
              meta="What a mailbox shows"
              note="The name is the project's and the address is the domain's. There is no per-template from-name yet, so this is the whole of what a user sees."
              title="From"
            >
              <div class="flex flex-col gap-1.5">
                <SampleLine icon="material-symbols:outgoing-mail" mono>
                  {{ senderSample }}
                </SampleLine>
                <SampleLine icon="material-symbols:u-turn-left" mono tone="muted">
                  {{ sending ? `Return-Path: ${sending.mailFrom}` : "" }}
                </SampleLine>
              </div>
            </SamplePanel>

            <div class="divide-y divide-line">
              <SettingRow
                :fixed="onShared ? 'Ours' : 'Yours'"
                :description="
                  onShared
                    ? `SPF, DKIM and DMARC on ${SHARED_DOMAIN} are published by us and already correct. What comes with that is a reputation shared with every project on it, so one customer's bounces are felt by all of them.`
                    : `DKIM signs as ${sending?.domain}, bounces return to ${sending?.mailFrom}, and the reputation earned is this project's alone. What DMARC does with a failure is your record to publish.`
                "
                label="Who owns the reputation"
              />
              <SettingRow label="What a month costs">
                <template #description>
                  At this project's last thirty days, {{ stats.sent.toLocaleString("en") }}
                  mails: <span class="font-mono text-ink/80">{{ money(cost.shared) }}</span>
                  on ours against
                  <span class="font-mono text-ink/80">{{ money(cost.own) }}</span> on one of
                  yours. A domain of your own carries {{ money(CUSTOM_DOMAIN_MONTHLY) }} a
                  month and a lower rate per thousand, so it is the dearer option under
                  {{ BREAK_EVEN_SENDS.toLocaleString("en") }} mails a month. Nobody should
                  add one to save money.
                </template>
              </SettingRow>
            </div>
          </div>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="Ours is always here and cannot be removed. Yours send only once every required record resolves."
          title="Domains"
        >
          <template #badge>
            <StatusBadge
              :label="verifiedCount === 0 ? 'None of yours yet' : `${verifiedCount} verified`"
              :tone="verifiedCount === 0 ? 'neutral' : 'success'"
            />
          </template>

          <!-- Two rows of nothing while the store answers, so the card keeps its height
               and the list does not arrive as a jump. -->
          <div v-if="store.loading" class="divide-y divide-line">
            <div v-for="row in 2" :key="row" class="flex items-center gap-4 px-4 py-4">
              <span class="size-9 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8" />
              <span class="flex min-w-0 flex-1 flex-col gap-2">
                <span class="h-3 w-40 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2.5 w-64 animate-pulse rounded-full bg-ink/6" />
              </span>
            </div>
          </div>

          <div v-else class="divide-y divide-line">
            <SendingDomainRow
              v-for="domain in domains"
              :key="domain.id"
              :busy="isBusy(domain.id)"
              :domain="domain"
              @records="showRecords(domain.id)"
              @remove="askRemoval(domain.id)"
              @use="use(domain.id)"
            />
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              <template v-if="own.length === 0">
                Adding one takes five DNS records and about ten minutes, most of it waiting.
              </template>
              <template v-else>
                Every domain of yours is billed at {{ money(CUSTOM_DOMAIN_MONTHLY) }} a month,
                verified or not.
              </template>
            </p>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:add"
              size="small"
              variant="outlined"
              @click="addOpen = true"
            >
              Add a domain
            </v-btn>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.rules"
          description="What we publish, what we check for, and the parts of this nobody configures."
          expandable
          title="What is checked, and what is not"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Three CNAMEs rather than one key in a TXT record, because the signing key rotates on our side and a rotation must not need you to touch DNS again. The keys are 2048-bit, which is what every mailbox provider now expects and what our own domains use."
              fixed="2048-bit"
              label="DKIM is three records"
            />
            <SettingRow
              description="SPF goes on the bounce subdomain and never on the domain itself. Yours can already be publishing an SPF record for your own mail, and a domain may hold only one: putting ours beside it would either overwrite yours or push the pair past the ten-lookup limit, and both fail quietly."
              fixed="On the subdomain"
              label="Where SPF goes"
            />
            <SettingRow
              description="An MX on the bounce subdomain is the record people leave out, and leaving it out breaks nothing visibly. Mail still sends, the return path stays on the provider's own domain, DMARC alignment then rests on DKIM alone, and no error anywhere says that is what happened. It is required here for that reason."
              fixed="Required"
              label="The bounce route"
            />
            <SettingRow
              description="It is not needed to send and we do not check for it, so a domain verifies without one. We publish p=reject on our own domains and the record we hand you says the same, but the policy is a decision about your whole namespace and the reports come to you, not us."
              fixed="Yours"
              label="DMARC is advice"
            />
            <SettingRow
              description="A domain of yours is refused as a sender until every required record resolves. A half-published domain sends mail no receiver can check, and the reputation that suffers is the one with your name on it, so the control is not offered rather than offered and warned about."
              fixed="All or none"
              label="When a domain may send"
            />
            <SettingRow
              description="A new project starts with a low daily ceiling and it grows with a clean bounce rate. That protects the shared domain, whose reputation belongs to every project on it, and it is not a setting: nothing in this panel raises it and asking does not either."
              :fixed="`${stats.dailyCeiling.toLocaleString('en')} a day`"
              label="The daily ceiling"
            />
            <SettingRow
              description="A hard bounce or a spam complaint puts the address on the project's suppression list, and nothing sends to it again. That is enforced before any transport runs rather than by policy, because sending to a known-dead address is the fastest way to lose a sending reputation."
              fixed="Never re-sent"
              label="What a bounce does"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Delivery</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="11" :series="stats.sentDaily" :value="stats.sent" label="Sent" />
          <UsageTile
            :seed="13"
            :value="stats.delivered"
            info="Accepted by the receiving server. A delivery is not a read, and we count no opens."
            label="Delivered"
          />
          <UsageTile
            :seed="17"
            :series="stats.bouncedDaily"
            :value="stats.bounced"
            info="Rejected outright by the receiving server. Each one is suppressed and never sent to again."
            label="Bounced"
          />
          <UsageTile
            :seed="19"
            :value="stats.complained"
            info="The recipient pressed the spam button and their provider told us."
            label="Marked as spam"
          />
        </div>

        <LayerCard
          :padded="false"
          description="Against the thresholds a provider reviews an account at."
          title="Reputation"
        >
          <ul class="m-0 flex list-none flex-col gap-4 p-4">
            <li v-for="entry in reputation" :key="entry.id" class="flex flex-col gap-1.5">
              <div class="flex items-baseline justify-between gap-3 text-xs">
                <span class="text-ink/80">{{ entry.label }}</span>
                <span :class="TONE_INK[entry.tone]" class="font-mono tabular-nums">
                  {{ ratePercent(entry.rate) }}
                </span>
              </div>
              <span class="relative block h-1.5 overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="TONE_FILL[entry.tone]"
                  :style="{ width: meter(entry.rate, entry.limit) }"
                  class="block h-full rounded-full"
                />
              </span>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                {{ entry.note }} Reviewed at {{ ratePercent(entry.limit) }}.
              </p>
            </li>
          </ul>

          <div class="flex flex-col gap-1.5 border-t border-line p-4">
            <div class="flex items-baseline justify-between gap-3 text-xs">
              <span class="text-ink/80">Today</span>
              <span class="font-mono text-ink tabular-nums">
                {{ stats.sentToday.toLocaleString("en") }}
                <span class="text-ink/45">/ {{ stats.dailyCeiling.toLocaleString("en") }}</span>
              </span>
            </div>
            <span class="block h-1.5 overflow-hidden rounded-full bg-ink/8">
              <span
                :style="{ width: `${ceilingUsed * 100}%` }"
                class="block h-full rounded-full bg-primary"
              />
            </span>
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              The project's own ceiling for the day. It grows on its own as the bounce rate
              stays clean.
            </p>
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

    <SendingDomainAddDialog
      v-model="addOpen"
      :busy="isBusy('add')"
      :existing="domains.map((domain) => domain.domain)"
      @confirm="confirmAdd"
    />
    <SendingDomainRecordsDialog
      v-model="recordsOpen"
      :busy="openId !== null && isBusy(openId)"
      :domain="openDomain"
      @check="check"
    />
    <SendingDomainRemoveDialog
      v-model="removeOpen"
      :busy="openId !== null && isBusy(openId)"
      :domain="openDomain"
      @confirm="confirmRemoval"
    />
  </div>
</template>
