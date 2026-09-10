<script setup lang="ts">
/**
 * The security centre (PROJECT.md 3.2, 4.9): what the project's detectors have seen, what
 * happens when one of them fires, and the defences nobody configures.
 *
 * The screen is built around one distinction and everything on it follows from that. A
 * signal is evidence and not a verdict. A password in a public corpus is a password
 * somebody else also chose; two sign-ins far apart in space and close in time are a laptop
 * and a phone on a VPN far more often than they are a theft. So the list ranks by how soon
 * to look rather than by how bad it is, no control here changes an account on its own, and
 * the one real action offered is signing sessions out, which costs the owner one sign-in
 * and costs a thief the account. Suspending is not offered: a suspension is a decision
 * about a person, it belongs on the screen that lists people, and taking it from a row
 * that says "this password is also somebody else's" is exactly the reading this screen
 * exists to argue against.
 *
 * Two of the six kinds are not evidence, and saying so is half of what the list is for.
 * A refresh token presented twice revoked its whole family before the row existed
 * (ADR-0007), and a pumping pattern was refused before it cost anything. Those rows are
 * records of something finished, not questions for the reader.
 *
 * Nothing here renders anything for an end user. A step-up is the sign-in answering with a
 * challenge for the customer's own screen to complete (ADR-0010) and a notice is an email
 * we send on their behalf, because we ship no UI (ADR-0002). A rule that read as "show a
 * warning page" would have a customer ship nothing at all.
 *
 * Two things this screen deliberately does not own. The SMS spend cap lives in
 * `sms_policies` and on its own screen; what is here is today's spend against it and a
 * link, because a cap being reached is an attack signal and an operator on a review needs
 * to see it without a second place to edit it. And the breach check cannot be run over the
 * accounts a project already has: passwords are Argon2id under a KMS pepper, so there is
 * nothing to sweep, and "scan my users" is impossible by construction rather than unbuilt.
 */

import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { BadgeTone } from "~/components/StatusBadge.vue";
import type { ColumnState, DataTableColumn, DataTableSort } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import { type TimeWindow, WINDOW_LABELS } from "~/utils/filters";
import type { MetricSeries, MetricTone } from "~/utils/metric-chart";
import {
  BREACH_CHECK,
  countSignals,
  type DetectorId,
  DISMISS_REASON_LABELS,
  type DismissReason,
  INDISTINGUISHABLE,
  inWindow,
  KIND_LABELS,
  KIND_NOTES,
  kindOf,
  REFUSAL_LABELS,
  REFUSAL_REASONS,
  RESPONSE_LABELS,
  RESPONSE_NOTES,
  SECURITY_ISSUE,
  SEVERITY_LABELS,
  SEVERITY_NOTES,
  SEVERITY_RANK,
  type SecuritySignal,
  type Severity,
  SIGNAL_RESPONSES,
  SIGNAL_RETENTION_MAX,
  SIGNAL_RETENTION_MIN,
  SIGNAL_STATE_LABELS,
  type SignalFilter,
  type SignalResponse,
  type SignalState,
  STUFFING_LIST_ACCOUNTS,
  STUFFING_REFUSALS_MAX,
  STUFFING_REFUSALS_MIN,
  severityOf,
  signalsCsv,
  signalsExportName,
  TRAVEL_SPEED_MAX,
  TRAVEL_SPEED_MIN,
  tallyKinds,
} from "~/utils/security";
import { capShare, formatMoney } from "~/utils/sms-policy";
import { formatDateTime, relativeTime } from "~/utils/time";
import { nameOf, type ProjectUser } from "~/utils/users";

const projects = useProjectStore();
const store = useSecurityStore();
const users = useUsersStore();
const sms = useSmsPolicyStore();
const { copy } = useClipboard({ legacy: true });

/* A window counted back from now has to move, or "last 24 hours" quietly stops meaning it. */
const now = useNow({ interval: 30_000 });

const settings = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));

/** A signal and the person it names, which is the only shape the list reads. */
interface SignalRow {
  id: string;
  signal: SecuritySignal;
  /** Null where the evidence names an address rather than an account. */
  user: ProjectUser | null;
  severity: Severity;
}

const byId = computed(
  () => new Map(users.forProject(projects.current.id).map((user) => [user.id, user])),
);

/*
 * The window. It narrows the list, the counts on the segments and the panel beside them
 * together, so a segment never offers to show rows the window has taken away.
 */
const WINDOWS: readonly TimeWindow[] = ["24h", "7d", "30d", "any"];

const windowChoice = ref<TimeWindow>("30d");

const windowOptions = computed<SegmentedOption[]>(() =>
  WINDOWS.map((window) => ({
    value: window,
    label: window === "any" ? "All" : window,
    title: WINDOW_LABELS[window],
  })),
);

const windowTab = computed({
  get: () => windowChoice.value as string,
  set: (value: string) => {
    if ((WINDOWS as readonly string[]).includes(value)) windowChoice.value = value as TimeWindow;
  },
});

