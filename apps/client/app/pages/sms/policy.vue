<script setup lang="ts">
/**
 * Policy & spend: what SMS this project will pay for, and everything that has to be true
 * before a message costs anything (PROJECT.md 4.8, notes/sms-policy.md).
 *
 * SMS is the one channel where a request costs money before it reaches anybody, which is
 * why almost every control here is a refusal and why readiness comes before any of them.
 * Five things have to be true and they live on four screens: the method is on, a carrier
 * can be reached, somewhere is allowed, a human check can be answered, and there is money
 * to spend. A policy must never read as ready while any of those is false, so the header
 * badge is read off all five rather than off this screen's own row.
 *
 * The one worth building the screen around is the human check. Attestation is on by
 * default and no provider is wired that can satisfy it, so a project with a healthy cap
 * and a sensible allowlist still sends nothing, and the refusal names a token the caller
 * had no way to obtain. Nothing in a log says "your settings are fine and the deployment
 * is not"; saying it here is most of the value of the page.
 *
 * Under readiness, the two decisions an operator came to make sit beside the money they
 * cost: where it may send and what it may spend on the left, today's ledger on the right,
 * so changing a cap does not mean comparing two distant panels. The cap is a draft with
 * its own Save, because it is typed and because a cap set below the day's spend stops the
 * channel until midnight UTC and that has to be readable before the write, not after it.
 *
 * What nobody decides is folded at the foot. The order of the eight checks is the design
 * rather than a sequence, and it is worth reading once; it is not worth eight cards above
 * the two controls this screen exists for.
 */
import { countryFlag, countryName } from "~/utils/sessions";
import {
  allCountries,
  capChange,
  capShare,
  formatMoney,
  nextUtcReset,
  SMS_CHECK_ORDER,
  SMS_GUARD_CONSTANTS,
  SMS_POLICY_BOUNDS,
  smsBlockers,
  smsReadiness,
  untilReset,
} from "~/utils/sms-policy";
import { byoVendorInfo } from "~/utils/sms-providers";
import { formatDateTime } from "~/utils/time";

const projects = useProjectStore();
const store = useSmsPolicyStore();
const otp = useOtpStore();
const providers = useSmsProvidersStore();
const billing = useBillingStore();

const now = useNow({ interval: 30_000 });

/* What nobody decides. The guard's own order is reference, and it starts folded. */
const expanded = reactive({ pipeline: false, fixed: false });

const policy = computed(() => store.policyFor(projects.current.id));
const spent = computed(() => store.spentToday(projects.current.id));
const reserved = computed(() => store.reservedToday(projects.current.id));
const counters = computed(() => store.countersToday(projects.current.id));

/* The fields on their way to the server, so each control shows its own wait. */
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

function patch(key: string, change: Parameters<typeof store.patch>[1]) {
  void whileBusy(key, () => store.patch(projects.current.id, change));
}

/*
 * Readiness, which is five things on four screens.
 */

/** How SMS leaves, as the providers screen settled it. Read here, never set. */
const delivery = computed(() => {
  const projectId = projects.current.id;
  if (providers.modeFor(projectId) === "managed") {
    return { ready: true, label: "Sent through our own routing, which needs nothing of yours" };
  }
  const account = providers.accountFor(projectId);
  if (account === null) {
    return { ready: false, label: "Set to an account of yours with nothing wired" };
  }
  const vendor = byoVendorInfo(account.vendor);
  return account.secretSet
    ? { ready: true, label: `Sent through your own ${vendor?.label ?? "carrier"} account` }
    : {
        ready: false,
        label: `Your own ${vendor?.label ?? "carrier"} account has no ${vendor?.secretLabel.toLowerCase() ?? "secret"} stored`,
      };
});

const checks = computed(() =>
  smsReadiness({
    methodEnabled: otp.settingsFor(projects.current.id).sms.enabled,
    delivery: delivery.value,
    policy: policy.value,
    spentToday: spent.value,
    attestationWired: store.attestationWired,
    /* The wallet is the organisation's, so the funding check reads the organisation's
       balance: this project's sends are paid for out of the same credit as its siblings'. */
    balanceCents: billing.balanceFor(projects.currentOrg.id),
  }),
);

