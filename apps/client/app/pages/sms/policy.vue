<script setup lang="ts">
/**
 * Policy & spend: what SMS this project will pay for, and everything that has to be true
 * before a message costs anything (PROJECT.md 4.8, `apps/auth-api/src/delivery`).
 *
 * SMS is the one channel where a request costs money before it reaches anybody, which is
 * why almost every control here is a refusal and why the screen opens with whether the
 * project can send at all rather than with a form. Three independent things stop a send
 * and a project can be stopped by more than one at once, so the answer is a list.
 *
 * The one worth building the screen around is the second. Attestation is on by default
 * and no provider is wired that can satisfy it, so a project with a healthy cap and a
 * sensible allowlist still sends nothing, and the refusal names a token the caller had no
 * way to obtain. That is a silent misconfiguration by construction: nothing in a log says
 * "your settings are fine and the deployment is not". Saying it here is most of the value
 * of the page.
 *
 * The order of the checks is the other half. It is stated in full because it is the design
 * rather than a sequence: placing the number is free and settles two refusals on its own,
 * attestation runs before any counter so a caller who has proved nothing cannot burn a
 * real user's velocity budget by naming their number, and everything that writes runs
 * last. Two of the checks are ours and not the project's, and each says why.
 */
import { countryFlag, countryName } from "~/utils/sessions";
import {
  allCountries,
  capShare,
  evaluateReadiness,
  formatMoney,
  SMS_BLOCKERS,
  SMS_CHECK_ORDER,
  SMS_GUARD_CONSTANTS,
  SMS_POLICY_BOUNDS,
} from "~/utils/sms-policy";

const projects = useProjectStore();
const store = useSmsPolicyStore();

/* Which cards start unfolded. Where it sends and what it spends are what a visit is for. */
const expanded = reactive({ countries: true, spend: true, ceilings: true, order: false });

const policy = computed(() => store.policyFor(projects.current.id));
const spent = computed(() => store.spentToday(projects.current.id));
const counters = computed(() => store.countersToday(projects.current.id));

const readiness = computed(() =>
  evaluateReadiness(policy.value, spent.value, store.attestationWired),
);

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

const saving = computed(() => busy.value.size > 0);

function patch(key: string, change: Parameters<typeof store.patch>[1]) {
  void whileBusy(key, () => store.patch(projects.current.id, change));
}

function createPolicy() {
  void whileBusy("create", () => store.create(projects.current.id));
}

/*
 * Where it may send.
 */
const countriesOpen = ref(false);

