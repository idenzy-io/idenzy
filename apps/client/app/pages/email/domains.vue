<script setup lang="ts">
/**
 * Where a project's mail comes from (PROJECT.md 11.1, 11.2, notes/email-domains.md).
 *
 * The screen opens with the answer rather than the list, because the question an operator
 * arrives with is "what address do my users see", and that is one line. Change sender sits
 * beside that line and nowhere else: it is the only control here that changes what a
 * recipient sees, and it is deliberately not reachable from the act of verifying a domain.
 *
 * Under the address, the three facts that follow from it, as a strip rather than as
 * paragraphs: where a rejection goes, whose reputation carries the mail, and what a month
 * of it costs on either domain. What cannot be acted on from here (why DKIM is three
 * records, where SPF goes, what a bounce does) is folded away at the foot, because a
 * screen that explains before it answers is one somebody scrolls past.
 *
 * A project is never without a sending domain. `mail.idenzy.dev` is there from the first
 * day and cannot be removed, so nothing here is a setup that has to be finished before
 * mail works, and every consequence on this screen is a change of sender rather than an
 * outage. That is also why adding a domain and sending from it are two separate acts: a
 * From line pointed at a domain whose DKIM is not published is mail no receiver can check,
 * so the second is refused until the records resolve.
 *
 * Then the list, with verification and sending as two columns, and a row's own control
 * opens that domain's setup: four steps, its records with what the last check found, and
 * the two actions in the note's order, Check records until the required ones pass and Send
 * from this afterwards. It is a dialog, the way the revocation setup is: the list is what
 * the screen is about, and a block under it pushed delivery off the fold and left a reader
 * scrolling back up to change which domain they were reading.
 *
 * Delivery is last and says what it measured. Sends are ours to count; whether a message
 * was delivered, bounced or reported is a provider event, and that pipeline is designed
 * and not built, so those read as unknown rather than as nought. A measured-looking zero
 * on this screen would be the panel promising health nothing has ever checked, which is
 * the contradiction the note's third finding is about.
 */
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  BREAK_EVEN_SENDS,
  CUSTOM_DOMAIN_MONTHLY,
  DELIVERY_PERIOD,
  deliveryFigures,
  isReadyToSend,
  monthlyCost,
  REPUTATION_LIMITS,
  ratePercent,
  type SendingDomain,
  SHARED_DOMAIN,
  senderLine,
} from "~/utils/sending-domains";
import { ingestionAvailable } from "~/utils/suppressions";

const projects = useProjectStore();
const store = useSendingDomainsStore();

const domains = computed(() => store.forProject(projects.current.id));
const sending = computed(() => store.sendingFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));

/* Which cards start unfolded. The rules are the reference half of the screen. */
const expanded = reactive({ rules: false });

/* The rows on their way to the server, so each one shows its own wait. */
const busy = ref<Set<string>>(new Set());

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
 * The answer: one address, and what follows from it.
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

/*
 * The list. The shared domain is first and the customer's follow in the order they were
 * added, so a row never moves under the pointer that is about to click it.
 */

const LIST_COLUMNS: readonly RecordColumn[] = [
  { key: "domain", label: "Domain", width: "minmax(0, 1.6fr)" },
  { key: "verification", label: "Verification", width: "152px" },
  { key: "sending", label: "Sending", width: "168px" },
  { key: "checked", label: "Last check", width: "112px" },
  { key: "manage", label: "Manage", width: "116px", align: "end" },
];

const listHeading = computed(() => {
  if (own.value.length === 0) return "Sending from ours";
  const verified = verifiedCount.value;
  return verified === own.value.length
    ? `${own.value.length} of yours, all verified`
    : `${verified} of ${own.value.length} of yours verified`;
});

/*
 * The selected domain, and its setup.
 */
const openId = ref<string | null>(null);
const sheetOpen = ref(false);

const openDomain = computed<SendingDomain | null>(
  () => domains.value.find((domain) => domain.id === openId.value) ?? null,
);

function openSetup(id: string) {
  openId.value = id;
  sheetOpen.value = true;
}

/* Nothing stays selected across projects: the id would name a row that is not there. */
watch(
  () => projects.current.id,
  () => {
    openId.value = null;
    sheetOpen.value = false;
  },
);

