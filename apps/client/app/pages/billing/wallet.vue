<script setup lang="ts">
/**
 * What the organisation has to spend, what it is made of, what may add to it without
 * anybody pressing a button, and what happens when it runs out (notes/settings-billing.md:
 * balance and funding, then automatic funding and alerts).
 *
 * The balance is a band of facts rather than a card: what it is, split the way the reader
 * asks about it, with the sentence that explains each behind the glyph on its label. Then
 * the credit it is made of, in the order it is spent, because that is the question a single
 * figure cannot answer: how much of it expires, and when.
 *
 * The two automatic rules are adjacent and distinct rows, as the note asks. A top-up rule
 * charges the method it names, and the row says which, how much, and how often at this
 * month's rate; the alert says plainly that it is an alert and never a cap, because nothing
 * on this screen refuses anything on its own.
 *
 * What a zero balance does is folded, with the answer in the heading: sign-in keeps working.
 * That used to read "never stops", which was a promise rather than a description — see
 * risks.md 1 and `~/utils/billing`.
 */
import type { Fact } from "~/components/FactGrid.vue";
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  type AutoTopUp,
  autoTopUpPausedWords,
  CREDIT_KIND_LABELS,
  CREDIT_KIND_NOTES,
  CREDIT_KIND_TONES,
  cardLabel,
  drawOrder,
  EXPIRY_SOON_DAYS,
  expiryWords,
  formatCents,
  isGrantExpiringSoon,
  MIN_TOPUP_CENTS,
  PAYMENTS_UNAVAILABLE,
  runwayTone,
  runwayWords,
  type TopUpRequest,
  topUpEveryWords,
  ZERO_KEEPS_WORKING,
  ZERO_STOPS,
  type ZeroRule,
} from "~/utils/billing";
import { formatDate } from "~/utils/time";

const screen = useBillingScreen();
const route = useRouter().currentRoute;

/**
 * Where the provider's page sends the browser back to.
 *
 * Read once on arrival and then taken out of the URL, because a reload must not re-report
 * a charge that happened minutes ago. `replace` rather than `push` for the same reason
 * the audit screen replaces its view parameter: this is not a place in the history.
 *
 * Landing on the success URL is not proof the money moved — that is what the provider says
 * on a webhook — so the store reads the wallet again rather than declaring it confirmed.
 */
onMounted(() => {
  const outcome = route.value.query["checkout"];
  if (outcome !== "success" && outcome !== "cancel") return;
  store.settleCheckout(org.value.id, outcome);
  const { checkout: _consumed, ...rest } = route.value.query;
  void navigateTo({ path: route.value.path, query: rest }, { replace: true });
});
const {
  store,
  now,
  org,
  grants,
  wallet,
  methods,
  autoTopUp,
  autoStatus,
  alert,
  lastSaved,
  balance,
  owed,
  repair,
  defaultMethod,
  autoMethod,
  alertTripped,
  saving,
  isBusy,
} = screen;

/*
 * The balance, read across rather than down.
 */

/* Written out rather than interpolated, because Tailwind reads the source for class names
   and a built one is not in the bundle. */
const TONE_DOTS = { success: "bg-success", warning: "bg-warning", error: "bg-error" } as const;

const facts = computed<Fact[]>(() => [
  {
    key: "balance",
    label: "Balance",
    value: formatCents(wallet.value.totalCents),
    mono: true,
    note: repair.value ? `${formatCents(owed.value)} past due` : runwayWords(balance.value),
    dot: repair.value ? TONE_DOTS.error : TONE_DOTS[runwayTone(balance.value)],
    info: "Everything spendable, across every project this organisation holds. It is drawn down as the month runs, and the runway is how long it lasts at this month's projected rate.",
  },
  {
    key: "purchased",
    label: "Purchased",
    value: formatCents(wallet.value.purchasedCents),
    mono: true,
    note: "Spent after promotional",
    info: "Credit that was paid for. It is drawn on last, so nothing bought is spent while something that could expire is still there.",
  },
  {
    key: "promotional",
    label: "Promotional",
    value: formatCents(wallet.value.promotionalCents),
    mono: true,
    note: "Spent first",
    info: CREDIT_KIND_NOTES.promotional,
  },
  {
    key: "expiring",
    label: `Expiring within ${EXPIRY_SOON_DAYS} days`,
    value: formatCents(wallet.value.expiringSoonCents),
    mono: true,
    note: wallet.value.nextExpiryAt
      ? `Next on ${formatDate(wallet.value.nextExpiryAt)}`
      : "Nothing expires",
    info: "Promotional credit whose end is inside the fortnight. It is drawn down before anything purchased, so it is only lost if the month does not reach it.",
  },
]);