const rows = computed<SignalRow[]>(() =>
  store
    .signalsFor(projects.current.id)
    .filter((signal) => inWindow(signal, windowChoice.value, now.value))
    .map((signal) => ({
      id: signal.id,
      signal,
      user: signal.userId === null ? null : (byId.value.get(signal.userId) ?? null),
      severity: severityOf(signal.evidence),
    })),
);

const counts = computed(() => countSignals(rows.value.map((row) => row.signal)));

/*
 * Which signals the list shows. It opens on the ones nobody has decided about, because
 * that is the only segment with anything to do on it.
 */
const filter = ref<SignalFilter>("open");

const FILTERS: readonly SignalFilter[] = ["open", "acknowledged", "dismissed", "all"];

const filterTab = computed({
  get: () => filter.value as string,
  set: (value: string) => {
    if ((FILTERS as readonly string[]).includes(value)) filter.value = value as SignalFilter;
  },
});

const filterOptions = computed<SegmentedOption[]>(() => [
  { value: "open", label: `Open · ${counts.value.open}` },
  { value: "acknowledged", label: `Acknowledged · ${counts.value.acknowledged}` },
  { value: "dismissed", label: `Dismissed · ${counts.value.dismissed}` },
  { value: "all", label: `All · ${counts.value.all}` },
]);

const filtered = computed(() =>
  rows.value.filter((row) => filter.value === "all" || row.signal.state === filter.value),
);

const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  act: "error",
  review: "warning",
  record: "neutral",
};

const STATE_TONES: Record<SignalState, BadgeTone> = {
  open: "neutral",
  acknowledged: "success",
  dismissed: "neutral",
};

/** For sorting the state column: undecided first, which is the order to work through. */
const STATE_RANK: Record<SignalState, number> = { open: 0, acknowledged: 1, dismissed: 2 };

const COLUMNS: readonly DataTableColumn<SignalRow>[] = [
  {
    key: "signal",
    title: "Signal",
    fixed: true,
    minWidth: 340,
    skeleton: "identity",
    value: (row) => KIND_LABELS[kindOf(row.signal)],
  },
  {
    key: "severity",
    title: "Priority",
    width: 116,
    skeleton: "pill",
    value: (row) => SEVERITY_RANK[row.severity],
  },
  {
    key: "account",
    title: "Account",
    width: 224,
    skeleton: "identity",
    value: (row) => (row.user === null ? "" : nameOf(row.user).toLowerCase()),
  },
  {
    key: "seenAt",
    title: "Seen",
    mono: true,
    width: 118,
    value: (row) => row.signal.seenAt,
  },
  {
    key: "state",
    title: "State",
    width: 168,
    skeleton: "pill",
    value: (row) => STATE_RANK[row.signal.state],
  },
];

const stored = useLocalStorage<ColumnState>("idenzy.security.columns", defaultColumnState(COLUMNS));
const columnState = computed<ColumnState>({
  get: () => reconcileColumnState(COLUMNS, stored.value),
  set: (value) => {
    stored.value = value;
  },
});

/* Urgent first, then newest, which is the order somebody works down the list in. */
const sortBy = ref<DataTableSort[]>([
  { key: "severity", order: "asc" },
  { key: "seenAt", order: "desc" },
]);
const page = ref(1);
const pageSize = useLocalStorage("idenzy.security.page-size", 10);

/* Which cards start unfolded. The list is what a visit is for, so the rules below it stay
   folded until somebody has come to change one. */
const expanded = reactive({ rules: false, always: false, never: false });

/*
 * Saving. Every rule writes itself, like the other settings screens, and a decision about
 * a signal goes through the same busy set so one row can show its own wait.
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

function setEnabled(id: DetectorId, enabled: boolean) {
  void whileBusy(id, () => store.patchRule(projects.current.id, id, { enabled }));
}

function setResponse(id: DetectorId, response: SignalResponse) {
  if (settings.value.rules[id].response === response) return;
  void whileBusy(id, () => store.patchRule(projects.current.id, id, { response }));
}

/*
 * The three numbers, each through a dialog, so a figure on its way to three digits is
 * never written and the bounds are checked before anything is sent.
 */
const travelDialog = ref(false);
const stuffingDialog = ref(false);
const retentionDialog = ref(false);

function confirmTravel(value: number) {
  if (value === settings.value.travelSpeedKmh) return;
  void whileBusy("travel", () => store.patch(projects.current.id, { travelSpeedKmh: value }));
}

function confirmStuffing(value: number) {
  if (value === settings.value.stuffingRefusals) return;
  void whileBusy("stuffing", () => store.patch(projects.current.id, { stuffingRefusals: value }));
}

function confirmRetention(value: number) {
  if (value === settings.value.retentionDays) return;
  void whileBusy("retention", () => store.patch(projects.current.id, { retentionDays: value }));
}

