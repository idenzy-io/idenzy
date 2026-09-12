<script setup lang="ts">
/**
 * One-time codes for the project, arranged the way `notes/methods-otp.md` asks: pick the
 * channel first, then read whether it can deliver, then decide what it may do.
 *
 * Three channels used to share one long settings surface, and they are not one thing.
 * A code by email needs a sending domain; a code by SMS needs a country allowlist, a
 * spend cap, a delivery account and something that can satisfy attestation; a link needs
 * a route of the customer's and the CORS allowlist that route's origin has to be on. So
 * each channel is a tab with its own readiness, its own prerequisites and its own
 * preview, and a switch is never the whole answer to "is this on".
 *
 * Readiness comes before enablement on purpose. What blocks a channel is mostly settled
 * on other screens, so every prerequisite row names the screen it is fixed on rather than
 * leaving somebody to reconcile four of them. The figures a user feels lead as well: how
 * long a code lasts, how many guesses it takes, what asking again does and what a send
 * costs. How the code is minted and stored is true and fixed and sits folded at the foot.
 *
 * Every control saves itself, as on the passwords screen: a switch or a list edit at
 * once, with its own busy state until the server has it. The channel's foot says what the
 * saved state means in a sentence, which is the summary the note asks a save to give.
 */
import { originOf } from "~/utils/origins";
import {
  CHANNELS,
  type ChannelId,
  CODE,
  type CodeChannel,
  channelBlockers,
  channelChecks,
  channelFacts,
  channelInfo,
  channelJourney,
  channelRule,
  channelSettings,
  channelState,
  channelSummary,
  humanizeSeconds,
  type MagicLinkSettings,
  measureSms,
  type OtpSetup,
  renderPreview,
  TEMPLATES,
} from "~/utils/otp";
import { CHECK_MARKS, CHECK_WORDS } from "~/utils/setup-check";
import { byoVendorInfo } from "~/utils/sms-providers";

const route = useRoute();
const router = useRouter();

const projects = useProjectStore();
const store = useOtpStore();
const smsPolicies = useSmsPolicyStore();
const smsProviders = useSmsProvidersStore();
const sendingDomains = useSendingDomainsStore();
const suppressions = useSuppressionsStore();
const origins = useOriginsStore();

/* The CORS allowlist is read from the management API over a cache, and this screen both
   reads it — a magic link lands on a page that then calls us — and writes to it. */
watch(
  () => projects.current.id,
  (id) => void origins.load(id),
  { immediate: true },
);

const saved = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));

/*
 * Which channel is showing, kept in the URL so a screen somebody is asked to look at can
 * be linked to. Replaced rather than pushed: moving between tabs is not navigation to
 * step back through.
 */
const channel = computed<ChannelId>(() => {
  const asked = route.query["channel"];
  const value = Array.isArray(asked) ? asked[0] : asked;
  return CHANNELS.some((entry) => entry.id === value) ? (value as ChannelId) : "email";
});

const tab = computed<string>({
  get: () => channel.value,
  set: (value) => {
    void router.replace({ query: { ...route.query, channel: value } });
  },
});

const tabs = computed(() =>
  CHANNELS.map((entry) => ({ value: entry.id, label: entry.label, icon: entry.icon })),
);

const info = computed(() => channelInfo(channel.value));
const current = computed(() => channelSettings(channel.value, saved.value));

/*
 * Everything the checks read, gathered once. It is all held by the panel already, so a
 * prerequisite answers the moment a setting on another screen changes rather than at the
 * moment somebody last asked.
 */