/*
 * The credit the balance is made of, in the order it is drawn down: promotional first and
 * soonest to expire first, so the list reads as the queue it is.
 */

const GRANT_COLUMNS: readonly RecordColumn[] = [
  { key: "note", label: "Source", width: "minmax(0, 1.4fr)" },
  { key: "kind", label: "Kind", width: "minmax(0, 0.9fr)" },
  { key: "remaining", label: "Remaining", width: "minmax(0, 0.9fr)", align: "end" },
  { key: "expires", label: "Expires", width: "minmax(0, 1fr)", align: "end" },
];

const spendQueue = computed(() => drawOrder(grants.value, now.value));

/*
 * The automatic rules, as sentences.
 */

const autoWords = computed(() => {
  const setting = autoTopUp.value;
  const status = autoStatus.value;
  /* A paused rule says why before anything else: it reads as protection while it is doing
     nothing, and the fix is always somebody's to make. */
  if (setting.enabled && status?.suspendedReason != null) {
    return autoTopUpPausedWords(status.suspendedReason);
  }
  if (setting.enabled && autoMethod.value) {
    const limit = status === null ? "" : ` At most ${status.dailyLimit} automatic charges a day.`;
    return `Adds ${formatCents(setting.amountCents)} when the balance falls under ${formatCents(setting.thresholdCents)}, charged to ${cardLabel(autoMethod.value).toLowerCase()}. ${topUpEveryWords(setting.amountCents, balance.value.projectedMonthCents)}${limit}`;
  }
  return `Would add ${formatCents(setting.amountCents)} when the balance falls under ${formatCents(setting.thresholdCents)}. Off, a balance that runs out stops SMS and leaves the rest owing.`;
});

const alertWords = computed(() =>
  alertTripped.value
    ? `This month has already passed ${formatCents(alert.value.thresholdCents)}. An alert and never a cap: nothing here refuses a sign-in, so the figure is a warning to act on rather than a ceiling that acts for you.`
    : `Emails the billing address when the month passes ${formatCents(alert.value.thresholdCents)}. An alert and never a cap: it tells you, and stops nothing on its own.`,
);

/*
 * Funding.
 */

const topUpOpen = ref(false);
const autoOpen = ref(false);
const alertOpen = ref(false);

async function confirmTopUp(request: TopUpRequest) {
  /* The dialog stays open on a refusal, with the reason: closing it would be the panel
     reporting a charge it did not make. */
  if (await screen.topUp(request)) topUpOpen.value = false;
}

async function confirmAuto(setting: AutoTopUp) {
  await screen.saveAutoTopUp(setting);
  autoOpen.value = false;
}

/* A dialog belongs to the organisation it was opened from. */
watch(
  () => org.value.id,
  () => {
    topUpOpen.value = false;
    autoOpen.value = false;
    alertOpen.value = false;
    screen.topUpIssue.value = "";
  },
);

/*
 * What a zero balance does, folded, with the answer in the heading.
 */

const zeroOpen = ref(false);

const ZERO_COLUMNS: readonly RecordColumn[] = [
  { key: "what", label: "What", width: "minmax(0, 1.2fr)" },
  { key: "outcome", label: "At zero", width: "minmax(0, 0.7fr)" },
  { key: "why", label: "Why", width: "minmax(0, 2fr)" },
];

interface ZeroRow extends ZeroRule {
  keeps: boolean;
}

const zeroRows: readonly ZeroRow[] = [
  ...ZERO_KEEPS_WORKING.map((rule) => ({ ...rule, keeps: true })),
  ...ZERO_STOPS.map((rule) => ({ ...rule, keeps: false })),
];