/*
 * Deciding about a row.
 */

function decide(row: SignalRow, state: SignalState, reason: DismissReason | null = null) {
  void whileBusy(row.id, () => store.decide(projects.current.id, row.id, state, reason));
}

/* The signal being dismissed, held here rather than passed down, so the dialog keeps its
   subject while it closes. */
const dismissing = ref<SignalRow | null>(null);
const dismissDialog = ref(false);

function askDismiss(row: SignalRow) {
  dismissing.value = row;
  dismissDialog.value = true;
}

/* Read here rather than in the template, so the dialog's props narrow properly and the
   subject survives the frame in which the dialog is closing. */
const dismissingSignal = computed(() => dismissing.value?.signal ?? null);
const dismissingPerson = computed(() =>
  dismissing.value?.user ? nameOf(dismissing.value.user) : null,
);
const dismissingBusy = computed(() => dismissing.value !== null && isBusy(dismissing.value.id));

function confirmDismiss(reason: DismissReason) {
  const row = dismissing.value;
  if (row === null) return;
  decide(row, "dismissed", reason);
}

/**
 * Signs every session on the account out, through the same store action the users screen
 * uses. One action, one place: a second implementation here would be a second thing to
 * keep in step with what a revoke actually does.
 */
function signOut(row: SignalRow) {
  const user = row.user;
  if (user === null) return;
  users.signOutEverywhere([user.id]);
}

function copyText(value: string) {
  void copy(value);
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    dismissDialog.value = false;
    dismissing.value = null;
    page.value = 1;
  },
);

watch([filter, windowChoice], () => {
  page.value = 1;
});

/*
 * The attack dashboard.
 *
 * Refusals rather than signals, and counted separately from them. Almost every refused
 * sign-in is somebody who typed their password wrong, so a chart built by counting signal
 * rows would report a project with good detectors as a project under attack.
 */
const REFUSAL_RANGES: readonly SegmentedOption[] = [
  { value: "7", label: "7d", title: "The last 7 days" },
  { value: "14", label: "14d", title: "The last 14 days" },
];

const refusalRange = ref("7");
const refusalDays = computed(() => Number(refusalRange.value));

const DAY_LABEL = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });
const DAY_TITLE = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long" });

const refusals = computed(() => {
  const daily = store.refusals(projects.current.id);
  const span = refusalDays.value;

  const days = Array.from({ length: span }, (_, index) => {
    const at = new Date(now.value);
    at.setHours(0, 0, 0, 0);
    at.setDate(at.getDate() - (span - 1 - index));
    return at;
  });

  const series: MetricSeries[] = REFUSAL_REASONS.map((reason, index) => ({
    name: REFUSAL_LABELS[reason],
    data: daily[reason].slice(-span),
    tone: (index + 1) as MetricTone,
    stack: "refusal",
  }));

  /* Negative offsets, so the window is the last `span` days and the comparison is the
     `span` before it, whatever the placeholder's own length happens to be. */
  const total = (from: number, to?: number) =>
    REFUSAL_REASONS.reduce(
      (sum, reason) => sum + daily[reason].slice(from, to).reduce((a, b) => a + b, 0),
      0,
    );

  return {
    categories: days.map((at) => DAY_LABEL.format(at)),
    titles: days.map((at) => DAY_TITLE.format(at)),
    series,
    value: total(-span),
    previous: total(-span * 2, -span),
  };
});

/*
 * The figures beside the list.
 */
const kindTally = computed(() => tallyKinds(rows.value.map((row) => row.signal)));