/*
 * Adding, checking, moving the sender and removing.
 */
const addOpen = ref(false);
const senderOpen = ref(false);
const removeOpen = ref(false);
const removeId = ref<string | null>(null);
const senderError = ref("");

const removeDomain = computed<SendingDomain | null>(
  () => domains.value.find((domain) => domain.id === removeId.value) ?? null,
);

async function confirmAdd(domain: string) {
  await whileBusy("add", async () => {
    const created = await store.add(projects.current.id, domain);
    addOpen.value = false;
    /* Straight into the setup, because the records are the whole of what is left to do
       and a list row that says "verifying" answers nothing on its own. */
    openSetup(created.id);
  });
}

async function check() {
  const id = openId.value;
  if (id === null) return;
  await whileBusy(id, () => store.recheck(projects.current.id, id));
}

function askSender() {
  senderError.value = "";
  senderOpen.value = true;
}

/** The dialog closes on a confirmed write and on nothing else (notes/dialogs.md). */
async function confirmSender(id: string) {
  try {
    await whileBusy("sender", () => store.use(projects.current.id, id));
  } catch {
    senderError.value = "The sender did not change. Nothing moved, so try again.";
    return;
  }
  senderOpen.value = false;
}

function askRemoval(id: string) {
  removeId.value = id;
  removeOpen.value = true;
}

async function confirmRemoval() {
  const id = removeId.value;
  if (id === null) return;
  await whileBusy(id, () => store.remove(projects.current.id, id));
  removeOpen.value = false;
  sheetOpen.value = false;
  if (openId.value === id) openId.value = null;
}

/*
 * Delivery, and what of it is measured.
 */
const recorded = ingestionAvailable();

const figures = computed(() =>
  deliveryFigures(
    {
      sent: stats.value.sent,
      delivered: stats.value.delivered,
      bounced: stats.value.bounced,
      complained: stats.value.complained,
    },
    recorded,
  ),
);

const ceilingUsed = computed(() =>
  stats.value.dailyCeiling === 0
    ? 0
    : Math.min(stats.value.sentToday / stats.value.dailyCeiling, 1),
);

