<script setup lang="ts">
/**
 * One-time codes for the project: a code by email or SMS typed into the customer's own
 * form, or a link by email that lands on a route of theirs (PROJECT.md 4.7). Sign-in and
 * sign-up are one flow on every channel, because from the code's point of view they are
 * the same proof: someone read a message we sent to that address.
 *
 * What a project decides is small and the screen says so. Per channel it is the switch
 * and whether a code may create an account; for links it is also the routes a click may
 * land on, which is the only allowlist here because it is the only thing between our
 * redirect and somebody else's. The code itself is fixed by the server on purpose, and
 * the last card lists how, row by row, so the operator looking for "how many attempts"
 * finds the answer and the reason together.
 *
 * SMS is the one channel that costs money before it reaches anybody, and its fraud
 * controls are a policy with a screen of its own under SMS. This screen reads that
 * policy to say whether the channel can send at all, because a switch that says On over
 * a policy that sends nothing is the kind of state a support ticket is made of.
 *
 * Every control saves itself, as on the passwords screen: a switch or a list edit at
 * once, with its own busy state until the server has it. The figures on the side are
 * the method's own, and the channel breakdown counts what was sent, not who signed in.
 */
import {
  CODE,
  type CodeChannel,
  formatMoney,
  humanizeSeconds,
  type MagicLinkSettings,
  measureSms,
  renderPreview,
  SMS_LIMITS,
  TEMPLATES,
} from "~/utils/otp";
import { countryFlag, countryName } from "~/utils/sessions";
import { canSendSms } from "~/utils/sms-policy";

const projects = useProjectStore();
const store = useOtpStore();
const smsPolicies = useSmsPolicyStore();

const saved = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));
const policy = computed(() => smsPolicies.policyFor(projects.current.id));
const smsReady = computed(() => canSendSms(policy.value));
const spentToday = computed(() => smsPolicies.spentToday(projects.current.id));

/*
 * Which cards start unfolded. Email is the default channel and what most visits are
 * for, so it is open. SMS unfolds itself for a project that has it on but cannot send,
 * because the warning inside it is the one thing on the screen that needs doing.
 */
const expanded = reactive({ email: true, sms: false, link: false, code: false });

watch(
  () => (store.loading || smsPolicies.loading ? null : saved.value.sms.enabled && !smsReady.value),
  (stuck) => {
    if (stuck === true) expanded.sms = true;
  },
  { immediate: true },
);

/* The fields on their way to the server, so each control can show its own wait. */
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

/** One field of one code channel. The store merges it against what is saved when it lands. */
function setChannel<K extends keyof CodeChannel>(
  channel: "email" | "sms",
  key: K,
  value: CodeChannel[K],
) {
  if (saved.value[channel][key] === value) return;
  void whileBusy(`${channel}.${key}`, () =>
    store.patch(projects.current.id, { [channel]: { [key]: value } }),
  );
}

function setMagicLink(change: Partial<MagicLinkSettings>, key: string) {
  void whileBusy(`link.${key}`, () => store.patch(projects.current.id, { magicLink: change }));
}

/*
 * Redirect URIs. Each add and each removal is a write, and an add goes through a
 * dialog that checks the text as it is typed. The last one may go: with none the method
 * cannot start a link, and the badge says so, which is the honest state of a project
 * that never set one up rather than a list held at one for its own sake.
 */
const redirectDialog = ref(false);

function addRedirectUri(uri: string) {
  const current = saved.value.magicLink.redirectUris;
  if (current.includes(uri)) return;
  setMagicLink({ redirectUris: [...current, uri] }, "redirectUris");
}

function removeRedirectUri(uri: string) {
  const redirectUris = saved.value.magicLink.redirectUris.filter((entry) => entry !== uri);
  setMagicLink({ redirectUris }, "redirectUris");
}

/*
 * What each channel says about itself: the word in the badge, and why.
 */
const smsBadge = computed(() => {
  if (!saved.value.sms.enabled) return { label: "Off", tone: "neutral" as const };
  if (!smsReady.value) return { label: "Sends nothing", tone: "warning" as const };
  return { label: "On", tone: "success" as const };
});

const linkBadge = computed(() => {
  if (!saved.value.magicLink.enabled) return { label: "Off", tone: "neutral" as const };
  if (saved.value.magicLink.redirectUris.length === 0) {
    return { label: "No destination", tone: "warning" as const };
  }
  return { label: "On", tone: "success" as const };
});