const setup = computed<OtpSetup>(() => {
  const projectId = projects.current.id;
  const domain = sendingDomains.sendingFor(projectId);
  const rows = suppressions.forProject(projectId);
  const account = smsProviders.accountFor(projectId);
  const vendor = account === null ? null : byoVendorInfo(account.vendor);

  return {
    settings: saved.value,
    sending:
      domain === null
        ? null
        : { domain: domain.domain, verified: domain.status === "verified", shared: domain.shared },
    suppressed: {
      email: rows.filter((row) => row.channel === "email").length,
      sms: rows.filter((row) => row.channel === "sms").length,
    },
    policy: smsPolicies.policyFor(projectId),
    spentToday: smsPolicies.spentToday(projectId),
    attestationWired: smsPolicies.attestationWired,
    delivery:
      smsProviders.modeFor(projectId) === "managed"
        ? { ready: true, label: "Sent through our own routing, which needs nothing of yours" }
        : account === null
          ? { ready: false, label: "Set to an account of yours with nothing wired" }
          : account.secretSet
            ? { ready: true, label: `Sent through your own ${vendor?.label ?? "carrier"} account` }
            : {
                ready: false,
                label: `Your own ${vendor?.label ?? "carrier"} account has no ${vendor?.secretLabel.toLowerCase() ?? "secret"} stored`,
              },
    allowedOrigins: origins.forProject(projectId).map((entry) => entry.origin),
  };
});

const loading = computed(
  () =>
    store.loading ||
    smsPolicies.loading ||
    smsProviders.loading ||
    sendingDomains.loading ||
    origins.loading,
);

const checks = computed(() => channelChecks(channel.value, setup.value));
const blockers = computed(() => checks.value.filter((check) => check.state === "fail"));
const state = computed(() => channelState(channel.value, setup.value));

/** Where "Complete setup" goes: the first thing that is blocking, on the screen that fixes it. */
const repair = computed(() => blockers.value[0] ?? null);

/*
 * What the header says about the whole method, because a reader on the email tab must not
 * have to open the SMS one to learn that it is on and sending nothing.
 */
const enabledChannels = computed(() =>
  CHANNELS.filter((entry) => entry.available && channelSettings(entry.id, saved.value).enabled),
);

const stuckChannels = computed(() =>
  enabledChannels.value.filter((entry) => channelBlockers(entry.id, setup.value).length > 0),
);

const pageState = computed(() => {
  if (enabledChannels.value.length === 0) {
    return { label: "No channel on", tone: "warning" as const };
  }
  if (stuckChannels.value.length === 1) {
    return { label: `${stuckChannels.value[0]?.label} needs setup`, tone: "warning" as const };
  }
  if (stuckChannels.value.length > 1) {
    return { label: `${stuckChannels.value.length} channels need setup`, tone: "warning" as const };
  }
  return {
    label:
      enabledChannels.value.length === 1
        ? "1 channel ready"
        : `${enabledChannels.value.length} channels ready`,
    tone: "success" as const,
  };
});

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

/** One field of the channel on show. The store merges it against what is saved when it lands. */
function setField(key: keyof CodeChannel, value: boolean) {
  if (current.value[key] === value) return;
  const field = { [key]: value } as Partial<CodeChannel>;
  void whileBusy(`${channel.value}.${key}`, () =>
    store.patch(
      projects.current.id,
      channel.value === "link"
        ? { magicLink: field }
        : channel.value === "sms"
          ? { sms: field }
          : { email: field },
    ),
  );
}

function setMagicLink(change: Partial<MagicLinkSettings>, key: string) {
  void whileBusy(`link.${key}`, () => store.patch(projects.current.id, { magicLink: change }));
}

/*
 * Return URLs. Each add and each removal is a write, and an add goes through a dialog
 * that checks the text as it is typed and offers the origin separately. The last one may
 * go: with none the method cannot start a link, and the checklist says so, which is the
 * honest state of a project that never set one up rather than a list held at one.
 */
const returnUrlDialog = ref(false);

function addReturnUrl(uri: string, allowOrigin: boolean) {
  const held = saved.value.magicLink.redirectUris;
  if (!held.includes(uri)) setMagicLink({ redirectUris: [...held, uri] }, "redirectUris");
  if (!allowOrigin) return;
  const origin = originOf(uri);
  if (origin === null) return;
  void whileBusy("link.origin", async () => {
    try {
      await origins.add(projects.current.id, origin, "magic_link");
    } catch {
      /* The checklist already says it: a return URL whose origin is not allowed shows as a
         gap with the consequence, so a refusal leaves the state on screen rather than
         announcing itself and vanishing. */
    }
  });
}