const allowed = computed(() => {
  const codes = policy.value?.allowedCountries ?? [];
  return codes
    .map((code) => ({ code, name: countryName(code) ?? code, flag: countryFlag(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
});

const totalCountries = allCountries((code) => countryName(code) ?? code).length;

function saveCountries(codes: string[]) {
  countriesOpen.value = false;
  patch("countries", { allowedCountries: codes });
}

/*
 * What it may spend. The cap is a hard stop and the meter says how much of today is gone.
 */
const capDialog = ref(false);

const currency = computed(() => policy.value?.currency ?? "USD");
const cap = computed(() => policy.value?.dailySpendCap ?? 0);
const share = computed(() => capShare(spent.value, cap.value));
const remaining = computed(() => Math.max(0, cap.value - spent.value));

const capTone = computed(() => {
  if (share.value >= 1) return "error";
  return share.value >= 0.8 ? "warning" : "ok";
});

const CAP_BAR: Record<"ok" | "warning" | "error", string> = {
  ok: "bg-primary",
  warning: "bg-warning",
  error: "bg-error",
};

/* Written out rather than interpolated: Tailwind generates what it can see in the source,
   so a class assembled from a variable is one that never reaches the stylesheet. */
const CAP_FIGURE: Record<"ok" | "warning" | "error", string> = {
  ok: "text-ink",
  warning: "text-warning",
  error: "text-error",
};

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
  },
);

const GUIDES = [
  {
    icon: "material-symbols:sms-outline",
    title: "SMS policy and spend",
    detail: "The allowlist, the cap, and every check a send passes before it costs anything.",
    href: "https://idenzy.dev/docs/sms/policy",
  },
  {
    icon: "material-symbols:shield-outline",
    title: "Pumping fraud",
    detail: "What the attack is, why the destination is the signal, and what stops it.",
    href: "https://idenzy.dev/docs/sms/fraud",
  },
  {
    icon: "material-symbols:verified-user-outline",
    title: "Attestation",
    detail: "App Attest, Play Integrity and CAPTCHA, and what each one proves.",
    href: "https://idenzy.dev/docs/sms/attestation",
  },
  {
    icon: "material-symbols:payments-outline",
    title: "What an SMS costs",
    detail: "Per-country pricing, segments, and why one apostrophe doubles a bill.",
    href: "https://idenzy.dev/docs/sms/pricing",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:sms-outline" title="Policy &amp; spend">
      <template #description>
        What SMS <span class="font-medium text-ink">{{ projects.current.name }}</span> will
        pay for. This is the one channel where a request costs money before it reaches
        anybody, so almost everything here is a refusal.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <!-- The verdict first. A project can be blocked by more than one thing at once,
             and one of them is ours rather than theirs, so this is a list and not a badge. -->
        <LayerCard
          :padded="false"
          description="Everything that has to be true before the next message is sent. Checked in the order the guard checks them."
          title="Can this project send?"
        >
          <template #badge>
            <StatusBadge
              :label="readiness.sendable ? 'Sending' : 'Sends nothing'"
              :tone="readiness.sendable ? 'success' : 'warning'"
            />
          </template>

          <p v-if="store.loading" class="m-0 px-4 py-8 text-center text-xs text-ink/50">
            Reading the policy.
          </p>

          <div
            v-else-if="readiness.sendable"
            class="flex items-start gap-3 px-4 py-4 text-xs leading-5"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-lg text-success"
              name="material-symbols:check-circle-outline"
            />
            <p class="m-0 text-ink/70">
              <span class="font-medium text-ink">Nothing is standing in the way.</span> A
              message to an allowed country, from a caller that attested, within today's
              ceilings and under the cap, is sent.
            </p>
          </div>

          <ul v-else class="m-0 list-none divide-y divide-line p-0">
            <li
              v-for="id in readiness.blockers"
              :key="id"
              class="flex items-start gap-3 px-4 py-3.5"
            >
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-base text-warning"
                name="material-symbols:block"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="m-0 text-xs font-medium text-ink">{{ SMS_BLOCKERS[id].title }}</p>
                  <span
                    class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/55"
                  >
                    {{ SMS_BLOCKERS[id].errorCode }}
                  </span>
                </div>
                <p class="m-0 text-[11px] leading-4 text-ink/60">
                  {{ SMS_BLOCKERS[id].detail }}
                </p>
              </div>
            </li>
          </ul>

          <div
            v-if="!store.loading && policy === null"
            class="border-t border-line bg-canvas/60 px-4 py-3"
          >
            <FancyButton :disabled="isBusy('create')" @click="createPolicy">
              <Icon
                :class="isBusy('create') ? 'animate-spin' : ''"
                :name="
                  isBusy('create') ? 'material-symbols:progress-activity' : 'material-symbols:add'
                "
                aria-hidden="true"
                class="text-sm"
              />
              Create a policy
            </FancyButton>
            <p class="m-0 mt-2 text-[11px] leading-4 text-ink/55">
              Creates the row with the column defaults. The allowlist stays empty, so the
              project still sends nothing until somewhere is chosen: creating a policy is
              not the same as deciding where to send.
            </p>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.countries"
          :padded="false"
          description="A destination outside this list is refused before it costs anything. Placed from carrier metadata, never from the prefix."
          expandable
          title="Where it may send"
        >
          <template #badge>
            <StatusBadge
              :label="
                allowed.length === 0 ? 'Nowhere' : `${allowed.length} of ${totalCountries}`
              "
              :tone="allowed.length === 0 ? 'warning' : 'neutral'"
            />
          </template>

          <div v-if="policy === null" class="px-4 py-8 text-center text-xs text-ink/50">
            No policy yet.
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
                v-for="country in allowed"
                :key="country.code"
                class="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pr-2 pl-1.5 text-xs text-ink/80"
              >
                <span aria-hidden="true" class="text-sm">{{ country.flag }}</span>
                <span>{{ country.name }}</span>
                <span class="font-mono text-[10px] text-ink/45">{{ country.code }}</span>
              </li>
            </ul>
            <div class="border-t border-line px-3 py-2">
              <button
                class="inline-flex h-8 items-center gap-1.5 rounded-(--idenzy-radius-x-small) px-2 text-xs font-medium text-ink/70 transition-colors duration-150 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                type="button"
                @click="countriesOpen = true"
              >
                <Icon aria-hidden="true" class="text-base" name="material-symbols:edit-outline" />
                Change countries
              </button>
            </div>
          </template>

          <div class="divide-y divide-line border-t border-line px-4 py-4">
            <SettingRow
              description="Twenty countries share +1, so a project allowing the United States must not thereby be allowing every Caribbean range on the same code. The destination is placed from carrier metadata rather than read off its prefix, which is the whole reason this list is countries and not dialling codes."
              fixed="Metadata"
              label="How a number is placed"
            />
            <SettingRow
              description="Refused, and that is the honest reading: an allowlist that admits what it could not identify is not one, and unplaceable ranges are disproportionately the expensive ones."
              fixed="Refused"
              label="A number that cannot be placed"
            />
            <SettingRow
              description="Premium-rate and shared-cost ranges are refused whatever this list says. They are paid for the same way, and a range nobody signs in from has nothing to lose by being refused."
              fixed="Always refused"
              label="Premium-rate ranges"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.spend"
          description="A hard stop rather than an alert, held in Postgres rather than the cache, because this is the one limit whose failure mode is an invoice."
          expandable
          title="The daily spend cap"
        >
          <div v-if="policy === null" class="py-4 text-center text-xs text-ink/50">
            No policy yet.
          </div>

          <template v-else>
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-baseline justify-between gap-3">
                <span class="text-xs font-medium text-ink">Spent today</span>
                <span class="font-mono text-[11px] tabular-nums">
                  <span :class="CAP_FIGURE[capTone]">{{ formatMoney(spent, currency) }}</span>
                  <span class="text-ink/45"> / {{ formatMoney(cap, currency) }}</span>
                </span>
              </div>
              <span
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
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                {{ formatMoney(remaining, currency) }} left today. The day is UTC, and the
                counter it is measured against is the same row billing reads.
              </p>
            </div>

            <div class="mt-5 divide-y divide-line">
              <SettingRow
                :description="`A send that would take the day past this is refused with spend_cap_reached. Raising it takes effect on the next send; it never releases what today has already spent.`"
                label="The cap"
              >
                <template #actions>
                  <v-btn
                    :disabled="isBusy('cap')"
                    class="text-xs font-medium"
                    color="neutral"
                    prepend-icon="material-symbols:edit-outline"
                    size="small"
                    variant="text"
                    @click="capDialog = true"
                  >
                    {{ formatMoney(cap, currency) }}
                  </v-btn>
                </template>
              </SettingRow>
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
          </template>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.ceilings"
          description="What a caller may ask for before it reads as abuse. Three are yours; two describe an attack's shape and are ours."
          expandable
          title="The ceilings"
        >
          <div v-if="policy === null" class="py-4 text-center text-xs text-ink/50">
            No policy yet.
          </div>

          <div v-else class="divide-y divide-line">
            <SettingRow label="Attestation">
              <template #description>
                A CAPTCHA or an app attestation before any counter is touched. On by
                default, and turning it off is accepting the pumping risk yourself.
                <template v-if="!store.attestationWired">
                  Nothing is wired on this deployment that can answer one, so leaving it on
                  means every send is refused.
                </template>
              </template>
              <v-switch
                :disabled="isBusy('attestation')"
                :model-value="policy.attestationRequired"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="
                  patch('attestation', { attestationRequired: $event === true })
                "
              />
            </SettingRow>
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
                The signal that catches a scheme which has done everything else right,
                because the one thing it cannot fake is somebody typing the code in. It
                throttles the project rather than the caller, and only above
                {{ SMS_GUARD_CONSTANTS.ratioFloor }} sends in a day: below that the ratio is
                noise, and two sends with no verify is somebody who changed their mind.
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
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.order"
          description="The order is the design, not a sequence. What is free runs first, and nothing that writes runs before the caller has proved they are human."
          expandable
          title="What a send passes through"
        >
          <ol class="m-0 flex list-none flex-col p-0">
            <li v-for="(check, index) in SMS_CHECK_ORDER" :key="check.id" class="flex gap-3.5">
              <div aria-hidden="true" class="flex flex-none flex-col items-center">
                <span
                  :class="
                    check.writes
                      ? 'border-warning/50 text-warning'
                      : 'border-line text-ink/70'
                  "
                  class="flex size-6 flex-none items-center justify-center rounded-full border bg-canvas font-mono text-[10px] leading-none font-medium tabular-nums"
                >
                  {{ index + 1 }}
                </span>
                <span
                  v-if="index < SMS_CHECK_ORDER.length - 1"
                  class="w-px flex-1 bg-line"
                />
              </div>
              <div
                :class="index < SMS_CHECK_ORDER.length - 1 ? 'pb-5' : ''"
                class="flex min-w-0 flex-col gap-1"
              >
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 class="m-0 text-sm font-medium text-ink">{{ check.title }}</h3>
                  <span
                    class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap text-ink/55"
                  >
                    {{ check.errorCode }}
                  </span>
                  <span
                    v-if="!check.configurable"
                    class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
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
            anybody could exhaust a stranger's daily allowance by naming their number, and
            the victim would find their own sign-in refused having never been sent a code.
            The two that only read are cheap enough to sit anywhere, so they sit where they
            are most useful.
          </p>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Today</h2>
          <span class="text-xs text-ink/55">UTC day</span>
        </div>

        <LayerCard :padded="false" title="What it has spent">
          <div class="flex flex-col gap-2.5 p-4 text-xs">
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Spent</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ formatMoney(spent, currency) }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Cap</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ formatMoney(cap, currency) }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Messages sent</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ counters.sent.toLocaleString("en") }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-ink/60">Codes entered</span>
              <span class="font-mono text-[11px] text-ink tabular-nums">
                {{ counters.verified.toLocaleString("en") }}
              </span>
            </div>
          </div>
          <div
            v-if="policy && counters.sent > 0"
            class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink/55"
          >
            <span>
              <span class="font-mono text-ink tabular-nums">
                {{ ratioNow === null ? "—" : ratioNow.toFixed(1) }}
              </span>
              sends per code entered
            </span>
            <v-tooltip
              :text="`Throttled above ${policy.maxSendsPerVerify}, and only past ${SMS_GUARD_CONSTANTS.ratioFloor} sends in a day. Today's allowance is ${ratioAllowance.toLocaleString('en')} sends.`"
              location="top"
              max-width="260"
            >
              <template #activator="{ props: tip }">
                <Icon
                  v-bind="tip"
                  aria-label="How the ratio is read"
                  class="flex-none text-sm text-ink/40"
                  name="material-symbols:info-outline"
                  role="img"
                />
              </template>
            </v-tooltip>
          </div>
        </LayerCard>

        <LayerCard
          v-if="policy"
          :padded="false"
          description="Alphanumeric, registered per country. Null uses the shared number."
          title="Sender ID"
        >
          <div class="flex items-center justify-between gap-3 p-4 text-xs">
            <span class="text-ink/60">Shown as</span>
            <span class="font-mono text-[11px] text-ink">
              {{ policy.senderId ?? "The shared number" }}
            </span>
          </div>
          <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/55">
            Registration is per country and carries its own regulatory forms, so it is set
            up on the providers screen rather than typed here.
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

        <SaveStatus :last-saved="store.lastSavedAt(projects.current.id)" :saving="saving" />
      </aside>
    </div>

    <SmsCountriesDialog
      v-model="countriesOpen"
      :allowed="policy?.allowedCountries ?? []"
      :saving="isBusy('countries')"
      @save="saveCountries"
    />

    <NumberDialog
      v-if="policy"
      v-model="capDialog"
      :current="policy.dailySpendCap"
      :max="SMS_POLICY_BOUNDS.dailySpendCap.max"
      :min="SMS_POLICY_BOUNDS.dailySpendCap.min"
      :suffix="currency"
      description="A hard stop for the UTC day. A send that would take the day past it is refused, and raising it never releases what today has already spent."
      hint="Whole units of the project's currency."
      integer-label="A cap is a whole number of currency units."
      label="Daily spend cap"
      :range-label="`Between ${SMS_POLICY_BOUNDS.dailySpendCap.min} and ${SMS_POLICY_BOUNDS.dailySpendCap.max}.`"
      title="Change the daily spend cap"
      @confirm="
        patch('cap', { dailySpendCap: $event });
        notify('Spend cap changed');
      "
    />

    <NumberDialog
      v-if="policy"
      v-model="numberDialog"
      :current="policy.perNumberDailyLimit"
      :max="SMS_POLICY_BOUNDS.perNumberDailyLimit.max"
      :min="SMS_POLICY_BOUNDS.perNumberDailyLimit.min"
      description="Messages to one destination in a rolling day, counted strictly: a window we could not read is a window we do not send through."
      integer-label="A ceiling is a whole number of messages."
      label="Messages a day"
      :range-label="`Between ${SMS_POLICY_BOUNDS.perNumberDailyLimit.min} and ${SMS_POLICY_BOUNDS.perNumberDailyLimit.max}.`"
      suffix="messages"
      title="Change the per-number ceiling"
      @confirm="
        patch('perNumber', { perNumberDailyLimit: $event });
        notify('Per-number ceiling changed');
      "
    />

    <NumberDialog
      v-if="policy"
      v-model="ipDialog"
      :current="policy.perIpHourlyLimit"
      :max="SMS_POLICY_BOUNDS.perIpHourlyLimit.max"
      :min="SMS_POLICY_BOUNDS.perIpHourlyLimit.min"
      description="Requests from one address in a rolling hour. A request carrying no address is skipped rather than refused."
      integer-label="A ceiling is a whole number of requests."
      label="Requests an hour"
      :range-label="`Between ${SMS_POLICY_BOUNDS.perIpHourlyLimit.min} and ${SMS_POLICY_BOUNDS.perIpHourlyLimit.max}.`"
      suffix="requests"
      title="Change the per-address ceiling"
      @confirm="
        patch('perIp', { perIpHourlyLimit: $event });
        notify('Per-address ceiling changed');
      "
    />

    <NumberDialog
      v-if="policy"
      v-model="ratioDialog"
      :current="policy.maxSendsPerVerify"
      :max="SMS_POLICY_BOUNDS.maxSendsPerVerify.max"
      :min="SMS_POLICY_BOUNDS.maxSendsPerVerify.min"
      :description="`Sends the project may make for every code somebody actually enters, applied only above ${SMS_GUARD_CONSTANTS.ratioFloor} sends in a day. It throttles the project rather than one caller.`"
      integer-label="A ratio is a whole number of sends."
      label="Sends per code entered"
      :range-label="`Between ${SMS_POLICY_BOUNDS.maxSendsPerVerify.min} and ${SMS_POLICY_BOUNDS.maxSendsPerVerify.max}.`"
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