const ZERO_SUMMARY = "Sign-in keeps working · SMS stops · metered use above the free tier is owed";
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Wallet">
      <template #badge>
        <StatusBadge v-if="repair" :label="`${formatCents(owed)} past due`" tone="error" />
        <StatusBadge v-else :label="runwayWords(balance)" :tone="runwayTone(balance)" />
      </template>
      <template #description>
        What <span class="font-medium text-ink">{{ org.name }}</span> has to spend, what it is
        made of, and what may add to it without anybody pressing a button.
      </template>
      <template #actions>
        <BillingAddCredit @click="topUpOpen = true" />
      </template>
    </PageHeader>

    <!-- Said once, at the top, because it is true of every control below it. -->
    <InfoNote
      v-if="!store.running"
      :text="PAYMENTS_UNAVAILABLE"
      icon="material-symbols:warning-outline"
      tone="warning"
    />

    <FactGrid :columns="4" :facts="facts" label="Balance" />

    <!-- `divided` off because the fact band above is already a boundary. -->
    <PageSection
      :description="`${formatCents(wallet.totalCents)} spendable, listed in the order it is spent: promotional credit first, and the soonest to expire before the rest.`"
      :divided="false"
      title="Credit"
    >
      <InfoNote
        v-if="wallet.expiringSoonCents > 0"
        icon="material-symbols:schedule-outline"
        tone="warning"
      >
        {{ formatCents(wallet.expiringSoonCents) }} of promotional credit expires soon. It is
        drawn down before anything purchased, so it is only lost if the month does not reach it.
      </InfoNote>

      <RecordTable :columns="GRANT_COLUMNS" :loading="store.loading" framed label="Credit">
        <li v-for="grant in spendQueue" :key="grant.id" class="record-row">
          <span class="record-cell record-cell--primary">
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate font-medium text-ink">{{ grant.note }}</span>
              <span class="truncate text-[11px] text-ink/50">
                Granted {{ formatDate(grant.grantedAt) }}
              </span>
            </span>
          </span>
          <span class="record-cell record-cell--half" data-label="Kind">
            <v-tooltip :text="CREDIT_KIND_NOTES[grant.kind]" location="top" max-width="300">
              <template #activator="{ props: tip }">
                <span v-bind="tip">
                  <Tag
                    :label="CREDIT_KIND_LABELS[grant.kind]"
                    :tone="CREDIT_KIND_TONES[grant.kind]"
                  />
                </span>
              </template>
            </v-tooltip>
          </span>
          <span class="record-cell record-cell--end record-cell--half" data-label="Remaining">
            <span class="flex flex-col items-end gap-0.5">
              <span class="font-mono text-ink tabular-nums">
                {{ formatCents(grant.remainingCents) }}
              </span>
              <span class="text-[11px] text-ink/45">of {{ formatCents(grant.amountCents) }}</span>
            </span>
          </span>
          <span class="record-cell record-cell--end" data-label="Expires">
            <span
              :class="isGrantExpiringSoon(grant, now) ? 'text-warning' : 'text-ink/60'"
              class="text-xs"
            >
              {{ expiryWords(grant, now) }}
            </span>
          </span>
        </li>

        <template v-if="spendQueue.length === 0" #empty>
          <EmptyState
            description="Credit appears here when it is bought or granted. A balance of nothing does not stop a sign-in: what it stops is SMS, and anything metered above the free tier is owed rather than refused."
            icon="material-symbols:account-balance-wallet-outline"
            title="No credit on the account"
          />
        </template>
      </RecordTable>
    </PageSection>

    <!-- What may charge the wallet unattended, and when the billing address is told. -->
    <PageSection
      description="What may charge the wallet without anybody pressing a button, and when the billing address is told. An automatic top-up charges the method its rule names, or the default when it names none."
      title="Automatic funding and alerts"
    >
      <div class="divide-y divide-line">
        <SettingRow :description="autoWords" label="Top up automatically">
          <div class="flex items-center gap-2">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:tune"
              size="small"
              variant="text"
              @click="autoOpen = true"
            >
              Configure
            </v-btn>
            <v-switch
              :disabled="methods.length === 0 || isBusy('auto')"
              :loading="isBusy('auto')"
              :model-value="autoTopUp.enabled"
              aria-label="Top up automatically"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="screen.setAutoEnabled($event === true)"
            />
          </div>
        </SettingRow>

        <SettingRow :description="alertWords" label="Spend alert">
          <div class="flex items-center gap-2">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="text"
              @click="alertOpen = true"
            >
              <span class="font-mono">{{ formatCents(alert.thresholdCents) }}</span>
            </v-btn>
            <v-switch
              :disabled="isBusy('alert')"
              :loading="isBusy('alert')"
              :model-value="alert.enabled"
              aria-label="Spend alert"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="screen.setAlertEnabled($event === true)"
            />
          </div>
        </SettingRow>
      </div>
    </PageSection>

    <!-- The question everybody asks about a prepaid balance. The heading carries the
         answer while shut; the rows carry the reasons. -->
    <PageSection
      v-model:open="zeroOpen"
      :summary="ZERO_SUMMARY"
      description="A balance at zero does not stop a sign-in. What it stops is the traffic that costs money the moment it leaves, and what it does not stop is owed rather than refused."
      foldable
      title="What happens at zero"
    >
      <RecordTable :columns="ZERO_COLUMNS" framed label="What a zero balance does">
        <li v-for="rule in zeroRows" :key="rule.what" class="record-row">
          <span class="record-cell record-cell--primary">
            <span class="flex min-w-0 items-center gap-2">
              <Icon
                :class="rule.keeps ? 'text-success' : 'text-warning'"
                :name="
                  rule.keeps
                    ? 'material-symbols:check-circle-outline'
                    : 'material-symbols:pause-circle-outline'
                "
                aria-hidden="true"
                class="flex-none text-base"
              />
              <span class="font-medium text-ink">{{ rule.what }}</span>
            </span>
          </span>
          <span class="record-cell record-cell--half" data-label="At zero">
            <Tag
              :label="rule.keeps ? 'Keeps working' : 'Stops or accrues'"
              :tone="rule.keeps ? 'success' : 'warning'"
            />
          </span>
          <span class="record-cell" data-label="Why">
            <span class="text-xs leading-5 text-ink/60">{{ rule.why }}</span>
          </span>
        </li>
      </RecordTable>

      <InfoNote>
        The first 50,000 monthly active users are free on every project and no security feature
        sits behind a tier: passkeys, multi-factor, custom domains and the audit trail cost
        nothing at any volume. The smallest top-up is {{ formatCents(MIN_TOPUP_CENTS) }}. Prices
        are the published ones in PROJECT.md 5.1 rather than a contract, and a plan somebody
        signed wins over anything on this page.
      </InfoNote>
    </PageSection>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <!-- `v-if` on the flag rather than left mounted: a Vuetify dialog that closes in the
         same flush as a store write leaves its teleported content on the page with its own
         model already false, and the only way out is a reload. -->
    <BillingTopUpDialog
      v-if="topUpOpen"
      v-model="topUpOpen"
      :balance="balance"
      :busy="isBusy('topup')"
      :issue="screen.topUpIssue.value"
      :methods="methods"
      :state="store.checkoutFor(org.id)"
      @add-method="screen.openPortal()"
      @confirm="confirmTopUp"
    />

    <BillingAutoTopUpDialog
      v-if="autoOpen"
      v-model="autoOpen"
      :balance-cents="balance.cents"
      :busy="isBusy('auto')"
      :default-method="defaultMethod"
      :methods="methods"
      :projected-month-cents="balance.projectedMonthCents"
      :setting="autoTopUp"
      @add-method="screen.openPortal()"
      @confirm="confirmAuto"
    />

    <NumberDialog
      v-if="alertOpen"
      v-model="alertOpen"
      :current="Math.round(alert.thresholdCents / 100)"
      :max="1_000_000"
      :min="1"
      confirm-label="Save the figure"
      description="An email to the billing address when the organisation's charges pass this in a month. It is an alert and never a cap: it tells you, and stops nothing on its own."
      integer-label="A whole number of dollars."
      label="Tell me above"
      prefix-hint=""
      range-label="Between $1 and $1,000,000."
      suffix="USD"
      title="Spend alert"
      @confirm="screen.setAlertThreshold($event)"
    />
  </div>
</template>