const GUIDES_URL = "https://idenzy.dev/docs/email";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Sending domains">
      <template #badge>
        <StatusBadge
          :label="onShared ? 'Our domain' : 'Your domain'"
          :tone="onShared ? 'neutral' : 'success'"
        />
      </template>
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
          Add domain
        </FancyButton>
      </template>
    </PageHeader>

    <!--
      The answer first, and the one control that changes it beside it. Change sender lives
      here and nowhere else, so moving the From line is never something that happens on the
      way to somewhere else.
    -->
    <v-card border flat>
      <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-4">
        <div class="flex min-w-0 flex-col gap-1.5">
          <span class="text-[11px] leading-4 text-ink/45">
            Every auth mail on this project leaves as
          </span>
          <span
            v-if="store.loading"
            class="my-1 block h-4 w-64 max-w-full animate-pulse rounded-full bg-ink/8"
          />
          <p v-else class="m-0 font-mono text-base leading-6 break-all text-ink">
            {{ senderSample }}
          </p>
          <span class="text-[11px] leading-4 text-ink/50">
            The name is the project's and the address is the domain's. There is no
            per-template from-name, so this is the whole of what a user sees.
          </span>
        </div>

        <v-btn
          class="flex-none text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:swap-horiz"
          size="small"
          variant="outlined"
          @click="askSender"
        >
          Change sender
        </v-btn>
      </div>

      <!--
        The three facts that follow from that address. A strip of columns rather than
        paragraphs: each is one label, one value and one line, and the reasoning behind
        them is folded away at the foot of the page.
      -->
      <div class="grid gap-px border-t border-line bg-line sm:grid-cols-3">
        <div class="flex flex-col gap-1 bg-surface p-4">
          <span class="text-[11px] leading-4 text-ink/45">Rejections return to</span>
          <span class="font-mono text-xs break-all text-ink">
            {{ sending?.mailFrom ?? SHARED_DOMAIN }}
          </span>
          <span class="text-[11px] leading-4 text-ink/50">
            The Return-Path a receiving server bounces to, and where our SPF record goes.
          </span>
        </div>

        <div class="flex flex-col gap-1 bg-surface p-4">
          <span class="text-[11px] leading-4 text-ink/45">Reputation</span>
          <span class="text-xs font-medium text-ink">{{ onShared ? "Ours" : "Yours" }}</span>
          <span class="text-[11px] leading-4 text-ink/50">
            <template v-if="onShared">
              Shared with every project on
              <span class="font-mono">{{ SHARED_DOMAIN }}</span>, so one customer's bounces
              are felt by all of them.
            </template>
            <template v-else>
              Earned by <span class="font-mono">{{ sending?.domain }}</span> alone, and it is
              your name on it.
            </template>
          </span>
        </div>

        <div class="flex flex-col gap-1 bg-surface p-4">
          <span class="text-[11px] leading-4 text-ink/45">This month</span>
          <span class="font-mono text-xs text-ink tabular-nums">
            {{ money(onShared ? cost.shared : cost.own) }}
          </span>
          <span class="text-[11px] leading-4 text-ink/50">
            Against
            <span class="font-mono">{{ money(onShared ? cost.own : cost.shared) }}</span>
            on {{ onShared ? "one of yours" : "ours" }}, at
            {{ stats.sent.toLocaleString("en") }} mails over the last thirty days.
          </span>
        </div>
      </div>
    </v-card>

    <!--
      The list, with verification and sending as two columns. They are two questions, and
      a row that answered only the first would let a reader believe their own domain was
      already carrying their mail.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">
          {{ store.loading ? "Reading this project's domains" : listHeading }}
        </h2>
        <p class="m-0 text-xs leading-5 text-ink/55">
          Ours is always here and cannot be removed. One of yours sends only once every
          required record resolves, and even then only when you move the From line to it.
        </p>
      </header>

      <RecordTable :columns="LIST_COLUMNS" framed label="Sending domains">
        <!-- Two rows of nothing while the store answers, so the list keeps its height
             and arrives as a fill rather than as a jump. -->
        <template v-if="store.loading">
          <li v-for="row in 2" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex items-center gap-3">
              <span
                class="size-7 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8"
              />
              <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                <span class="h-2.5 w-36 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2 w-24 animate-pulse rounded-full bg-ink/6" />
              </span>
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-4 w-20 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-4 w-24 animate-pulse rounded-full bg-ink/8" />
            </span>
            <span class="record-cell record-cell--half">
              <span class="block h-2 w-14 animate-pulse rounded-full bg-ink/6" />
            </span>
            <span class="record-cell record-cell--action" />
          </li>
        </template>

        <template v-else>
          <SendingDomainRow
            v-for="domain in domains"
            :key="domain.id"
            :busy="isBusy(domain.id)"
            :domain="domain"
            @open="openSetup(domain.id)"
            @remove="askRemoval(domain.id)"
          />
        </template>
      </RecordTable>

      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p class="m-0 text-[11px] leading-4 text-ink/50">
          <template v-if="own.length === 0">
            Adding one takes five DNS records and about ten minutes, most of it waiting.
          </template>
          <template v-else>
            Every domain of yours is billed at {{ money(CUSTOM_DOMAIN_MONTHLY) }} a month,
            verified or not.
          </template>
        </p>
        <v-btn
          class="-mr-2 text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="text"
          @click="addOpen = true"
        >
          Add domain
        </v-btn>
      </div>
    </section>

    <!--
      Delivery last, and qualified. Before a domain is ready the records are the work, and
      a chart of fixtures above them would be the most confident thing on the page.
    -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Delivery</h2>
        <span class="text-xs text-ink/55">{{ DELIVERY_PERIOD }}</span>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Statistic
          v-for="figure in figures"
          :key="figure.id"
          :description="figure.description"
          :label="figure.label"
          :loading="store.loading"
          :value="figure.value"
          compact
        />
      </div>

      <v-card border flat>
        <div class="flex flex-col gap-1.5 border-b border-line p-4">
          <div class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-ink/80">Sent today</span>
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
            stays clean, and nothing in this panel raises it.
          </p>
        </div>

        <!-- The thresholds, with whose they are. A limit drawn as a meter over numbers
             nobody measured is a health check that has never run. -->
        <ul class="m-0 flex list-none flex-col divide-y divide-line p-0">
          <li
            v-for="limit in REPUTATION_LIMITS"
            :key="limit.id"
            class="grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-x-4 gap-y-1 px-4 py-3"
          >
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-xs leading-4 font-medium text-ink">{{ limit.label }}</span>
              <span class="text-[11px] leading-4 text-ink/55">{{ limit.source }}</span>
            </span>
            <span class="flex flex-col items-end gap-0.5 text-right">
              <span class="font-mono text-xs text-ink tabular-nums">
                {{ ratePercent(limit.limit) }}
              </span>
              <span class="text-[10px] leading-4 whitespace-nowrap text-ink/45">
                Review threshold
              </span>
            </span>
          </li>
        </ul>

        <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
          <template v-if="recorded">
            Rates are read over the period above, on this project's own mail.
          </template>
          <template v-else>
            This project's own rates are not measured yet: a bounce or a complaint reaches us
            as a provider event, and that pipeline is designed and not built.
            <NuxtLink
              class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/email/suppressions"
            >
              Blocked addresses
            </NuxtLink>
            says the same thing from the other end.
          </template>
        </p>
      </v-card>
    </section>

    <LayerCard
      v-model:open="expanded.rules"
      description="What we publish, what we check for, and the parts of this nobody configures."
      expandable
      title="What is checked, and what is not"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="`A domain of your own carries ${money(CUSTOM_DOMAIN_MONTHLY)} a month from the moment it is added, verified or not, and a lower rate per thousand on the mail it sends. The two lines cross at ${BREAK_EVEN_SENDS.toLocaleString('en')} mails a month, so below that it is the dearer option. Nobody should add one to save money: the reason to want one is that the From line carries your name.`"
          :fixed="`${money(CUSTOM_DOMAIN_MONTHLY)} a month`"
          label="What a domain of yours costs"
        />
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
          :description="`A new project starts with a low daily ceiling and it grows with a clean bounce rate. That protects the shared domain, whose reputation belongs to every project on it, and it is not a setting: nothing in this panel raises it and asking does not either.`"
          :fixed="`${stats.dailyCeiling.toLocaleString('en')} a day`"
          label="The daily ceiling"
        />
        <SettingRow label="What a bounce does">
          <template #description>
            A hard bounce or a spam complaint belongs on the project's block list, and a
            blocked address is refused before any transport runs rather than by policy. What
            writes that row is a provider event, and that pipeline is not built yet, so
            nothing reaches the list today and an address that bounced is still being sent
            to. <NuxtLink to="/email/suppressions">Blocked addresses</NuxtLink> carries the
            whole of that answer.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Not recording
            </span>
          </template>
        </SettingRow>
      </div>
    </LayerCard>

    <!-- Mounted only while open, like every dialog here that writes and then closes.
         A dialog left mounted across the write is painted after its own model says
         closed: see the note in CLAUDE.md. -->
    <SendingDomainAddDialog
      v-if="addOpen"
      v-model="addOpen"
      :busy="isBusy('add')"
      :existing="domains.map((domain) => domain.domain)"
      @confirm="confirmAdd"
    />

    <SendingDomainSenderDialog
      v-if="senderOpen"
      v-model="senderOpen"
      :busy="isBusy('sender')"
      :current="sending"
      :domains="domains"
      :error="senderError"
      :project-name="projects.current.name"
      :sends="stats.sent"
      @confirm="confirmSender"
    />

    <!-- The setup, capped on a desktop and a full-height sheet below `lg`. Mounted only
         while open, like every dialog here. -->
    <SendingDomainRecordsDialog
      v-if="sheetOpen"
      v-model="sheetOpen"
      :busy="openId !== null && isBusy(openId)"
      :domain="openDomain"
      @check="check"
      @remove="openId !== null && askRemoval(openId)"
      @use="askSender"
    />

    <SendingDomainRemoveDialog
      v-if="removeOpen && removeDomain"
      v-model="removeOpen"
      :busy="removeId !== null && isBusy(removeId)"
      :domain="removeDomain"
      @confirm="confirmRemoval"
    />
  </div>
</template>