const blockers = computed(() => smsBlockers(checks.value));

const headerBadge = computed(() => {
  if (store.loading) return { label: "Reading", tone: "neutral" as const };
  const count = blockers.value.length;
  if (count === 0) return { label: "Ready", tone: "success" as const };
  return { label: count === 1 ? "1 blocker" : `${count} blockers`, tone: "warning" as const };
});

/* `Test setup` is a re-read of what the panel already holds, with a visible wait: the
   answer changes the moment a setting elsewhere does, and a reader who has just been to
   another screen wants to watch it change. */
const testing = ref(false);

async function runTest() {
  testing.value = true;
  await new Promise((resolve) => setTimeout(resolve, 700));
  testing.value = false;
}

/*
 * Setting it up, which is one write and not a row with the defaults in it.
 */
const setupOpen = ref(false);

async function confirmSetup(draft: Parameters<typeof store.create>[1]) {
  await whileBusy("setup", () => store.create(projects.current.id, draft));
  setupOpen.value = false;
  notify("SMS policy created");
}

/*
 * Where it may send.
 */
const countriesOpen = ref(false);
const showAllCountries = ref(false);

/** How many chips fit before the list is a wall rather than an answer. */
const COUNTRY_PREVIEW = 12;

const allowed = computed(() => {
  const codes = policy.value?.allowedCountries ?? [];
  return codes
    .map((code) => ({ code, name: countryName(code) ?? code, flag: countryFlag(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
});

const shownCountries = computed(() =>
  showAllCountries.value ? allowed.value : allowed.value.slice(0, COUNTRY_PREVIEW),
);

const hiddenCountries = computed(() => Math.max(0, allowed.value.length - COUNTRY_PREVIEW));

const totalCountries = allCountries((code) => countryName(code) ?? code).length;

function saveCountries(codes: string[]) {
  countriesOpen.value = false;
  patch("countries", { allowedCountries: codes });
}

/*
 * What it may spend. Typed, so it is a draft with its own save.
 */
const currency = computed(() => policy.value?.currency ?? "USD");
const cap = computed(() => policy.value?.dailySpendCap ?? 0);
const share = computed(() => capShare(spent.value, cap.value));

const capText = ref("");

watch(
  [cap, () => projects.current.id],
  () => {
    capText.value = String(cap.value);
  },
  { immediate: true },
);

const typedCap = computed(() => Number(capText.value.trim()));

const capIssue = computed(() => {
  if (capText.value.trim() === "" || !Number.isInteger(typedCap.value)) {
    return "A cap is a whole number of currency units.";
  }
  const { min, max } = SMS_POLICY_BOUNDS.dailySpendCap;
  return typedCap.value < min || typedCap.value > max ? `Between ${min} and ${max}.` : "";
});

const change = computed(() => capChange(spent.value, cap.value, typedCap.value));
const capDirty = computed(() => capIssue.value === "" && !change.value.unchanged);

function cancelCap() {
  capText.value = String(cap.value);
}

function saveCap() {
  if (!capDirty.value) return;
  patch("cap", { dailySpendCap: typedCap.value });
  notify("Spend cap changed");
}

const capTone = computed(() => {
  if (share.value >= 1) return "error";
  return share.value >= 0.8 ? "warning" : "ok";
});

/* Written out rather than interpolated: Tailwind generates what it can see in the source,
   so a class assembled from a variable is one that never reaches the stylesheet. */
const CAP_BAR: Record<"ok" | "warning" | "error", string> = {
  ok: "bg-primary",
  warning: "bg-warning",
  error: "bg-error",
};

const CAP_FIGURE: Record<"ok" | "warning" | "error", string> = {
  ok: "text-ink",
  warning: "text-warning",
  error: "text-error",
};

/** When the day's counters go back to nought, in both clocks a reader holds. */
const reset = computed(() => {
  const at = nextUtcReset(now.value);
  return { at, relative: untilReset(now.value), local: formatDateTime(at.toISOString()) };
});

/*
 * The ceilings. Each is one bounded whole number, so each goes through the same dialog.
 */
const numberDialog = ref(false);
const ipDialog = ref(false);
const ratioDialog = ref(false);

/* Sends a day at the ceiling, for the sentence that says what a limit means in practice. */
const ratioAllowance = computed(() =>
  counters.value.verified === 0
    ? SMS_GUARD_CONSTANTS.ratioFloor
    : counters.value.verified * (policy.value?.maxSendsPerVerify ?? 0),
);

const ratioNow = computed(() =>
  counters.value.verified === 0 ? null : counters.value.sent / counters.value.verified,
);

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

watch(
  () => projects.current.id,
  () => {
    countriesOpen.value = false;
    setupOpen.value = false;
    showAllCountries.value = false;
  },
);

const GUIDES_URL = "https://idenzy.dev/docs/sms/policy";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Policy &amp; spend">
      <template #badge>
        <StatusBadge :label="headerBadge.label" :tone="headerBadge.tone" />
      </template>
      <template #description>
        What SMS <span class="font-medium text-ink">{{ projects.current.name }}</span> will
        pay for. This is the one channel where a request costs money before it reaches
        anybody, so almost everything here is a refusal.
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
      Readiness first, because most of it is settled somewhere else. A policy that called
      itself ready while the carrier account or the verifier was unavailable would be the
      one thing this screen must not say.
    -->
    <SetupCheckCard
      :checks="checks"
      :testing="testing || store.loading"
      description="The five things that have to be true before a message costs anything. Three of them are settled on other screens, and each row says which."
      note="Read from what the panel already holds, so the answer changes the moment a setting does. Test setup re-reads them rather than sending anything."
      title="Readiness"
      @test="runTest"
    >
      <template v-if="!store.loading && policy === null" #actions>
        <FancyButton :disabled="isBusy('setup')" @click="setupOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Set up SMS
        </FancyButton>
      </template>
    </SetupCheckCard>

    <!--
      The two decisions, beside the money they cost. Seven columns and five, because a cap
      is changed against today's spend and the note asks for them not to be distant panels.
    -->
    <div class="grid gap-6 lg:grid-cols-12 lg:items-start">
      <!--
        Three cards on one grid rather than two columns holding them, because the order
        differs between the two arrangements. Stacked it is today's ledger, then the cap,
        then the countries, which is the note's mobile arrangement and the order the DOM
        is written in, so the focus order is the reading order. Beside each other they are
        placed by `col-start` and `row-start` instead: countries over the cap on the left,
        the ledger down the right.

        Today's ledger sits beside the controls it constrains. Reserved is shown apart
        from spent because they are different facts: the cap reads the whole ledger, and
        only the settled part is a message somebody was handed.
      -->
      <div
        class="flex min-w-0 flex-col lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:self-start"
      >
        <LayerCard :padded="false" description="Everything here is the UTC day." title="Today">
          <template #badge>
            <StatusBadge label="UTC day" tone="neutral" />
          </template>

          <div class="flex flex-col gap-2 border-b border-line p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-3">
              <span class="text-xs font-medium text-ink">Spent</span>
              <span class="font-mono text-[11px] tabular-nums">
                <span :class="policy === null ? 'text-ink' : CAP_FIGURE[capTone]">
                  {{ formatMoney(spent, currency) }}
                </span>
                <span v-if="policy" class="text-ink/45"> / {{ formatMoney(cap, currency) }}</span>
              </span>
            </div>
            <!-- Drawn only against a cap. A meter over a project with no policy is a bar
                 full to the end at nought spent, which reads as the opposite of the truth. -->
            <span
              v-if="policy"
              :aria-label="`Spent ${spent} of ${cap} ${currency}`"
              :aria-valuemax="100"
              :aria-valuenow="Math.round(share * 100)"
              aria-valuemin="0"
              class="block h-1.5 w-full overflow-hidden rounded-full bg-ink/8"
              role="progressbar"
            >
              <span
                :class="CAP_BAR[capTone]"
                :style="{ width: `${share * 100}%` }"
                class="block h-full rounded-full transition-[width] duration-200"
              />
            </span>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
              No cap is set, because there is no policy. Nothing can be spent until one
              exists, so nought here is a refusal rather than a quiet day.
            </p>
          </div>

          <dl class="m-0 flex list-none flex-col divide-y divide-line">
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Reserved, unsettled</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Taken before the message went out and not yet settled against what the
                  carrier charged. It stands rather than being released, because a dispatch
                  that threw may still have put a message on the wire.
                </span>
              </dt>
              <dd class="m-0 flex-none font-mono text-[11px] text-ink tabular-nums">
                {{ formatMoney(reserved, currency) }}
              </dd>
            </div>

            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Messages handed over</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Sends that reached a carrier, against the codes somebody actually entered.
                </span>
              </dt>
              <dd class="m-0 flex-none font-mono text-[11px] text-ink tabular-nums">
                {{ counters.sent.toLocaleString("en") }}
                <span class="text-ink/45">/ {{ counters.verified.toLocaleString("en") }}</span>
              </dd>
            </div>

            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <dt class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">Resets</span>
                <span class="text-[11px] leading-4 text-ink/55">
                  Midnight UTC, which is {{ reset.local }} where you are.
                </span>
              </dt>
              <dd class="m-0 flex-none text-[11px] text-ink/70">{{ reset.relative }}</dd>
            </div>
          </dl>

          <div class="border-t border-line px-4 py-2.5">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:troubleshoot"
              size="small"
              to="/sms/providers"
              variant="outlined"
            >
              Open delivery diagnostics
            </v-btn>
          </div>
        </LayerCard>
      </div>
      <!--
        The cap is typed, so it is a draft: saving the "2" of a "20" would refuse every
        send on the project until the "0" landed. What it does to the day is stated above
        the button rather than in a dialog after it.
      -->
      <div class="flex min-w-0 flex-col lg:col-span-7 lg:col-start-1 lg:row-start-2">
        <LayerCard
          description="A hard stop rather than an alert, held in Postgres rather than the cache, because this is the one limit whose failure mode is an invoice."
          title="The daily spend cap"
        >
          <p v-if="policy === null" class="m-0 py-6 text-center text-xs text-ink/50">
            No policy yet.
          </p>

          <div v-else class="flex flex-col gap-4">
            <div class="flex max-w-xs flex-col gap-1">
              <label class="text-xs font-medium text-ink" for="sms-cap">Daily cap</label>
              <v-text-field
                id="sms-cap"
                v-model="capText"
                :error="capIssue !== ''"
                :max="SMS_POLICY_BOUNDS.dailySpendCap.max"
                :min="SMS_POLICY_BOUNDS.dailySpendCap.min"
                :suffix="currency"
                autocomplete="off"
                class="font-mono"
                hide-details
                inputmode="numeric"
                type="number"
                variant="filled"
              />
              <p :class="capIssue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
                {{ capIssue || `Whole units of ${currency}. It applies to the next send.` }}
              </p>
            </div>

            <!-- Before and after, against what today has already spent. The case worth
                 naming is a cap below the day's spend: legal, and it stops the channel
                 until midnight UTC. -->
            <div
              class="flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                <span :class="capDirty ? 'text-ink/45 line-through' : 'text-ink'">
                  {{ formatMoney(change.remainingNow, currency) }} left today
                </span>
                <template v-if="capDirty">
                  <Icon
                    aria-hidden="true"
                    class="text-sm text-ink/40"
                    name="material-symbols:arrow-forward"
                  />
                  <span :class="change.stopsNow ? 'text-warning' : 'text-ink'">
                    {{ formatMoney(change.remainingNext, currency) }} left today
                  </span>
                </template>
              </div>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                <template v-if="!capDirty">
                  {{ formatMoney(spent, currency) }} of
                  {{ formatMoney(cap, currency) }} spent on this UTC day.
                </template>
                <template v-else-if="change.stopsNow">
                  <span class="font-medium text-warning">Sends stop immediately.</span>
                  {{ formatMoney(spent, currency) }} is already spent today, so a cap of
                  {{ formatMoney(typedCap, currency) }} refuses the next send with
                  <span class="font-mono">spend_cap_reached</span> and keeps refusing until
                  the counters reset {{ reset.relative }}. Nothing already spent is released.
                </template>
                <template v-else>
                  Applies to the next send. It never releases what today has already spent,
                  and the counters reset at midnight UTC, {{ reset.relative }}.
                </template>
              </p>
            </div>

            <footer class="flex items-center justify-end gap-2">
              <v-btn
                :disabled="!capDirty || isBusy('cap')"
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="cancelCap"
              >
                Cancel
              </v-btn>
              <v-btn
                :disabled="!capDirty"
                :loading="isBusy('cap')"
                class="text-xs font-medium"
                color="primary"
                size="small"
                variant="flat"
                @click="saveCap"
              >
                Save cap
              </v-btn>
            </footer>
          </div>
        </LayerCard>
      </div>

      <div class="flex min-w-0 flex-col lg:col-span-7 lg:col-start-1 lg:row-start-1">
        <LayerCard
          :padded="false"
          description="A destination outside this list is refused before it costs anything. Placed from carrier metadata, never from the dialling prefix."
          title="Where it may send"
        >
          <template #badge>
            <StatusBadge
              :label="allowed.length === 0 ? 'Nowhere' : `${allowed.length} of ${totalCountries}`"
              :tone="allowed.length === 0 ? 'warning' : 'neutral'"
            />
          </template>

          <p v-if="store.loading" class="m-0 px-4 py-10 text-center text-xs text-ink/50">
            Reading the policy.
          </p>

          <div v-else-if="policy === null" class="px-4 py-10 text-center">
            <p class="m-0 text-xs leading-5 text-ink/55">
              Nothing is decided yet. Set up SMS above chooses where it may send and writes
              the policy in one go.
            </p>
          </div>

          <EmptyState
            v-else-if="allowed.length === 0"
            description="The list starts empty and that is the point. Pumping picks the destination, so the countries a product does not serve are exactly the ones an attacker sends to, and a list that starts open is one nobody ever narrows."
            icon="material-symbols:public-off"
            title="No country is allowed"
          >
            <template #actions>
              <FancyButton @click="countriesOpen = true">
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                Choose countries
              </FancyButton>
            </template>
          </EmptyState>

          <template v-else>
            <ul class="m-0 flex list-none flex-wrap gap-1.5 p-4">
              <li
                v-for="country in shownCountries"
                :key="country.code"
                class="inline-flex items-center gap-1.5 rounded-full bg-ink/4 py-0.5 pr-2 pl-1.5 text-xs text-ink/80 ring-1 ring-ink/6 ring-inset"
              >
                <span aria-hidden="true" class="text-sm">{{ country.flag }}</span>
                <span>{{ country.name }}</span>
                <span class="font-mono text-[10px] text-ink/45">{{ country.code }}</span>
              </li>
              <!-- A long list folds behind its own count rather than running down a
                   phone: the number is the answer, the names are the detail. -->
              <li v-if="hiddenCountries > 0 && !showAllCountries">
                <button
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-ink/70 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                  @click="showAllCountries = true"
                >
                  Show all {{ allowed.length }}
                </button>
              </li>
              <li v-else-if="showAllCountries && hiddenCountries > 0">
                <button
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-ink/70 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                  @click="showAllCountries = false"
                >
                  Show fewer
                </button>
              </li>
            </ul>

            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5"
            >
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                Sender ID
                <span class="font-mono text-ink/75">
                  {{ policy.senderId ?? "the shared number" }}
                </span>
                &middot; registration is per country and is set up on
                <NuxtLink class="font-medium text-ink" to="/sms/providers">Providers</NuxtLink>.
              </p>
              <v-btn
                :loading="isBusy('countries')"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:edit-outline"
                size="small"
                variant="text"
                @click="countriesOpen = true"
              >
                Change countries
              </v-btn>
            </div>
          </template>
        </LayerCard>
      </div>
    </div>

    <!--
      The two remaining decisions, side by side: who is asked to prove they are human, and
      how often anybody may ask.
    -->
    <div class="grid gap-6 lg:grid-cols-2 lg:items-start">
      <LayerCard
        :padded="false"
        description="A CAPTCHA or an app attestation, checked before any counter is touched."
        title="Human verification"
      >
        <p v-if="policy === null" class="m-0 px-4 py-8 text-center text-xs text-ink/50">
          No policy yet.
        </p>

        <div v-else class="divide-y divide-line">
          <SettingRow label="Require a human check">
            <template #description>
              Before any counter, and that ordering is the whole point of it. A counter is a
              write, so without this first anybody could exhaust a stranger's daily allowance
              by naming their number, and the victim would find their own sign-in refused
              having never been sent a code.
            </template>
            <v-switch
              :disabled="isBusy('attestation')"
              :model-value="policy.attestationRequired"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="patch('attestation', { attestationRequired: $event === true })"
            />
          </SettingRow>

          <SettingRow
            :fixed="store.attestationWired ? 'Wired' : 'Nothing wired'"
            label="What this deployment can answer"
          >
            <template #description>
              <template v-if="store.attestationWired">
                A provider is wired and can answer an attestation, so the requirement above
                is one a real caller can satisfy.
              </template>
              <template v-else>
                Nothing is wired that can answer one, and the verifier standing in for it
                answers false to everything. So while the switch above is on, every send is
                refused for a token the caller had no way to obtain. That is the intended
                failure rather than an oversight: a verifier that accepted what it cannot
                check would make the setting read as protection while being none.
              </template>
            </template>
          </SettingRow>
        </div>
      </LayerCard>

      <LayerCard
        :padded="false"
        description="What a caller may ask for before it reads as abuse. Three are yours; the shapes of an attack are ours."
        title="Rate limits"
      >
        <p v-if="policy === null" class="m-0 px-4 py-8 text-center text-xs text-ink/50">
          No policy yet.
        </p>

        <div v-else class="divide-y divide-line">
          <SettingRow
            description="Messages to one destination in a rolling day. Catches a scheme milking one number, which the per-address ceiling cannot see."
            label="Per number, a day"
          >
            <template #actions>
              <v-btn
                :disabled="isBusy('perNumber')"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:edit-outline"
                size="small"
                variant="text"
                @click="numberDialog = true"
              >
                {{ policy.perNumberDailyLimit }}
              </v-btn>
            </template>
          </SettingRow>

          <SettingRow
            description="Requests from one address in a rolling hour. Catches the sweep, which the per-number ceiling cannot see. A request carrying no address is skipped rather than refused, because that is our gap and not the caller's."
            label="Per address, an hour"
          >
            <template #actions>
              <v-btn
                :disabled="isBusy('perIp')"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:edit-outline"
                size="small"
                variant="text"
                @click="ipDialog = true"
              >
                {{ policy.perIpHourlyLimit }}
              </v-btn>
            </template>
          </SettingRow>

          <SettingRow label="Sends for every code entered">
            <template #description>
              The signal that catches a scheme which has done everything else right, because
              the one thing it cannot fake is somebody typing the code in. It throttles the
              project rather than the caller, and only above
              {{ SMS_GUARD_CONSTANTS.ratioFloor }} sends in a day.
              <template v-if="ratioNow !== null">
                Today it is running at
                <span class="font-mono text-ink/80">{{ ratioNow.toFixed(1) }}</span> against an
                allowance of {{ ratioAllowance.toLocaleString("en") }} sends.
              </template>
            </template>
            <template #actions>
              <v-btn
                :disabled="isBusy('ratio')"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:edit-outline"
                size="small"
                variant="text"
                @click="ratioDialog = true"
              >
                {{ policy.maxSendsPerVerify }}
              </v-btn>
            </template>
          </SettingRow>
        </div>
      </LayerCard>
    </div>

    <!--
      What nobody configures. The order of the checks is the design rather than a
      sequence, and it is worth reading once; it is not worth eight cards above the two
      controls this screen exists for.
    -->
    <LayerCard
      v-model:open="expanded.pipeline"
      description="The order is the design, not a sequence. What is free runs first, and nothing that writes runs before the caller has proved they are human."
      expandable
      title="What a send passes through"
    >
      <ol class="m-0 flex list-none flex-col p-0">
        <li v-for="(check, index) in SMS_CHECK_ORDER" :key="check.id" class="flex gap-3.5">
          <div aria-hidden="true" class="flex flex-none flex-col items-center">
            <span
              :class="check.writes ? 'text-warning ring-warning/40' : 'text-ink/70 ring-ink/6'"
              class="flex size-6 flex-none items-center justify-center rounded-full bg-ink/4 font-mono text-[10px] leading-none font-medium tabular-nums ring-1 ring-inset"
            >
              {{ index + 1 }}
            </span>
            <span v-if="index < SMS_CHECK_ORDER.length - 1" class="w-px flex-1 bg-line" />
          </div>
          <div
            :class="index < SMS_CHECK_ORDER.length - 1 ? 'pb-5' : ''"
            class="flex min-w-0 flex-col gap-1"
          >
            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 class="m-0 text-sm font-medium text-ink">{{ check.title }}</h3>
              <span
                class="rounded-full bg-ink/4 px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap text-ink/55 ring-1 ring-ink/6 ring-inset"
              >
                {{ check.errorCode }}
              </span>
              <span
                v-if="!check.configurable"
                class="rounded-full bg-ink/4 px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55 ring-1 ring-ink/6 ring-inset"
              >
                Ours
              </span>
            </div>
            <p class="m-0 text-xs leading-5 text-ink/60">{{ check.detail }}</p>
          </div>
        </li>
      </ol>

      <p class="m-0 mt-4 border-t border-line pt-4 text-[11px] leading-4 text-ink/55">
        <span class="font-medium text-ink">The rings in amber write.</span>
        None of them runs before attestation, and that ordering is the point: without it
        anybody could exhaust a stranger's daily allowance by naming their number, and the
        victim would find their own sign-in refused having never been sent a code. The two
        that only read are cheap enough to sit anywhere, so they sit where they are most
        useful.
      </p>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.fixed"
      description="The parts of the guard a project does not decide, and the reason each one is fixed."
      expandable
      title="What is fixed, and why"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="Twenty countries share +1, so a project allowing the United States must not thereby be allowing every Caribbean range on the same code. The destination is placed from carrier metadata rather than read off its prefix, which is the whole reason the allowlist is countries and not dialling codes."
          fixed="Metadata"
          label="How a number is placed"
        />
        <SettingRow
          description="Refused, and that is the honest reading: an allowlist that admits what it could not identify is not one, and unplaceable ranges are disproportionately the expensive ones."
          fixed="Refused"
          label="A number that cannot be placed"
        />
        <SettingRow
          description="Premium-rate and shared-cost ranges are refused whatever the allowlist says. They are paid for the same way, and a range nobody signs in from has nothing to lose by being refused."
          fixed="Always refused"
          label="Premium-rate ranges"
        />
        <SettingRow
          :description="`${SMS_GUARD_CONSTANTS.blockBurstLimit} destinations in one thousand-block in an hour. A pumping run walks a range, so its numbers share every digit but the last few. Not a setting, because it describes an attack's shape rather than a preference: a real user base does not arrive in consecutive runs, whatever the product is.`"
          :fixed="`${SMS_GUARD_CONSTANTS.blockBurstLimit} an hour`"
          label="Consecutive destinations"
        />
        <SettingRow
          description="Every counter here is strict, so a window we could not read is a window we do not send through. The fail-open that is right for a sign-in attempt would turn a cache outage into an unmetered send window, which is the whole opportunity a pumping scheme is looking for. The caller is told to come back later rather than that our cache is down."
          fixed="Strict"
          label="A counter we cannot read"
        />
        <SettingRow
          :description="`Set for the project and not converted at send time. Converting would put an exchange rate on the request path and make the cap mean something different every day, so a provider quoting in another currency is a misconfiguration rather than something to translate.`"
          :fixed="currency"
          label="Currency"
        />
        <SettingRow
          description="The check and the increment are one statement, or two sends that each fit under the cap would both pass. The first send of a day takes a different branch, so its own cost is compared against the cap before the statement runs."
          fixed="One statement"
          label="How a send is reserved"
        />
        <SettingRow
          description="A dispatch that threw may still have put a message on the wire, so the day is left overstated rather than released. The ledger holds the day's total and a settlement books only the difference between what was quoted and what was charged."
          fixed="It stands"
          label="A reservation that was never settled"
        />
        <SettingRow
          description="Failover is on the next request, never a retry of this one: the failed send already reserved the spend and already spent the number's velocity, and a gateway timeout is the case where the message usually went out."
          fixed="Never"
          label="Retrying a failed send"
        />
      </div>
    </LayerCard>

    <!-- Mounted only while open, like every dialog here that writes and then closes. -->
    <SmsSetupDialog
      v-if="setupOpen"
      v-model="setupOpen"
      :attestation-wired="store.attestationWired"
      :busy="isBusy('setup')"
      :delivery="delivery"
      :project-name="projects.current.name"
      @confirm="confirmSetup"
    />

    <SmsCountriesDialog
      v-if="countriesOpen"
      v-model="countriesOpen"
      :allowed="policy?.allowedCountries ?? []"
      :saving="isBusy('countries')"
      @save="saveCountries"
    />

    <NumberDialog
      v-if="numberDialog && policy"
      v-model="numberDialog"
      :current="policy.perNumberDailyLimit"
      :max="SMS_POLICY_BOUNDS.perNumberDailyLimit.max"
      :min="SMS_POLICY_BOUNDS.perNumberDailyLimit.min"
      :range-label="`Between ${SMS_POLICY_BOUNDS.perNumberDailyLimit.min} and ${SMS_POLICY_BOUNDS.perNumberDailyLimit.max}.`"
      description="Messages to one destination in a rolling day, counted strictly: a window we could not read is a window we do not send through."
      integer-label="A ceiling is a whole number of messages."
      label="Messages a day"
      suffix="messages"
      title="Change the per-number ceiling"
      @confirm="
        patch('perNumber', { perNumberDailyLimit: $event });
        notify('Per-number ceiling changed');
      "
    />

    <NumberDialog
      v-if="ipDialog && policy"
      v-model="ipDialog"
      :current="policy.perIpHourlyLimit"
      :max="SMS_POLICY_BOUNDS.perIpHourlyLimit.max"
      :min="SMS_POLICY_BOUNDS.perIpHourlyLimit.min"
      :range-label="`Between ${SMS_POLICY_BOUNDS.perIpHourlyLimit.min} and ${SMS_POLICY_BOUNDS.perIpHourlyLimit.max}.`"
      description="Requests from one address in a rolling hour. A request carrying no address is skipped rather than refused."
      integer-label="A ceiling is a whole number of requests."
      label="Requests an hour"
      suffix="requests"
      title="Change the per-address ceiling"
      @confirm="
        patch('perIp', { perIpHourlyLimit: $event });
        notify('Per-address ceiling changed');
      "
    />

    <NumberDialog
      v-if="ratioDialog && policy"
      v-model="ratioDialog"
      :current="policy.maxSendsPerVerify"
      :description="`Sends the project may make for every code somebody actually enters, applied only above ${SMS_GUARD_CONSTANTS.ratioFloor} sends in a day. It throttles the project rather than one caller.`"
      :max="SMS_POLICY_BOUNDS.maxSendsPerVerify.max"
      :min="SMS_POLICY_BOUNDS.maxSendsPerVerify.min"
      :range-label="`Between ${SMS_POLICY_BOUNDS.maxSendsPerVerify.min} and ${SMS_POLICY_BOUNDS.maxSendsPerVerify.max}.`"
      integer-label="A ratio is a whole number of sends."
      label="Sends per code entered"
      suffix="sends"
      title="Change the send-to-verify ratio"
      @confirm="
        patch('ratio', { maxSendsPerVerify: $event });
        notify('Send-to-verify ratio changed');
      "
    />

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
      color="surface"
      location="bottom right"
      rounded="lg"
      variant="flat"
    >
      <span class="text-xs text-ink">{{ toast }}</span>
    </v-snackbar>
  </div>
</template>