const policy = computed(() => sms.policyFor(projects.current.id));
const spentToday = computed(() => sms.spentToday(projects.current.id));
const capUsed = computed(() =>
  policy.value === null
    ? 0
    : Math.round(capShare(spentToday.value, policy.value.dailySpendCap) * 100),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const indistinguishable = computed(() =>
  INDISTINGUISHABLE.map((reason) => REFUSAL_LABELS[reason].toLowerCase()).join(" and "),
);

function exportCsv() {
  const blob = new Blob([signalsCsv(filtered.value.map((row) => row.signal))], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = signalsExportName(projects.current.id, now.value);
  link.click();
  URL.revokeObjectURL(url);
}

const GUIDES_URL = "https://idenzy.dev/docs/security";

const GUIDES = [
  {
    icon: "material-symbols:security",
    title: "What each signal proves",
    detail: "The six detectors, and the innocent explanation for each of them.",
    href: `${GUIDES_URL}/signals`,
  },
  {
    icon: "material-symbols:timer-outline",
    title: "Answering a step-up challenge",
    detail: "The reply your sign-in gets instead of a session, and what to render.",
    href: "https://idenzy.dev/docs/mfa/step-up",
  },
  {
    icon: "material-symbols:key-outline",
    title: "The breached-password check",
    detail: "k-anonymity, what leaves your project, and why existing accounts cannot be swept.",
    href: `${GUIDES_URL}/breached-passwords`,
  },
  {
    icon: "material-symbols:webhook",
    title: "Signals over webhooks",
    detail: "Taking these into your own tooling instead of reading them here.",
    href: "https://idenzy.dev/docs/webhooks",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:security" title="Security center">
      <template #description>
        What the detectors on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> have seen, and
        what happens when one of them fires. Every row is evidence: nothing here decides an
        account was taken, and nothing here acts on one by itself.
      </template>
      <template #actions>
        <v-btn
          :disabled="filtered.length === 0"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:download"
          size="small"
          variant="outlined"
          @click="exportCsv"
        >
          Export view
        </v-btn>
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
          Security guides
        </v-btn>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          :padded="false"
          description="Ranked by how soon to look, never by how bad it is. A row is what a detector saw, and the numbers behind it are on the row."
          title="Signals"
        >
          <template #badge>
            <StatusBadge
              :label="
                counts.urgent === 0
                  ? 'Nothing urgent open'
                  : `${counts.urgent} to act on`
              "
              :tone="counts.urgent === 0 ? 'success' : 'error'"
            />
          </template>
          <template #actions>
            <SegmentedControl v-model="windowTab" :options="windowOptions" label="Window" />
          </template>

          <div
            class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <SegmentedControl v-model="filterTab" :options="filterOptions" label="Signals" />
            <DataTableColumnsMenu v-model="columnState" :columns="COLUMNS" />
          </div>

          <DataTable
            v-model:column-state="columnState"
            v-model:items-per-page="pageSize"
            v-model:page="page"
            v-model:sort-by="sortBy"
            :columns="COLUMNS"
            :items="filtered"
            :loading="store.loading"
            label="Security signals"
          >
            <template #cell.signal="{ item }">
              <SignalIdentity :signal="item.signal" />
            </template>

            <template #cell.severity="{ item }">
              <v-tooltip :text="SEVERITY_NOTES[item.severity]" location="top" max-width="280">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="inline-flex">
                    <StatusBadge
                      :label="SEVERITY_LABELS[item.severity]"
                      :tone="SEVERITY_TONES[item.severity]"
                    />
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.account="{ item }">
              <UserIdentity v-if="item.user" :user="item.user" />
              <!-- A list being tried against forty addresses is about the address doing the
                   trying, so the cell says so rather than showing an empty column that
                   reads as a row somebody failed to join. -->
              <span v-else class="text-xs text-ink/45">No one account</span>
            </template>

            <template #cell.seenAt="{ item }">
              <v-tooltip :text="formatDateTime(item.signal.seenAt)" location="top">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="font-mono text-ink/80 tabular-nums">
                    {{ relativeTime(item.signal.seenAt, now) }}
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #cell.state="{ item }">
              <v-tooltip
                :disabled="item.signal.decidedAt === null"
                :text="`${item.signal.decidedBy} · ${item.signal.decidedAt ? formatDateTime(item.signal.decidedAt) : ''}`"
                location="top"
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="inline-flex max-w-full">
                    <StatusBadge
                      :detail="
                        item.signal.reason ? DISMISS_REASON_LABELS[item.signal.reason] : ''
                      "
                      :label="SIGNAL_STATE_LABELS[item.signal.state]"
                      :tone="STATE_TONES[item.signal.state]"
                    />
                  </span>
                </template>
              </v-tooltip>
            </template>

            <template #actions="{ item }">
              <SignalRowActions
                :person="item.user ? nameOf(item.user) : null"
                :sessions="item.user?.activeSessions ?? 0"
                :signal="item.signal"
                @acknowledge="decide(item, 'acknowledged')"
                @copy-id="copyText(item.signal.id)"
                @copy-user="item.signal.userId && copyText(item.signal.userId)"
                @dismiss="askDismiss(item)"
                @reopen="decide(item, 'open')"
                @sign-out="signOut(item)"
              />
            </template>

            <template #empty>
              <div class="flex flex-col items-center gap-1 px-4 py-14 text-center">
                <Icon
                  :class="filter === 'open' ? 'text-success/70' : 'text-ink/25'"
                  :name="
                    filter === 'open'
                      ? 'material-symbols:check-circle-outline'
                      : 'material-symbols:shield-lock-outline'
                  "
                  aria-hidden="true"
                  class="mb-1 text-2xl"
                />
                <p class="m-0 text-sm font-medium text-ink">
                  {{
                    filter === "open"
                      ? "Nothing waiting on you"
                      : filter === "acknowledged"
                        ? "Nothing acknowledged in this window"
                        : filter === "dismissed"
                          ? "Nothing dismissed in this window"
                          : "No signal in this window"
                  }}
                </p>
                <p class="m-0 max-w-sm text-xs text-ink/55">
                  {{
                    filter === "open"
                      ? "Every signal in this window has been read. A quiet list is the normal state of this screen, not a detector that is switched off."
                      : "Widen the window, or move to another segment. Nothing has been lost: a signal is kept for the project's retention whatever is decided about it."
                  }}
                </p>
              </div>
            </template>
          </DataTable>

          <div
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[10px] leading-4 text-ink/45"
          >
            <p class="m-0">
              A signal outlives the session it came from, so a review next month still finds
              the evidence. Kept
              {{ settings.retentionDays }} days on this project.
            </p>
            <p class="m-0">Every decision here is written to the audit log.</p>
          </div>
        </LayerCard>

        <MetricCard
          :categories="refusals.categories"
          :compare="`vs previous ${refusalDays} days`"
          :previous="refusals.previous"
          :series="refusals.series"
          :titles="refusals.titles"
          :value="refusals.value"
          category-label="Day"
          description="Sign-ins we refused, by the reason we refused them. Most of this is people mistyping, and the shape is what says otherwise."
          positive="down"
          title="Refused sign-ins"
          type="bar"
        >
          <template #actions>
            <SegmentedControl v-model="refusalRange" :options="REFUSAL_RANGES" label="Period" />
          </template>
        </MetricCard>

        <p
          class="m-0 -mt-3 flex items-start gap-2 px-1 text-[11px] leading-4 text-ink/50"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm"
            name="material-symbols:info-outline"
          />
          <span>
            The split between {{ indistinguishable }} is ours from the inside only. A caller
            gets one answer for both and both cost the same Argon2 work, so nothing on this
            chart is visible to somebody guessing at your accounts.
          </span>
        </p>

        <LayerCard
          v-model:open="expanded.rules"
          expandable
          description="Four detectors your project decides about, and what a sign-in does when one of them fires. The other two are not rules: reuse and pumping are already refused before a row exists."
          title="What fires a signal"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :description="`A new password is checked against ${BREACH_CHECK.corpus} at ${BREACH_CHECK.always}, by k-anonymity: ${BREACH_CHECK.prefixLength} characters of its ${BREACH_CHECK.algorithm} digest leave your project and the rest is compared here. If the corpus is unreachable the password is allowed and the gap is logged, because a breach check is a warning and not a gate.`"
              fixed="Always"
              label="Checked at sign-up and reset"
            />

            <SettingRow
              :description="KIND_NOTES.breached_password"
              label="Breached password at sign-in"
            >
              <template #actions>
                <v-menu v-if="settings.rules.breached_password.enabled" :offset="4" location="bottom end">
                  <template #activator="{ props: activator }">
                    <v-btn
                      v-bind="activator"
                      :loading="isBusy('breached_password')"
                      class="text-xs font-medium"
                      color="neutral"
                      size="small"
                      variant="text"
                    >
                      {{ RESPONSE_LABELS[settings.rules.breached_password.response] }}
                      <Icon
                        aria-hidden="true"
                        class="ml-1 text-base"
                        name="material-symbols:keyboard-arrow-down"
                      />
                    </v-btn>
                  </template>
                  <v-list density="compact" max-width="360" nav>
                    <v-list-item
                      v-for="response in SIGNAL_RESPONSES"
                      :key="response"
                      :active="settings.rules.breached_password.response === response"
                      :subtitle="RESPONSE_NOTES[response]"
                      :title="RESPONSE_LABELS[response]"
                      @click="setResponse('breached_password', response)"
                    />
                  </v-list>
                </v-menu>
              </template>
              <v-switch
                :disabled="isBusy('breached_password')"
                :loading="isBusy('breached_password')"
                :model-value="settings.rules.breached_password.enabled"
                aria-label="Breached password at sign-in"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled('breached_password', $event === true)"
              />
            </SettingRow>

            <SettingRow
              :description="KIND_NOTES.impossible_travel"
              label="Impossible travel"
            >
              <template #actions>
                <v-menu v-if="settings.rules.impossible_travel.enabled" :offset="4" location="bottom end">
                  <template #activator="{ props: activator }">
                    <v-btn
                      v-bind="activator"
                      :loading="isBusy('impossible_travel')"
                      class="text-xs font-medium"
                      color="neutral"
                      size="small"
                      variant="text"
                    >
                      {{ RESPONSE_LABELS[settings.rules.impossible_travel.response] }}
                      <Icon
                        aria-hidden="true"
                        class="ml-1 text-base"
                        name="material-symbols:keyboard-arrow-down"
                      />
                    </v-btn>
                  </template>
                  <v-list density="compact" max-width="360" nav>
                    <v-list-item
                      v-for="response in SIGNAL_RESPONSES"
                      :key="response"
                      :active="settings.rules.impossible_travel.response === response"
                      :subtitle="RESPONSE_NOTES[response]"
                      :title="RESPONSE_LABELS[response]"
                      @click="setResponse('impossible_travel', response)"
                    />
                  </v-list>
                </v-menu>
              </template>
              <v-switch
                :disabled="isBusy('impossible_travel')"
                :loading="isBusy('impossible_travel')"
                :model-value="settings.rules.impossible_travel.enabled"
                aria-label="Impossible travel"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled('impossible_travel', $event === true)"
              />
            </SettingRow>

            <SettingRow
              :disabled="!settings.rules.impossible_travel.enabled"
              description="The speed a hop would have needed before it is called impossible. The default sits above commercial cruise, so a real flight and an hour in an airport never fire it."
              label="Called impossible above"
            >
              <template #actions>
                <span class="font-mono text-xs text-ink/60">
                  {{ settings.travelSpeedKmh }} km/h
                </span>
                <v-btn
                  :disabled="!settings.rules.impossible_travel.enabled"
                  :loading="isBusy('travel')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="travelDialog = true"
                >
                  Change
                </v-btn>
              </template>
            </SettingRow>

            <SettingRow
              description="A hop through a VPN, a proxy or a Tor exit is never counted, because the country on those is where the address resolves and not where the person is. Half the office laptops on the internet would fire this every morning, and a detector that fires every morning is one nobody reads."
              fixed="Always"
              label="Network hops ignored"
            />

            <SettingRow :description="KIND_NOTES.new_country" label="New country">
              <template #actions>
                <v-menu v-if="settings.rules.new_country.enabled" :offset="4" location="bottom end">
                  <template #activator="{ props: activator }">
                    <v-btn
                      v-bind="activator"
                      :loading="isBusy('new_country')"
                      class="text-xs font-medium"
                      color="neutral"
                      size="small"
                      variant="text"
                    >
                      {{ RESPONSE_LABELS[settings.rules.new_country.response] }}
                      <Icon
                        aria-hidden="true"
                        class="ml-1 text-base"
                        name="material-symbols:keyboard-arrow-down"
                      />
                    </v-btn>
                  </template>
                  <v-list density="compact" max-width="360" nav>
                    <v-list-item
                      v-for="response in SIGNAL_RESPONSES"
                      :key="response"
                      :active="settings.rules.new_country.response === response"
                      :subtitle="RESPONSE_NOTES[response]"
                      :title="RESPONSE_LABELS[response]"
                      @click="setResponse('new_country', response)"
                    />
                  </v-list>
                </v-menu>
              </template>
              <v-switch
                :disabled="isBusy('new_country')"
                :loading="isBusy('new_country')"
                :model-value="settings.rules.new_country.enabled"
                aria-label="New country"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled('new_country', $event === true)"
              />
            </SettingRow>

            <SettingRow
              :description="KIND_NOTES.credential_stuffing"
              label="Guessing at accounts"
            >
              <template #actions>
                <v-menu v-if="settings.rules.credential_stuffing.enabled" :offset="4" location="bottom end">
                  <template #activator="{ props: activator }">
                    <v-btn
                      v-bind="activator"
                      :loading="isBusy('credential_stuffing')"
                      class="text-xs font-medium"
                      color="neutral"
                      size="small"
                      variant="text"
                    >
                      {{ RESPONSE_LABELS[settings.rules.credential_stuffing.response] }}
                      <Icon
                        aria-hidden="true"
                        class="ml-1 text-base"
                        name="material-symbols:keyboard-arrow-down"
                      />
                    </v-btn>
                  </template>
                  <v-list density="compact" max-width="360" nav>
                    <v-list-item
                      v-for="response in SIGNAL_RESPONSES"
                      :key="response"
                      :active="settings.rules.credential_stuffing.response === response"
                      :subtitle="RESPONSE_NOTES[response]"
                      :title="RESPONSE_LABELS[response]"
                      @click="setResponse('credential_stuffing', response)"
                    />
                  </v-list>
                </v-menu>
              </template>
              <v-switch
                :disabled="isBusy('credential_stuffing')"
                :loading="isBusy('credential_stuffing')"
                :model-value="settings.rules.credential_stuffing.enabled"
                aria-label="Guessing at accounts"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled('credential_stuffing', $event === true)"
              />
            </SettingRow>

            <SettingRow
              :description="`Refusals from one address, across accounts, inside an hour. Above ${STUFFING_LIST_ACCOUNTS} accounts the row turns urgent on its own, because at that width it is a list being worked through rather than somebody's bad morning.`"
              :disabled="!settings.rules.credential_stuffing.enabled"
              label="Reads as a list at"
            >
              <template #actions>
                <span class="font-mono text-xs text-ink/60">
                  {{ settings.stuffingRefusals }} refusals
                </span>
                <v-btn
                  :disabled="!settings.rules.credential_stuffing.enabled"
                  :loading="isBusy('stuffing')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="stuffingDialog = true"
                >
                  Change
                </v-btn>
              </template>
            </SettingRow>

            <SettingRow
              description="How long a signal is kept after it is seen, whatever is decided about it. It is counted from the signal and not from the session behind it, because the session is gone long before the review that wants the evidence."
              label="Signals kept for"
            >
              <template #actions>
                <span class="font-mono text-xs text-ink/60">{{ settings.retentionDays }} days</span>
                <v-btn
                  :loading="isBusy('retention')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="retentionDialog = true"
                >
                  Change
                </v-btn>
              </template>
            </SettingRow>
          </div>

          <SamplePanel
            class="mt-5"
            note="A step-up is a reply, never a screen. Your own code renders the challenge, the same way it renders your sign-in form."
            title="What your application receives"
          >
            <div class="flex flex-col gap-1">
              <SampleLine name="status" value='"challenge"' />
              <SampleLine name="reason" value='"impossible_travel"' />
              <SampleLine name="factors" value='["totp", "passkey"]' />
              <SampleLine icon="material-symbols:info-outline" tone="muted">
                An account with nothing enrolled is signed in instead. A challenge nobody can
                answer is a sign-in that cannot be completed, not one that was refused.
              </SampleLine>
            </div>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.always"
          expandable
          description="The defences under every project on the deployment. None of them is a setting, and each row says why not."
          title="What runs whatever you set"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Cloud Armor at the edge with the OWASP rule set, rate limits per address and per project, and adaptive protection for a layer-seven flood. It refuses before a request reaches an application, which is the only place a flood can be refused cheaply."
              fixed="Always"
              label="Edge rate limits and WAF"
            />
            <SettingRow
              description="Per identifier, per address, per project and per endpoint, in Valkey, with exponential backoff. Sign-in fails open when the store is unreachable, so an outage is not a lockout; the SMS path fails closed for the opposite reason, because there the cost of allowing what we could not count is an invoice."
              fixed="Always"
              label="Application rate limits"
            />
            <SettingRow
              description="A wrong password and an address with no account give one answer and cost the same Argon2 work, on a dummy hash where there is no user. It is why the chart above splits them and the API never will."
              fixed="Always"
              label="One answer for a guess"
            />
            <SettingRow
              description="A refresh token presented twice revokes every session in its family and signs the whole device tree out. It is not a rule and cannot be turned off: a token seen twice means one of the two holders is not the owner, and there is no version of that worth allowing."
              fixed="Always"
              label="Refresh token reuse detection"
            />
            <SettingRow
              description="Origin and site checks run before a credential is stashed on the request, so a forged request cannot consume a refresh token and trip reuse detection on the victim's behalf. Without that ordering, making somebody's browser send one request would sign them out everywhere."
              fixed="Always"
              label="Cross-site checks, in that order"
            />
            <SettingRow
              description="Country allowlist, per-number velocity, per-address limits and a daily spend cap that is a hard stop rather than an alert. It has its own screen because the cap is a number with an invoice behind it, and one number belongs in one place."
              fixed="Elsewhere"
              label="The SMS fraud guard"
            >
              <template #actions>
                <v-btn
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:open-in-new"
                  size="small"
                  to="/sms/policy"
                  variant="text"
                >
                  Policy &amp; spend
                </v-btn>
              </template>
            </SettingRow>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.never"
          expandable
          description="A signal is evidence. Four things this screen is regularly expected to do and does not."
          title="What a signal never does"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="A rule can ask for a second factor, which costs the owner one code and costs a thief the account. Nothing here ends a live session on its own, because the false positives are ordinary people and signing them out on a VPN hop teaches them that the product is broken."
              fixed="Never"
              label="Sign somebody out by itself"
            />
            <SettingRow
              description="Refusing a sign-in on a signal is a lockout by another name, and a lockout is a denial-of-service against the victim: whoever can make the signal fire can lock anybody out. That is why the strongest response offered is a challenge and not a block."
              fixed="Never"
              label="Lock an account"
            />
            <SettingRow
              description="Nothing a detector concludes changes the answer a caller gets. A guesser whose address has been flagged is refused in the same words, at the same cost, as one nobody has noticed, or the flag would be a way to find out which accounts exist."
              fixed="Never"
              label="Show in the answer"
            />
            <SettingRow
              description="A breached password is a password somebody else also chose. A first sign-in from a country is usually a holiday. What a run of them across many accounts says is worth reading, which is the only reason the quiet ones are recorded at all."
              fixed="Never"
              label="Prove a compromise"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Security</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="61"
            :value="stats.open"
            info="Signals nobody has acknowledged or dismissed yet. It is a queue, not a count of problems."
            label="Open signals"
          />
          <UsageTile
            :seed="63"
            :value="stats.accountsFlagged"
            info="Accounts named by at least one open signal. Never a count of compromised accounts: most of these are fine."
            label="Accounts flagged"
          />
          <UsageTile
            :seed="65"
            :series="stats.refusedDaily"
            :value="stats.refused"
            info="Every sign-in we refused, for any reason. Most of it is people mistyping their own password."
            label="Refused sign-ins"
          />
          <UsageTile
            :seed="67"
            :series="stats.breachedDaily"
            :value="stats.breachedRefused"
            info="Passwords refused for appearing in the corpus. A count of passwords offered, never of accounts holding one: those cannot be swept."
            label="Breached refused"
          />
        </div>

        <LayerCard
          :padded="false"
          description="In the window the list is set to."
          title="Where the signals come from"
        >
          <ul v-if="counts.all > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="tally in kindTally" :key="tally.kind" class="flex items-center gap-2.5">
              <span class="w-32 flex-none truncate text-ink/80">{{ tally.label }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="
                    tally.kind === 'token_reuse' || tally.kind === 'sms_pumping'
                      ? 'bg-error'
                      : tally.kind === 'credential_stuffing'
                        ? 'bg-warning'
                        : 'bg-primary'
                  "
                  :style="{ width: `${tally.share}%` }"
                  class="block h-full rounded-full"
                />
              </span>
              <span
                :class="tally.count === 0 ? 'text-ink/35' : 'text-ink'"
                class="w-8 flex-none text-right font-mono tabular-nums"
              >
                {{ tally.count }}
              </span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            Nothing has fired in this window. Every detector is listed here whether or not it
            found anything, so a quiet row is an answer rather than a gap.
          </p>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="A hard stop with an invoice behind it. Set on the SMS screen, watched here."
          title="Today's SMS spend"
        >
          <div v-if="policy" class="flex flex-col gap-2.5 p-4">
            <div class="flex items-baseline justify-between gap-3">
              <span class="font-mono text-lg leading-none font-medium text-ink tabular-nums">
                {{ formatMoney(spentToday, policy.currency) }}
              </span>
              <span class="text-xs text-ink/55">
                of {{ formatMoney(policy.dailySpendCap, policy.currency) }}
              </span>
            </div>
            <span class="h-1.5 overflow-hidden rounded-full bg-ink/8">
              <span
                :class="capUsed >= 90 ? 'bg-error' : capUsed >= 60 ? 'bg-warning' : 'bg-primary'"
                :style="{ width: `${capUsed}%` }"
                class="block h-full rounded-full"
              />
            </span>
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              {{ capUsed }}% of today's cap. It clears at the start of the next UTC day, and a
              cap that is reached refuses every send rather than slowing them down.
            </p>
            <NuxtLink
              class="text-[11px] font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/sms/policy"
            >
              Change the cap
            </NuxtLink>
          </div>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            This project has no SMS policy, so it sends nothing and spends nothing. That is the
            same answer as an empty allowlist and it is deliberate.
          </p>
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

    <NumberDialog
      v-model="travelDialog"
      :current="settings.travelSpeedKmh"
      :hint="`Between ${TRAVEL_SPEED_MIN} and ${TRAVEL_SPEED_MAX}. Commercial cruise is about 900 km/h.`"
      :integer-label="SECURITY_ISSUE.travelInteger"
      :max="TRAVEL_SPEED_MAX"
      :min="TRAVEL_SPEED_MIN"
      :range-label="SECURITY_ISSUE.travelRange"
      description="The speed a hop between two sign-ins would have needed before it is called impossible. Lower it and a long flight starts firing; raise it and only the physically absurd does."
      label="Call a hop impossible above"
      suffix="km/h"
      title="Change when travel is impossible"
      @confirm="confirmTravel"
    />

    <NumberDialog
      v-model="stuffingDialog"
      :current="settings.stuffingRefusals"
      :hint="`Between ${STUFFING_REFUSALS_MIN} and ${STUFFING_REFUSALS_MAX} refusals in an hour.`"
      :integer-label="SECURITY_ISSUE.stuffingInteger"
      :max="STUFFING_REFUSALS_MAX"
      :min="STUFFING_REFUSALS_MIN"
      :range-label="SECURITY_ISSUE.stuffingRange"
      description="Refusals from one address, across accounts, inside an hour before it is recorded as a list being tried. The rate limits refuse the requests either way; this decides when a row appears about it."
      label="Record a list at"
      suffix="refusals"
      title="Change when refusals read as a list"
      @confirm="confirmStuffing"
    />

    <NumberDialog
      v-model="retentionDialog"
      :current="settings.retentionDays"
      :hint="`Between ${SIGNAL_RETENTION_MIN} and ${SIGNAL_RETENTION_MAX} days.`"
      :integer-label="SECURITY_ISSUE.retentionInteger"
      :max="SIGNAL_RETENTION_MAX"
      :min="SIGNAL_RETENTION_MIN"
      :range-label="SECURITY_ISSUE.retentionRange"
      description="How long a signal is kept after it is seen, whatever is decided about it. The audit log keeps its own record of every decision for its own term, so shortening this does not shorten that."
      label="Keep signals for"
      suffix="days"
      title="Change how long signals are kept"
      @confirm="confirmRetention"
    />

    <SignalDismissDialog
      v-model="dismissDialog"
      :busy="dismissingBusy"
      :person="dismissingPerson"
      :signal="dismissingSignal"
      @confirm="confirmDismiss"
    />
  </div>
</template>