/* The SMS policy, as the rows that summarise it read it. */
const countries = computed(() =>
  (policy.value?.allowedCountries ?? []).map((code) => ({
    code,
    name: countryName(code) ?? code,
    flag: countryFlag(code),
  })),
);

const spendLine = computed(() => {
  const current = policy.value;
  if (current === null) return "";
  return `${formatMoney(spentToday.value, current.currency)} of ${formatMoney(current.dailySpendCap, current.currency)}`;
});

const spendShare = computed(() => {
  const current = policy.value;
  if (current === null || current.dailySpendCap <= 0) return 0;
  return Math.min(100, Math.round((spentToday.value / current.dailySpendCap) * 100));
});

/*
 * What users receive, rendered from the built-in copy with the project's own name. The
 * SMS is priced because the two numbers do not move together: a long project name is
 * the one thing on this screen that can double the cost of every code.
 */
const emailSubject = computed(() =>
  renderPreview(TEMPLATES.emailOtpSubject, projects.current.name),
);
const smsBody = computed(() => renderPreview(TEMPLATES.smsOtpBody, projects.current.name));
const smsLength = computed(() => measureSms(smsBody.value));
const smsLimit = computed(() =>
  smsLength.value.encoding === "gsm-7" ? SMS_LIMITS.gsm7.single : SMS_LIMITS.ucs2.single,
);
const linkSubject = computed(() =>
  renderPreview(TEMPLATES.magicLinkSubject, projects.current.name),
);

const lifetime = humanizeSeconds(CODE.lifetimeSeconds);
const linkLifetime = humanizeSeconds(CODE.linkLifetimeSeconds);
const exchangeLifetime = humanizeSeconds(CODE.exchangeLifetimeSeconds);

/*
 * The figures.
 */
const channels = computed(() => [
  {
    key: "email",
    name: "Email codes",
    icon: "material-symbols:mail-outline",
    count: stats.value.byChannel.email,
  },
  {
    key: "sms",
    name: "SMS codes",
    icon: "material-symbols:sms-outline",
    count: stats.value.byChannel.sms,
  },
  {
    key: "link",
    name: "Magic links",
    icon: "material-symbols:link",
    count: stats.value.byChannel.magicLink,
  },
]);

const totalSent = computed(() => channels.value.reduce((total, entry) => total + entry.count, 0));

const share = (count: number) =>
  totalSent.value === 0 ? 0 : Math.round((count / totalSent.value) * 100);