function removeReturnUrl(uri: string) {
  const redirectUris = saved.value.magicLink.redirectUris.filter((entry) => entry !== uri);
  setMagicLink({ redirectUris }, "redirectUris");
}

/*
 * What users receive, rendered from the built-in copy with the project's own name. The
 * SMS is priced because the two numbers do not move together: a long project name is the
 * one thing on this screen that can double the cost of every code.
 */
const emailSubject = computed(() =>
  renderPreview(TEMPLATES.emailOtpSubject, projects.current.name),
);
const smsBody = computed(() => renderPreview(TEMPLATES.smsOtpBody, projects.current.name));
const linkSubject = computed(() =>
  renderPreview(TEMPLATES.magicLinkSubject, projects.current.name),
);
const smsLength = computed(() => measureSms(smsBody.value));

const facts = computed(() => channelFacts(channel.value, smsLength.value));
const rule = computed(() => channelRule(channel.value));
const journey = computed(() => channelJourney(channel.value, saved.value));
const summary = computed(() => channelSummary(channel.value, setup.value));

/*
 * The figures. Method-wide rather than per channel, because what the store publishes is
 * what was sent rather than who signed in with what.
 */
const byChannel = computed(() => [
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

const totalSent = computed(() => byChannel.value.reduce((total, entry) => total + entry.count, 0));

const share = (count: number) =>
  totalSent.value === 0 ? 0 : Math.round((count / totalSent.value) * 100);

const smsEntered = computed(() =>
  stats.value.byChannel.sms === 0
    ? 0
    : Math.round((stats.value.smsVerified / stats.value.byChannel.sms) * 100),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const lifetime = humanizeSeconds(CODE.lifetimeSeconds);
const exchangeLifetime = humanizeSeconds(CODE.exchangeLifetimeSeconds);

/* Folded by default: how a code is made and kept, none of which anybody here can change. */
const advanced = ref(false);

const GUIDE_URL = "https://idenzy.dev/docs/otp";
const CHANNEL_GUIDES: Record<ChannelId, string> = {
  email: "https://idenzy.dev/docs/otp",
  sms: "https://idenzy.dev/docs/sms/fraud",
  link: "https://idenzy.dev/docs/magic-links",
  whatsapp: "https://idenzy.dev/docs/otp",
};
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="One-time codes">
      <template #badge>
        <StatusBadge v-if="!loading" :label="pageState.label" :tone="pageState.tone" />
      </template>
      <template #description>
        Passwordless sign-in on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>: a code by email or
        SMS typed into a form of yours, or a link that lands on a route of yours. Sign-in and
        sign-up are one flow. Changes save as you make them.
      </template>
      <template #actions>
        <v-btn
          :href="GUIDE_URL"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:menu-book-outline"
          rel="noopener"
          size="small"
          target="_blank"
          variant="outlined"
        >
          Integration guide
        </v-btn>
      </template>
    </PageHeader>

    <!-- The channel is the first decision, so it sits directly under the title. It scrolls
         sideways rather than wrapping, which keeps the chosen label whole at 320px. -->
    <div class="-mx-1 overflow-x-auto px-1 pb-1">
      <SegmentedControl v-model="tab" :options="tabs" label="Delivery channel" />
    </div>

    <LayerCard :padded="false" :description="info.blurb" :title="info.label">
      <template #badge>
        <StatusBadge v-if="!loading" :label="state.label" :tone="state.tone" />
      </template>
      <template v-if="info.available && current.enabled && repair" #actions>
        <v-btn
          v-if="repair?.fix"
          :to="repair.fix.to"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:build-outline"
          size="small"
          variant="outlined"
        >
          Complete setup
        </v-btn>
        <v-btn
          v-else
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="outlined"
          @click="returnUrlDialog = true"
        >
          Complete setup
        </v-btn>
      </template>

      <!-- WhatsApp: named, unavailable, and honest about what to use instead. -->
      <div v-if="!info.available" class="flex flex-col gap-4 p-5">
        <EmptyState
          description="The Cloud API sends pre-approved template messages rather than free text, so it is a provider and a template pipeline of its own rather than a switch on this screen. A start naming it is refused as unsupported until that lands. Use SMS codes today."
          icon="material-symbols:chat-outline"
          title="WhatsApp is not a channel yet"
        />
        <div class="flex justify-center">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:sms-outline"
            size="small"
            variant="outlined"
            @click="tab = 'sms'"
          >
            Set up SMS codes
          </v-btn>
        </div>
      </div>

      <template v-else>
        <!-- Eight columns of what this project decides, four of what a user receives. -->
        <div class="grid gap-x-6 gap-y-5 p-5 lg:grid-cols-3">
          <div class="flex min-w-0 flex-col lg:col-span-2">
            <div class="divide-y divide-line">
              <SettingRow label="Allow sign-in">
                <template #description>
                  People with an account can sign in with {{ info.noun }}. Off, start and verify
                  answer as though the channel did not exist, and the accounts already using it
                  are untouched.
                </template>
                <v-switch
                  :aria-label="`Allow sign-in with ${info.noun}`"
                  :disabled="isBusy(`${channel}.enabled`)"
                  :loading="isBusy(`${channel}.enabled`)"
                  :model-value="current.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="setField('enabled', $event === true)"
                />
              </SettingRow>

              <SettingRow :disabled="!current.enabled" label="Allow sign-up">
                <template #description>
                  Whether the same flow may create an account nobody has yet. On, verifying
                  creates it with the
                  {{ channel === "sms" ? "number" : "address" }} already verified, which is the
                  one place that word is fully earned. Off, the message is still sent and still
                  checked, and the refusal comes after a valid code rather than as a different
                  answer at the start, so the first call never says which
                  {{ channel === "sms" ? "numbers" : "addresses" }} are known.
                </template>
                <v-switch
                  :aria-label="`Allow sign-up with ${info.noun}`"
                  :disabled="!current.enabled || isBusy(`${channel}.allowSignUp`)"
                  :loading="isBusy(`${channel}.allowSignUp`)"
                  :model-value="current.allowSignUp"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  @update:model-value="setField('allowSignUp', $event === true)"
                />
              </SettingRow>

              <SettingRow
                v-if="channel === 'link'"
                description="Where a clicked link may land, matched exactly: the whole URL, no wildcards and no prefixes, because we render no page of our own and this list is the only thing between our redirect and an attacker's. A start naming a URL that is not here is refused, and the error never echoes the URL back."
                label="Return URLs (redirect URIs)"
              >
                <template #actions>
                  <v-btn
                    :loading="isBusy('link.redirectUris') || isBusy('link.origin')"
                    class="text-xs font-medium"
                    color="neutral"
                    prepend-icon="material-symbols:add"
                    size="small"
                    variant="text"
                    @click="returnUrlDialog = true"
                  >
                    Add return URL
                  </v-btn>
                </template>
                <template #detail>
                  <!-- Three columns on one grid rather than a flex row per URL, so every
                       host starts at the same x however long the scheme before it is. -->
                  <ul
                    v-if="saved.magicLink.redirectUris.length > 0"
                    class="m-0 list-none divide-y divide-line border-t border-line p-0"
                  >
                    <li
                      v-for="uri in saved.magicLink.redirectUris"
                      :key="uri"
                      class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 py-1.5"
                    >
                      <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
                        <Icon class="text-[15px] text-ink/45" name="material-symbols:link" />
                      </span>
                      <span class="truncate font-mono text-xs leading-4 text-ink">{{ uri }}</span>
                      <v-btn
                        :disabled="isBusy('link.redirectUris')"
                        class="text-xs font-medium"
                        color="neutral"
                        size="small"
                        variant="text"
                        @click="removeReturnUrl(uri)"
                      >
                        Remove
                      </v-btn>
                    </li>
                  </ul>
                  <p v-else class="m-0 border-t border-line pt-2 text-xs text-ink/45">
                    None yet, so no link can be started. The route your quickstart adds is the
                    usual first one.
                  </p>
                </template>
              </SettingRow>

              <!-- The one fixed rule an operator would otherwise ask support about. The
                   rest of what nobody can change is folded at the foot of the screen. -->
              <SettingRow
                v-if="rule"
                :description="rule.description"
                :fixed="rule.fixed"
                :label="rule.label"
              />
            </div>
          </div>

          <div class="flex min-w-0 flex-col gap-4">
            <SamplePanel title="What users receive">
              <template #meta>
                <span
                  v-if="channel === 'sms'"
                  :class="smsLength.segments > 1 ? 'text-warning' : 'text-ink/50'"
                  class="font-mono tabular-nums"
                >
                  {{ smsLength.segments }}
                  {{ smsLength.segments === 1 ? "segment" : "segments" }}
                </span>
                <NuxtLink
                  v-else
                  class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                  to="/email/templates"
                >
                  Edit template
                </NuxtLink>
              </template>
              <template #note>
                <template v-if="channel === 'email'">
                  The <span class="font-mono text-ink/70">email_otp</span> subject, with your
                  project's name in it. The body carries the code, how long it lasts and that it
                  works once.
                </template>
                <template v-else-if="channel === 'sms'">
                  The <span class="font-mono text-ink/70">sms_otp</span> body. No greeting, no
                  sign-off and no link, because every character is paid for on every send.
                </template>
                <template v-else>
                  The <span class="font-mono text-ink/70">magic_link</span> subject. The button is
                  the link, the text version carries it in full, and both say it works once.
                </template>
              </template>
              <SampleLine v-if="channel === 'email'" icon="material-symbols:mark-email-unread-outline">
                {{ emailSubject }}
              </SampleLine>
              <SampleLine v-else-if="channel === 'sms'" icon="material-symbols:sms-outline">
                {{ smsBody }}
              </SampleLine>
              <SampleLine v-else icon="material-symbols:mark-email-unread-outline">
                {{ linkSubject }}
              </SampleLine>
            </SamplePanel>

            <!-- The journey, because a reader deciding whether to turn this on is really
                 asking what their own code has to do. The last step follows the sign-up
                 switch above it. -->
            <section
              class="rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
            >
              <h3 class="m-0 text-xs font-medium text-ink">How a sign-in runs</h3>
              <ol class="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
                <li
                  v-for="(step, index) in journey"
                  :key="step"
                  class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5"
                >
                  <span
                    aria-hidden="true"
                    class="flex size-5 items-center justify-center rounded-full bg-ink/8 font-mono text-[10px] leading-none font-medium text-ink/70 tabular-nums"
                  >
                    {{ index + 1 }}
                  </span>
                  <span class="text-[11px] leading-4 text-ink/70">{{ step }}</span>
                </li>
              </ol>
            </section>
          </div>
        </div>

        <!-- What a user feels, ahead of anything about how a code is stored. -->
        <div class="grid gap-5 border-y border-line bg-ink/3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <LifetimeOutcome
            v-for="fact in facts"
            :key="fact.label"
            :label="fact.label"
            :note="fact.note"
            :tone="fact.tone ?? 'ink'"
            :unit="fact.unit"
            :value="fact.value"
          />
        </div>

        <!-- The prerequisites. Most of them are settled elsewhere, so every row names
             the screen that settles it. -->
        <div class="flex flex-col gap-3 px-5 py-5">
          <header class="flex min-w-0 flex-col gap-0.5">
            <h3 class="m-0 text-sm font-medium text-ink">Before a message reaches anybody</h3>
            <p class="m-0 text-xs text-ink/55">
              Read from this project's own configuration, so it answers the moment something
              changes on the screen that owns it.
            </p>
          </header>

          <ul class="m-0 list-none divide-y divide-line rounded-(--idenzy-radius) border border-line p-0">
            <li
              v-for="check in checks"
              :key="check.id"
              class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.25rem_11rem_minmax(0,1fr)]"
            >
              <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
                <Icon
                  :class="loading ? 'animate-spin text-ink/40' : CHECK_MARKS[check.state].tone"
                  :name="
                    loading ? 'material-symbols:progress-activity' : CHECK_MARKS[check.state].icon
                  "
                  class="text-base"
                />
              </span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs leading-4 font-medium text-ink">{{ check.label }}</span>
                <span :class="CHECK_MARKS[check.state].tone" class="text-[11px] leading-4">
                  {{ loading ? "Checking" : CHECK_WORDS[check.state] }}
                </span>
              </span>
              <span class="col-start-2 flex min-w-0 flex-col gap-1 sm:col-start-3">
                <span class="text-xs leading-5 text-ink/60">{{ check.finding }}</span>
                <NuxtLink
                  v-if="check.fix"
                  :to="check.fix.to"
                  class="inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
                >
                  {{ check.fix.label }}
                  <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
                </NuxtLink>
                <button
                  v-else-if="check.id === 'return-urls' && check.state !== 'pass'"
                  class="inline-flex w-fit cursor-pointer appearance-none items-center gap-0.5 border-0 bg-transparent p-0 text-[11px] font-medium text-ink hover:underline"
                  type="button"
                  @click="returnUrlDialog = true"
                >
                  Add return URL
                  <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
                </button>
              </span>
            </li>
          </ul>
        </div>

        <!-- What the saved state means, in the sentence a save would otherwise have to
             give, with the two places somebody goes next. -->
        <footer
          class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-line px-5 py-4"
        >
          <p class="m-0 min-w-0 flex-1 text-xs leading-5 text-ink/60">{{ summary }}</p>
          <div class="flex flex-none flex-wrap items-center gap-2">
            <v-btn
              v-if="channel !== 'sms'"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:mail-outline"
              size="small"
              to="/email/templates"
              variant="text"
            >
              Template
            </v-btn>
            <v-btn
              v-else
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:shield-outline"
              size="small"
              to="/sms/policy"
              variant="text"
            >
              Policy &amp; spend
            </v-btn>
            <v-btn
              :href="CHANNEL_GUIDES[channel]"
              append-icon="material-symbols:arrow-outward"
              class="text-xs font-medium"
              color="neutral"
              rel="noopener"
              size="small"
              target="_blank"
              variant="text"
            >
              Integration guide
            </v-btn>
          </div>
        </footer>
      </template>
    </LayerCard>

    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">One-time codes over 30 days</h2>
          <p class="m-0 text-xs text-ink/55">
            Every channel together. A message that was never opened still counts as sent.
          </p>
        </div>
        <p v-if="stats.byChannel.sms > 0" class="m-0 text-xs text-ink/55">
          <span class="font-mono text-ink tabular-nums">{{ smsEntered }}%</span>
          of SMS codes were entered
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistic
          :value="stats.signIns"
          description="Sessions begun with a code or a link."
          info="Sign-ups included: from the code's point of view they are the same proof."
          label="Sign-ins"
        />
        <Statistic
          :value="stats.codesSent"
          description="By email and SMS together."
          info="Codes sent. One that was never entered still counts, and still cost what it cost."
          label="Codes sent"
        />
        <Statistic
          :value="stats.linksSent"
          description="Magic links mailed."
          info="A link that was never clicked still counts."
          label="Links sent"
        />
        <Statistic
          :value="stats.refused"
          description="Verifications we would not take."
          info="A wrong code, a challenge that had expired, or the fifth attempt. The person can always ask for a new code."
          label="Refused"
          positive="down"
        />
      </div>

      <v-card border flat>
        <p class="m-0 border-b border-line px-4 py-2.5 text-xs font-medium text-ink">
          Sent by channel
        </p>
        <ul v-if="totalSent > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
          <li v-for="entry in byChannel" :key="entry.key" class="flex items-center gap-2.5">
            <Icon :name="entry.icon" aria-hidden="true" class="flex-none text-base text-ink/70" />
            <span class="w-24 flex-none truncate text-ink/80">{{ entry.name }}</span>
            <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
              <span
                :style="{ width: `${share(entry.count)}%` }"
                class="block h-full rounded-full bg-primary"
              />
            </span>
            <span class="w-14 flex-none text-right font-mono text-ink tabular-nums">
              {{ entry.count.toLocaleString("en") }}
            </span>
          </li>
        </ul>
        <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
          Nothing sent on this project yet.
        </p>
      </v-card>
    </section>

    <LayerCard
      v-model:open="advanced"
      description="How every code and link is minted, kept and spent. None of it is configurable, and each row says why."
      expandable
      title="How a code is handled"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="`Drawn one digit at a time from a cryptographic source, never a byte reduced modulo ten, which biases the low digits and is a real weakening of a code this short. The protocol accepts up to eight; a longer code buys little against a cap of ${CODE.attempts} attempts.`"
          :fixed="`${CODE.digits} digits`"
          label="Length"
        />
        <SettingRow
          :description="`Wrong guesses on one code before the challenge dies, whatever the clock says. A wrong guess is recorded even though the request fails: otherwise the cap never advances and the whole keyspace can be walked.`"
          :fixed="String(CODE.attempts)"
          label="Attempts"
        />
        <SettingRow
          description="Two verifications racing on one code end with one session, and the loser is told the challenge is invalid, which by then it is. The database decides that, not the application."
          fixed="Always"
          label="Single use"
        />
        <SettingRow
          description="Start answers the same way whether or not the address has an account, and that is not a pretence: an unknown address gets a real code. There is no branch to leak, which is a better answer than a branch carefully made to look the same."
          fixed="Always"
          label="Same answer for every address"
        />
        <SettingRow
          description="The message goes out only after the challenge row is committed. The other order can deliver a code for a challenge that rolled back, which is somebody staring at a valid-looking code that never works."
          fixed="Always"
          label="Sent after the challenge exists"
        />
        <SettingRow
          :description="`A six-digit code has a million possibilities, so a table of SHA-256 digests would fall to an offline sweep before the coffee did. It is stored as a memory-hard password hash instead, paid once per issue and at most ${CODE.attempts} times per challenge.`"
          :fixed="CODE.hash"
          label="Stored as"
        />
        <SettingRow
          description="Stored twice and never in clear: a digest for the live-code lookup, which has to be an index seek, and ciphertext under the project's own key for the read-back that creates the account. A read of the table yields no addresses, and this table is a list of who is signing in right now."
          fixed="Encrypted"
          label="The address"
        />
        <SettingRow
          description="Verify takes a challenge id and a code and no channel: the row knows what carried it, and a client that had to say could say something different. An SMS challenge resolved by the email flow would look a phone number up in the email column, miss, and create an account with a number stored as an address."
          fixed="From the row"
          label="Which channel"
        />
        <SettingRow
          :description="`A link's destination is checked against the return URLs when it is sent and stored with the token, so it cannot change between sending and clicking, and a bad token ends as JSON rather than a redirect anywhere. The code it hands your route lives ${exchangeLifetime}, which is one page load.`"
          fixed="At issue"
          label="A link's destination"
        />
        <SettingRow
          description="Our own exchange codes carry PKCE for OAuth and deliberately not here. A link is started in one browser and clicked in another, often a mail app's, so a verifier held by the starting browser would fail the normal case every time. Single use, a short life and the pinned destination carry this one."
          fixed="By design"
          label="No PKCE on a link"
        />
        <SettingRow
          :description="`Asking for a new code retires every earlier one for that address on that channel, so three presses of resend leave one code that works and not three. Each lasts ${lifetime} from the moment it is asked for.`"
          fixed="One live code"
          label="Asking again"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <MagicLinkRedirectDialog
      v-model="returnUrlDialog"
      :allowed-origins="setup.allowedOrigins"
      :redirect-uris="saved.magicLink.redirectUris"
      @confirm="addReturnUrl"
    />
  </div>
</template>