const smsEntered = computed(() =>
  stats.value.byChannel.sms === 0
    ? 0
    : Math.round((stats.value.smsVerified / stats.value.byChannel.sms) * 100),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES = [
  {
    icon: "material-symbols:pin",
    title: "One-time codes, end to end",
    detail: "startEmail, startSms and verify: one flow for sign-in and sign-up.",
    href: "https://idenzy.dev/docs/otp",
  },
  {
    icon: "material-symbols:link",
    title: "Magic links and the confirmation route",
    detail: "What your route does with the code, and why the click is yours.",
    href: "https://idenzy.dev/docs/magic-links",
  },
  {
    icon: "material-symbols:shield-outline",
    title: "SMS fraud controls",
    detail: "The country allowlist, the human check and the spend cap.",
    href: "https://idenzy.dev/docs/sms/fraud",
  },
  {
    icon: "material-symbols:mail-outline",
    title: "Email and SMS templates",
    detail: "The variables the copy may use, and what a segment costs.",
    href: "https://idenzy.dev/docs/templates",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:pin" title="One-time codes">
      <template #description>
        Passwordless sign-in on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>: a code by
        email or SMS typed into your own form, or a link that lands on a route of yours.
        Sign-in and sign-up are one flow. Changes save as you make them.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.email"
          expandable
          description="The default passwordless method, and the one with no cost per send beyond the email itself."
          title="Email codes"
        >
          <template #badge>
            <StatusBadge
              :label="saved.email.enabled ? 'On' : 'Off'"
              :tone="saved.email.enabled ? 'success' : 'neutral'"
            />
          </template>
          <div class="divide-y divide-line">
            <SettingRow
              description="Users ask for a code at an address and type it into your form. Off, start and verify answer as if the method did not exist, and nothing about the accounts changes."
              label="Enabled"
            >
              <v-switch
                :disabled="isBusy('email.enabled')"
                :loading="isBusy('email.enabled')"
                :model-value="saved.email.enabled"
                aria-label="Email codes"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setChannel('email', 'enabled', $event === true)"
              />
            </SettingRow>
            <SettingRow
              :disabled="!saved.email.enabled"
              description="An address with no account gets a real code, and entering it creates the account with the address already verified, which is the one place that word is fully earned. Off, the code is still sent and still checked, and the refusal comes after a valid code rather than as a different answer at the start, so nobody learns from the first call whether an address is known."
              label="Sign-up by code"
            >
              <v-switch
                :disabled="!saved.email.enabled || isBusy('email.allowSignUp')"
                :loading="isBusy('email.allowSignUp')"
                :model-value="saved.email.allowSignUp"
                aria-label="Sign-up by email code"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setChannel('email', 'allowSignUp', $event === true)"
              />
            </SettingRow>
            <SettingRow
              description="Start answers 202 and a challenge id whether or not the address has an account, and that is not a pretence: an unknown address gets a real code. There is no branch to leak, which is a better answer than a branch carefully made to look the same."
              fixed="Always"
              label="Same answer for every address"
            />
            <SettingRow
              description="The code is sent only after its row is committed. The other order can deliver a code for a challenge that rolled back, which is a person staring at a valid-looking code that never works."
              fixed="Always"
              label="Sent after the challenge exists"
            />
          </div>

          <SamplePanel class="mt-5" title="What users receive">
            <template #meta>
              <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/email/templates">
                Email templates
              </NuxtLink>
            </template>
            <template #note>
              The <span class="font-mono text-ink/70">email_otp</span> template with your project's
              name in it. The body carries the code, how long it lasts, and that it works once.
            </template>
            <SampleLine icon="material-symbols:mark-email-unread-outline">{{ emailSubject }}</SampleLine>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.sms"
          expandable
          description="The same code by text message. The one channel that costs money before it reaches anybody, so everything about sending it is stricter and lives under SMS."
          title="SMS codes"
        >
          <template #badge>
            <StatusBadge :label="smsBadge.label" :tone="smsBadge.tone" />
          </template>

          <div
            v-if="!smsReady"
            class="mb-5 flex items-start gap-3 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-4 py-3"
          >
            <Icon aria-hidden="true" class="mt-px flex-none text-base text-warning" name="material-symbols:warning-outline" />
            <div class="flex flex-col gap-0.5 text-xs">
              <p class="m-0 font-medium text-ink">
                {{ policy === null ? "No SMS policy yet" : "No country allowed yet" }}
              </p>
              <p class="m-0 leading-5 text-ink/70">
                Every SMS start is refused with
                <span class="font-mono text-ink/80">country_not_allowed</span> until at least one
                country is allowed under
                <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/sms/policy">Policy &amp; spend</NuxtLink>.
                A project nobody has configured does not start spending on the strength of a
                request asking it to, and the refusal costs nothing.
              </p>
            </div>
          </div>

          <div class="divide-y divide-line">
            <SettingRow label="Enabled">
              <template #description>
                Users ask for a code at a phone number and type it into your form. Off, the
                channel answers as if it did not exist.
                <span v-if="saved.sms.enabled && !smsReady" class="text-warning">
                  On, and sending nothing until the policy allows a country.
                </span>
              </template>
              <v-switch
                :disabled="isBusy('sms.enabled')"
                :loading="isBusy('sms.enabled')"
                :model-value="saved.sms.enabled"
                aria-label="SMS codes"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setChannel('sms', 'enabled', $event === true)"
              />
            </SettingRow>
            <SettingRow
              :disabled="!saved.sms.enabled"
              description="A number with no account gets a real code, and entering it creates the account with the number verified. Off, the code is still sent and the refusal comes after a valid one, for the reason the email row gives. Off also means every send to an unknown number is paid for and refused, so a project that only signs in existing users may want the human check on as well."
              label="Sign-up by code"
            >
              <v-switch
                :disabled="!saved.sms.enabled || isBusy('sms.allowSignUp')"
                :loading="isBusy('sms.allowSignUp')"
                :model-value="saved.sms.allowSignUp"
                aria-label="Sign-up by SMS code"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setChannel('sms', 'allowSignUp', $event === true)"
              />
            </SettingRow>
            <SettingRow
              description="Default deny, by ISO country. The number is placed with the carrier's own metadata, so allowing the United States does not admit every range on +1, and a number that cannot be placed is refused: an allowlist that admits what it could not identify is not one."
              label="Countries"
            >
              <template #actions>
                <span v-if="countries.length > 0" class="flex items-center gap-1.5 text-xs text-ink/60">
                  <span aria-hidden="true" class="flex items-center gap-0.5 text-sm leading-none">
                    <span v-for="country in countries.slice(0, 5)" :key="country.code" :title="country.name">{{ country.flag ?? country.code }}</span>
                  </span>
                  <span class="font-mono tabular-nums">
                    {{ countries.length }} {{ countries.length === 1 ? "country" : "countries" }}
                  </span>
                </span>
                <span v-else class="text-xs text-warning">None</span>
                <v-btn
                  append-icon="material-symbols:arrow-outward"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  to="/sms/policy"
                  variant="text"
                >
                  Policy &amp; spend
                </v-btn>
              </template>
            </SettingRow>
            <SettingRow
              description="A CAPTCHA or an app attestation, checked before any counter is touched, so a caller who has not proved they are human cannot burn a real user's daily allowance by naming their number. The SDK takes the token per call. Requiring it with no verifier wired on the deployment refuses every send, which is the intended failure."
              label="Human check before a send"
            >
              <template #actions>
                <span
                  v-if="policy !== null"
                  :class="policy.attestationRequired ? 'text-ink/60' : 'text-warning'"
                  class="text-xs"
                >
                  {{ policy.attestationRequired ? "Required" : "Not required" }}
                </span>
                <span v-else class="text-xs text-ink/40">No policy</span>
              </template>
            </SettingRow>
            <SettingRow
              description="A hard stop in Postgres, not an alert: the check and the increment are one statement, so two sends that each fit under the cap cannot both pass. A send that timed out still stands against the day, because the message usually went out."
              label="Daily spend cap"
            >
              <template #actions>
                <span v-if="policy !== null" class="font-mono text-xs text-ink/60 tabular-nums">{{ spendLine }} today</span>
                <span v-else class="text-xs text-ink/40">No policy</span>
              </template>
              <template v-if="policy !== null" #detail>
                <span class="block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-ink/8">
                  <span
                    :class="spendShare >= 90 ? 'bg-warning' : 'bg-primary'"
                    :style="{ width: `${spendShare}%` }"
                    class="block h-full rounded-full"
                  />
                </span>
              </template>
            </SettingRow>
            <SettingRow
              description="Premium-rate ranges are refused first, then the human check, then the per-number and per-IP ceilings, the thousand-block sweep detector and the send-to-verify ratio, each set under Policy & spend. A failed send is never retried: the spend is already reserved and a timeout is the case where the message usually went. Every counter is strict, so one we cannot read refuses rather than sends."
              fixed="Always"
              label="Refused before it costs anything"
            />
            <SettingRow
              description="Roughly a tenth of the price of an SMS in most regions, and already a name in the SDK's channel enum. The Cloud API sends pre-approved template messages rather than free text, so it is a provider and a template pipeline of its own; a start naming it is refused as unsupported until that lands."
              fixed="Not yet"
              label="WhatsApp"
            />
          </div>

          <SamplePanel class="mt-5" title="What users receive">
            <template #meta>
              <span
                :class="smsLength.segments > 1 ? 'text-warning' : 'text-ink/50'"
                class="font-mono tabular-nums"
              >
                {{ smsLength.segments }} {{ smsLength.segments === 1 ? "segment" : "segments" }}
                · {{ smsLength.units }} of {{ smsLimit }} · {{ smsLength.encoding === "gsm-7" ? "GSM-7" : "UCS-2" }}
              </span>
            </template>
            <template #note>
              The <span class="font-mono text-ink/70">sms_otp</span> template. No greeting, no
              sign-off and no link, because every character is paid for on every send: the second
              segment costs as much as the first, and one character outside GSM-7 drops the limit
              from 160 to 70.
            </template>
            <SampleLine icon="material-symbols:sms-outline">{{ smsBody }}</SampleLine>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.link"
          expandable
          description="A link by email in place of a code. It points at our API; clicking it sends the browser to a route of yours carrying a single-use code the SDK exchanges for a session. Nothing of ours renders."
          title="Magic links"
        >
          <template #badge>
            <StatusBadge :label="linkBadge.label" :tone="linkBadge.tone" />
          </template>
          <div class="divide-y divide-line">
            <SettingRow label="Enabled">
              <template #description>
                Users ask for a link at an address and click it in their mail. Like a code, an
                address with no account gets one when the link is followed, verified.
                <span v-if="saved.magicLink.enabled && saved.magicLink.redirectUris.length === 0" class="text-warning">
                  On, and nothing works until a redirect URI is registered below.
                </span>
              </template>
              <v-switch
                :disabled="isBusy('link.enabled')"
                :loading="isBusy('link.enabled')"
                :model-value="saved.magicLink.enabled"
                aria-label="Magic links"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setMagicLink({ enabled: $event === true }, 'enabled')"
              />
            </SettingRow>
            <SettingRow
              description="Where a clicked link may land, matched exactly: the whole URL, no wildcards and no prefixes, because we render no page of our own and this list is the only thing standing between our redirect and an attacker's. A start naming a URL that is not here is refused, and the error never echoes the URL back."
              label="Redirect URIs"
            >
              <template #actions>
                <v-btn
                  :loading="isBusy('link.redirectUris')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:add"
                  size="small"
                  variant="text"
                  @click="redirectDialog = true"
                >
                  Add redirect URI
                </v-btn>
              </template>
              <template #detail>
                <ul v-if="saved.magicLink.redirectUris.length > 0" class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                  <li
                    v-for="uri in saved.magicLink.redirectUris"
                    :key="uri"
                    class="flex items-center gap-2 rounded-(--idenzy-radius-x-small) border border-line bg-canvas py-1 pr-1 pl-2.5"
                  >
                    <Icon aria-hidden="true" class="flex-none text-sm text-ink/45" name="material-symbols:link" />
                    <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{{ uri }}</span>
                    <v-tooltip :text="`Remove ${uri}`" location="top">
                      <template #activator="{ props: tip }">
                        <span v-bind="tip">
                          <button
                            :aria-label="`Remove ${uri}`"
                            :disabled="isBusy('link.redirectUris')"
                            class="inline-flex size-6 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/50 transition-colors duration-150 hover:bg-ink/6 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                            type="button"
                            @click="removeRedirectUri(uri)"
                          >
                            <Icon aria-hidden="true" class="text-sm" name="material-symbols:close" />
                          </button>
                        </span>
                      </template>
                    </v-tooltip>
                  </li>
                </ul>
                <p v-else class="m-0 mt-1 text-[11px] text-ink/50">
                  None yet. The route your quickstart adds is the usual first one.
                </p>
              </template>
            </SettingRow>
            <SettingRow
              description="Mail scanners follow links, so the link is not the sign-in. Clicking it spends the link and lands on your route with a code in the query; the exchange that produces a session is a POST your page makes, and the confirmation click belongs on your route, because only you can make it look like your product."
              fixed="Your route"
              label="The confirmation step"
            />
            <SettingRow
              :description="`The link works for ${linkLifetime} and once, and the code it hands your route lives ${exchangeLifetime}, which is one page load. Asking again does not revoke an earlier link; it simply expires.`"
              fixed="Deployment"
              label="Lifetime"
            />
            <SettingRow
              description="The destination is checked against the list when the link is sent and stored with the token, so it cannot be changed between sending and clicking, and a bad token ends as JSON rather than a redirect anywhere: an error that could redirect is the open redirect this design exists to avoid."
              fixed="At issue"
              label="Destination pinned"
            />
            <SettingRow
              description="Our own exchange codes carry PKCE for OAuth and deliberately not here. A link is started in one browser and clicked in another, often a mail app's, so a verifier held by the starting browser would fail the normal case every time. Single use, a short life and the pinned destination carry this one instead."
              fixed="By design"
              label="No PKCE"
            />
          </div>

          <SamplePanel class="mt-5" title="What users receive">
            <template #meta>
              <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/email/templates">
                Email templates
              </NuxtLink>
            </template>
            <template #note>
              The <span class="font-mono text-ink/70">magic_link</span> template. The button is
              the link, the text version carries it in full, and both say it works once.
            </template>
            <SampleLine icon="material-symbols:mark-email-unread-outline">{{ linkSubject }}</SampleLine>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.code"
          expandable
          description="How every code is minted, kept and spent, on either channel. None of it is configurable, and each row says why."
          title="Every code"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :description="`Drawn one digit at a time from a cryptographic source, never a byte reduced modulo ten, which biases the low digits and is a real weakening of a code this short. The protocol accepts up to eight; a longer code buys little against a cap of ${CODE.attempts} attempts.`"
              :fixed="`${CODE.digits} digits`"
              label="Length"
            />
            <SettingRow
              :description="`Set for the deployment and capped at an hour. ${lifetime} is short enough that a code in a mailbox somebody else can read is usually already dead, and long enough to survive a slow mail hop. The message says how long it lasts.`"
              :fixed="lifetime"
              label="Lifetime"
            />
            <SettingRow
              :description="`Wrong guesses on one code before the challenge dies, whatever the clock says. Counted in SQL rather than read and written back, so five guesses in parallel cost five, and a wrong guess is recorded even though the request fails: otherwise the cap never advances and the whole keyspace can be walked.`"
              :fixed="String(CODE.attempts)"
              label="Attempts"
            />
            <SettingRow
              description="Asking for a new code retires every earlier one for that address on that channel, so three presses of resend leave one code that works and not three."
              fixed="One live code"
              label="Asking again"
            />
            <SettingRow
              description="Decided by the database, not the application: two verifications racing on one code, and the loser is told the challenge is invalid, which by then it is. A code cannot mint two sessions."
              fixed="Always"
              label="Single use"
            />
            <SettingRow
              :description="`A six-digit code has a million possibilities. A table of SHA-256 digests would fall to an offline sweep before the coffee did, so the code is stored as a memory-hard password hash that makes the sweep cost real money, paid once per issue and at most ${CODE.attempts} times per challenge. The random tokens elsewhere are SHA-256, because there is nothing to sweep.`"
              :fixed="CODE.hash"
              label="Stored as"
            />
            <SettingRow
              description="Stored twice and never in clear: a digest for the &quot;is there already a live code&quot; lookup, which has to be an index seek, and ciphertext under the project's own key for the read-back that creates the account. A read of the table yields no addresses, and an OTP table is a list of who is signing in right now."
              fixed="Encrypted"
              label="The address"
            />
            <SettingRow
              description="Verify takes a challenge id and a code and no channel: the row knows what carried it, and a client that had to say could say something different. An SMS challenge resolved by the email flow would look a phone number up in the email column, miss, and create an account with a number stored as an address, on a code the caller had every right to present."
              fixed="From the row"
              label="Which channel"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">One-time codes</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="29" :series="stats.signInsDaily" :value="stats.signIns" info="Sessions begun with a code or a link, sign-ups included." label="Sign-ins" />
          <UsageTile :seed="31" :series="stats.codesSentDaily" :value="stats.codesSent" info="Codes sent by email and SMS together. A code that was never entered still counts." label="Codes sent" />
          <UsageTile :seed="37" :series="stats.linksSentDaily" :value="stats.linksSent" info="Magic links mailed. A link that was never clicked still counts." label="Links sent" />
          <UsageTile :seed="41" :series="stats.refusedDaily" :value="stats.refused" info="Verifications refused: a wrong code, a challenge that had expired, or the fifth attempt. The person can always ask for a new code." label="Refused" />
        </div>

        <LayerCard :padded="false" description="By what carried each message." title="Sent by channel">
          <ul v-if="totalSent > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="entry in channels" :key="entry.key" class="flex items-center gap-2.5">
              <Icon :name="entry.icon" aria-hidden="true" class="flex-none text-base text-ink/70" />
              <span class="w-24 flex-none truncate text-ink/80">{{ entry.name }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span :style="{ width: `${share(entry.count)}%` }" class="block h-full rounded-full bg-primary" />
              </span>
              <span class="w-12 flex-none text-right font-mono text-ink tabular-nums">{{ entry.count.toLocaleString("en") }}</span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            Nothing sent on this project yet.
          </p>
          <div
            v-if="stats.byChannel.sms > 0"
            class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink/55"
          >
            <span>
              <span class="font-mono text-ink tabular-nums">{{ smsEntered }}%</span> of SMS codes entered
            </span>
            <v-tooltip
              location="top"
              max-width="260"
              text="Codes sent against codes typed in. A scheme that has beaten every other control still cannot make anybody enter the code, so a ratio that falls is the signal that throttles the project."
            >
              <template #activator="{ props: tip }">
                <Icon v-bind="tip" aria-label="What the ratio means" class="flex-none text-sm text-ink/40" name="material-symbols:info-outline" role="img" />
              </template>
            </v-tooltip>
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
                <Icon :name="guide.icon" aria-hidden="true" class="mt-px flex-none text-xl text-ink/70" />
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

    <MagicLinkRedirectDialog
      v-model="redirectDialog"
      :redirect-uris="saved.magicLink.redirectUris"
      @confirm="addRedirectUri"
    />
  </div>
</template>
