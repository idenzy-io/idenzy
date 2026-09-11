<script setup lang="ts">
/**
 * Social sign-in for the project, arranged as an integration rather than a settings page:
 * what is blocking, the providers and what state each is actually in, where a finished
 * sign-in comes back to, whether the whole thing works, and the one rule that decides
 * whether a provider sign-in joins an account somebody already has (PROJECT.md 4.6).
 *
 * The screen's whole argument is that configured and working are different questions. A
 * provider can be off, missing a field, running on our shared app, complete but never
 * tested, or taking sign-ins, and a row that answered all five with "On" would hide the
 * four that explain why nobody can sign in. So each row leads with one of those states
 * and carries the action that settles it, and the project-wide half of the answer, which
 * is mostly on other screens, is a check card of its own.
 *
 * The catalogue is not on this page. Adding a provider is a walk through four things and
 * two of them are different URLs both called a redirect, so it is a workspace opened from
 * the header rather than a grid somebody scrolls past on every visit.
 *
 * Every control saves itself, as on the passwords and passkeys screens: a switch writes
 * the moment it is changed and shows its own wait, and credentials are written as one
 * record from the workspace, because a provider half saved fails at the token endpoint.
 * The client secret is never read back, here or anywhere: the panel is told only that one
 * is stored and when it was written.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import { originOf } from "~/utils/origins";
import {
  AVAILABLE_PROVIDERS,
  callbackShape,
  callbackUri,
  evaluateProviderSetup,
  FLOW,
  INSTANT_HOSTS,
  LINKING_ERROR,
  linkingExamples,
  PROVIDERS,
  type ProviderConfig,
  type ProviderInfo,
  type ProviderName,
  providerBlockers,
  providerInfo,
  readinessOf,
  returnUrisMissingOrigin,
} from "~/utils/providers";

const projects = useProjectStore();
const store = useProvidersStore();
const origins = useOriginsStore();
const { copy } = useClipboard({ legacy: true });

/**
 * Where the provider returns the browser to. It is our host and not the customer's, and
 * it comes from runtime configuration so a deployment on another host says so. The
 * fallback is the shared API host, which is where a project without a custom auth domain
 * lives anyway.
 */
const runtime = useRuntimeConfig();
const apiBase = computed(() => runtime.public.authApiBaseUrl || "https://api.idenzy.io");

const linking = computed(() => store.linkingFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));
const returnUris = computed(() => store.returnUrisFor(projects.current.id));
const allowedOrigins = computed(() =>
  origins.forProject(projects.current.id).map((entry) => entry.origin),
);

/** The project's providers in the catalogue's order, so the list does not reshuffle. */
const configured = computed(() => {
  const project = store.forProject(projects.current.id);
  const entries: { info: ProviderInfo; config: ProviderConfig }[] = [];
  for (const info of PROVIDERS) {
    const config = project[info.id];
    if (config !== undefined) entries.push({ info, config });
  }
  return entries;
});

/*
 * Whether the method works, which is a project-wide question. The inputs are read from
 * the stores that own them, so an answer here changes the moment a setting does on the
 * screen that owns it.
 */
const setup = computed(() => ({
  providers: configured.value,
  returnUris: returnUris.value,
  allowedOrigins: allowedOrigins.value,
}));

const loading = computed(() => store.loading || origins.loading);
const blockers = computed(() => (loading.value ? [] : providerBlockers(setup.value)));
const checks = computed(() => evaluateProviderSetup(setup.value));

/*
 * The check card's own button. The checks are pure and read what the panel already holds,
 * so this is a re-read with a visible wait rather than a request: a reader who has just
 * changed a setting on another screen wants to watch this answer change.
 */
const testing = ref(false);

async function runChecks() {
  testing.value = true;
  await new Promise((resolve) => setTimeout(resolve, 700));
  testing.value = false;
}

/** What the header says about the whole method, in one word and its tone. */
const state = computed<{ label: string; tone: BadgeTone }>(() => {
  if (loading.value) return { label: "Loading", tone: "neutral" };
  if (configured.value.length === 0) return { label: "Not set up", tone: "neutral" };
  if (blockers.value.length > 0) return { label: "Setup incomplete", tone: "warning" };
  const live = configured.value.filter(
    (entry) => readinessOf(entry.info, entry.config) === "ready",
  ).length;
  return live > 0
    ? { label: `${live} ready`, tone: "success" }
    : { label: "Not tested", tone: "neutral" };
});

/* Sign-ins per provider over the window, for each row's figure. */
const signInsBy = computed(() => {
  const counts = new Map<ProviderName, number>();
  for (const entry of stats.value.byProvider) counts.set(entry.id, entry.count);
  return counts;
});

/* The two reference cards, folded. Each one carries its state in the strip so nothing
   has to be opened to read it. */
const expanded = reactive({ linking: false, flow: false });

/* The things on their way to the server, so each control can show its own wait. */
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

function setEnabled(id: ProviderName, enabled: boolean) {
  void whileBusy(id, () => store.patch(projects.current.id, id, { enabled }));
}

function setAutoLink(autoLink: boolean) {
  if (autoLink === linking.value.autoLink) return;
  void whileBusy("linking", () => store.setLinking(projects.current.id, { autoLink }));
}

/*
 * The setup workspace. Which provider it is about and which step it opens on are held
 * here rather than passed down, so the dialog keeps its subject while it closes.
 */
const setupOpen = ref(false);
const editing = ref<ProviderName | null>(null);
const startAt = ref<"" | "credentials" | "return" | "test">("");

function addProvider() {
  editing.value = null;
  startAt.value = "";
  setupOpen.value = true;
}

/** Manage opens where the row's own button points: at the gap, or at the test. */
function manage(info: ProviderInfo, config: ProviderConfig) {
  editing.value = info.id;
  startAt.value = readinessOf(info, config) === "untested" ? "test" : "credentials";
  setupOpen.value = true;
}

/** The same, from a blocker that names its provider in its id. */
function manageById(blockerId: string) {
  const id = blockerId.replace("broken-", "") as ProviderName;
  const entry = configured.value.find((held) => held.info.id === id);
  if (entry) manage(entry.info, entry.config);
}

/*
 * Removal, which is a different thing from switching a provider off.
 */
const removing = ref<ProviderName | null>(null);
const removeOpen = ref(false);

const removingInfo = computed(() => (removing.value ? providerInfo(removing.value) : null));
const stranded = computed(() =>
  removing.value ? store.strandedBy(projects.current.id, removing.value) : 0,
);

function askRemoval(id: ProviderName) {
  removing.value = id;
  removeOpen.value = true;
}

function confirmRemoval() {
  const id = removing.value;
  if (id === null) return;
  void whileBusy(id, () => store.remove(projects.current.id, id));
}

function copyCallback(id: ProviderName) {
  void copy(callbackUri(apiBase.value, id));
}

/* A dialog belongs to the project it was opened from, so a switch underneath closes it
   rather than writing this project's credentials into the next one. */
watch(
  () => projects.current.id,
  () => {
    setupOpen.value = false;
    removeOpen.value = false;
    editing.value = null;
    removing.value = null;
  },
);

/*
 * The return URLs, which belong to the project and are shared by every provider on it.
 */
const returnUrlDialog = ref(false);

async function addReturnUrl(uri: string, allowOrigin: boolean) {
  await whileBusy("return", async () => {
    await store.addReturnUri(projects.current.id, uri);
    if (!allowOrigin) return;
    const origin = originOf(uri);
    if (origin !== null) await origins.add(projects.current.id, origin, "oauth");
  });
}

function removeReturnUrl(uri: string) {
  void whileBusy("return", () => store.removeReturnUri(projects.current.id, uri));
}

/**
 * Whether this URL's page could not read a credentialed response. The same rule the
 * check card uses, so a native scheme and a loopback host are not reported as gaps: one
 * has no origin at all and the other is refused by the allowlist whatever anybody does.
 */
function originGap(uri: string): boolean {
  return returnUrisMissingOrigin([uri], allowedOrigins.value).length > 0;
}

/*
 * Account linking, which is the one project-wide decision here and the one most often
 * misread. The examples move with the switch, because half of what they say does.
 */
const examples = computed(() => linkingExamples(linking.value.autoLink));

const EXAMPLE_MARKS = {
  join: { icon: "material-symbols:join-inner", tone: "text-success" },
  verify: { icon: "material-symbols:mark-email-read-outline", tone: "text-warning" },
  new: { icon: "material-symbols:person-add-outline", tone: "text-ink/45" },
} as const;

const oidcCount = computed(
  () => configured.value.filter((entry) => entry.info.protocol === "oidc").length,
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.dev/docs/providers";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Social providers">
      <template #badge>
        <StatusBadge :label="state.label" :tone="state.tone" />
      </template>
      <template #description>
        Signing in with an identity your users already have, on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >. Each provider is your own OAuth app, and we render no page in the flow. Changes
        save as you make them.
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
          Provider guides
        </v-btn>
        <FancyButton @click="addProvider">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add provider
        </FancyButton>
      </template>
    </PageHeader>

    <!-- The strip stands only while something is blocking; afterwards the badge above and
         the setup check below carry the state. -->
    <SetupBlockerCard
      v-if="blockers.length > 0"
      :blockers="blockers"
      description="Nobody can sign in with a provider on this project until these are settled."
    >
      <template #action="{ blocker }">
        <v-btn
          v-if="blocker.id === 'none'"
          class="-mt-1 text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="addProvider"
        >
          {{ blocker.action }}
        </v-btn>
        <v-btn
          v-else-if="blocker.id === 'return'"
          :loading="isBusy('return')"
          class="-mt-1 text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="returnUrlDialog = true"
        >
          {{ blocker.action }}
        </v-btn>
        <v-btn
          v-else-if="blocker.id.startsWith('broken-')"
          class="-mt-1 text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="manageById(blocker.id)"
        >
          {{ blocker.action }}
        </v-btn>
      </template>
    </SetupBlockerCard>

    <LayerCard
      :padded="false"
      description="What state each one is actually in, which is not the same as whether it is switched on."
      title="Providers on this project"
    >
      <!-- Three rows of nothing while the store answers, so the card keeps its height and
           the list does not arrive as a jump. -->
      <div v-if="loading" class="divide-y divide-line">
        <div v-for="row in 3" :key="row" class="flex items-center gap-4 px-4 py-4">
          <span class="size-9 flex-none animate-pulse rounded-full bg-ink/8" />
          <span class="flex min-w-0 flex-1 flex-col gap-2">
            <span class="h-3 w-28 animate-pulse rounded-full bg-ink/8" />
            <span class="h-2.5 w-56 animate-pulse rounded-full bg-ink/6" />
          </span>
          <span class="h-5 w-9 flex-none animate-pulse rounded-full bg-ink/8" />
        </div>
      </div>

      <EmptyState
        v-else-if="configured.length === 0"
        description="Nobody can sign in with Google, Apple or any of the other sixteen until one is set up here. Each takes a client id and a secret from that provider's console, and about two minutes."
        icon="material-symbols:hub-outline"
        title="No provider yet"
      >
        <template #actions>
          <FancyButton @click="addProvider">
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
            Add provider
          </FancyButton>
          <v-btn
            :href="GUIDES_URL"
            class="text-xs font-medium"
            color="neutral"
            rel="noopener"
            size="small"
            target="_blank"
            variant="outlined"
          >
            Read the guides
          </v-btn>
        </template>
      </EmptyState>

      <template v-else>
        <div class="divide-y divide-line">
          <ProviderRow
            v-for="entry in configured"
            :key="entry.info.id"
            :busy="isBusy(entry.info.id)"
            :config="entry.config"
            :info="entry.info"
            :sign-ins="signInsBy.get(entry.info.id) ?? 0"
            @copy-callback="copyCallback(entry.info.id)"
            @manage="manage(entry.info, entry.config)"
            @remove="askRemoval(entry.info.id)"
            @toggle="setEnabled(entry.info.id, $event)"
          />
        </div>
        <div class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <p class="m-0 text-[11px] text-ink/50">
            {{ AVAILABLE_PROVIDERS.length - configured.length }} more are available, plus a
            generic OIDC connector that ships with enterprise SSO.
          </p>
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:add"
            size="small"
            variant="text"
            @click="addProvider"
          >
            Add provider
          </v-btn>
        </div>
      </template>
    </LayerCard>

    <LayerCard
      :padded="false"
      description="Where a finished sign-in hands over to your application. One list for the project: the code is ours whichever provider minted the identity behind it."
      title="Return URLs"
    >
      <template #badge>
        <StatusBadge
          :label="returnUris.length === 0 ? 'None registered' : `${returnUris.length} registered`"
          :tone="returnUris.length === 0 ? 'warning' : 'neutral'"
        />
      </template>
      <template #actions>
        <v-btn
          :loading="isBusy('return')"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:add"
          size="small"
          variant="outlined"
          @click="returnUrlDialog = true"
        >
          Add return URL
        </v-btn>
      </template>

      <!--
        Three columns on one grid rather than a flex row per URL: the glyph sits centred
        in a box the height of one line, so every host starts at the same x however long
        the scheme before it is.
      -->
      <ul v-if="returnUris.length > 0" class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="uri in returnUris"
          :key="uri"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-4 py-2.5"
        >
          <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
            <Icon class="text-[15px] text-ink/45" name="material-symbols:link" />
          </span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate font-mono text-xs leading-4 text-ink">{{ uri }}</span>
            <span
              v-if="originGap(uri)"
              class="flex items-center gap-1 text-[11px] leading-4 text-warning"
            >
              <Icon
                aria-hidden="true"
                class="flex-none text-xs"
                name="material-symbols:error-outline"
              />
              Its origin is not on the CORS allowlist, so the exchange call after the redirect
              is refused by the browser
            </span>
          </span>
          <v-btn
            :disabled="isBusy('return')"
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
      <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
        None yet, so no sign-in can be started. A start naming a URL that is not here is
        refused, and the error never echoes the URL back.
      </p>

      <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
        Matched exactly: the whole URL, no wildcards and no prefixes, checked when the flow
        starts and again at the callback. This is not the callback the provider console holds,
        which is ours and fixed, and not the CORS allowlist, which is a separate list on
        <NuxtLink class="font-medium text-ink" to="/domains/origins">Allowed origins</NuxtLink>.
      </p>
    </LayerCard>

    <SetupCheckCard
      :checks="checks"
      :testing="testing"
      description="The four things that have to be true before a social sign-in completes. Two of them are settled on other screens."
      note="Read from this project's own configuration, so it answers the moment something changes. What no check here can see is whether a provider console holds our callback: that is settled by a real sign-in, from the last step of a provider's setup."
      title="Setup check"
      @test="runChecks"
    />

    <section class="flex flex-col gap-4">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Social sign-in</h2>
        <p class="m-0 text-xs text-ink/55">
          What the last 30 days did, across every provider on this project.
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistic
          :previous="stats.signInsPrevious"
          :value="stats.signIns"
          compare="vs the 30 days before"
          description="Accepted, and given a session."
          info="Callbacks that verified and issued a session. A consent screen somebody closed is not one."
          label="Sign-ins"
        />
        <Statistic
          :value="stats.newAccounts"
          description="Created rather than joined."
          info="Accounts a provider sign-in created, rather than joined to one that already existed."
          label="New accounts"
        />
        <Statistic
          :value="stats.linked"
          description="Holding a provider identity."
          info="Accounts with at least one provider attached, however they first signed up."
          label="Accounts linked"
        />
        <Statistic
          :previous="stats.refusedPrevious"
          :value="stats.refused"
          compare="vs the 30 days before"
          description="Matched, but nobody proved it."
          :info="`Sign-ins that matched an address the provider had not verified, answered ${LINKING_ERROR}. They are sent through an email code rather than refused outright.`"
          label="Sent to verify"
          positive="down"
        />
      </div>
    </section>

    <LayerCard
      v-model:open="expanded.linking"
      description="What happens when somebody signs in with a provider and the address already belongs to an account here."
      expandable
      title="Account linking"
    >
      <template #badge>
        <StatusBadge
          :label="linking.autoLink ? 'Joins on a verified address' : 'Always verifies first'"
          tone="neutral"
        />
      </template>

      <div class="divide-y divide-line">
        <SettingRow label="Join accounts on a verified address">
          <template #description>
            A provider that asserts the address is verified signs the person straight into the
            account holding it. Off, every match goes through an email code first, even where
            the provider proved the address, which is safe and is one more step for everybody.
          </template>
          <v-switch
            :disabled="isBusy('linking')"
            :loading="isBusy('linking')"
            :model-value="linking.autoLink"
            aria-label="Join accounts on a verified address"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="setAutoLink($event === true)"
          />
        </SettingRow>
        <SettingRow fixed="Never" label="Join accounts on an unverified address">
          <template #description>
            A provider that asserts nothing about the address never joins an account on it,
            whatever the switch above says. A provider that lets somebody set an address they
            do not own would otherwise hand them every account holding it.
          </template>
        </SettingRow>
        <SettingRow
          description="A signed-in user attaches a provider through the SDK, which asks for the URL with the session it holds and navigates itself. The account is the caller's, pinned before the browser leaves, so the callback links to them and not to whoever the provider turns out to be."
          fixed="From a session"
          label="Attaching a provider to an account"
        />
        <SettingRow
          description="A provider account belongs to one user here. Attaching one that is already somebody else's is refused rather than moved, because the two cannot both be right and picking one silently is how an account is lost."
          fixed="One user"
          label="A provider account, twice"
        />
      </div>

      <!--
        The abstract rule, worked through on four concrete arrivals. A customer who cannot
        predict which of these they are looking at reads the third and fourth as bugs.
      -->
      <SamplePanel
        class="mt-5"
        :meta="linking.autoLink ? 'With the rule on' : 'With the rule off'"
        note="Only an address the provider proved can join an existing account. The rest is not an oversight: a provider that states nothing is reported as stating nothing, because an assumption is not an assertion."
        title="What happens to four arrivals"
      >
        <ul class="m-0 list-none divide-y divide-line p-0">
          <li
            v-for="example in examples"
            :key="example.id"
            class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[1.25rem_minmax(0,1fr)_10rem]"
          >
            <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
              <Icon
                :class="EXAMPLE_MARKS[example.tone].tone"
                :name="EXAMPLE_MARKS[example.tone].icon"
                class="text-[15px]"
              />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-xs leading-4 font-medium text-ink">{{ example.situation }}</span>
              <span class="text-[11px] leading-4 text-ink/55">{{ example.detail }}</span>
            </span>
            <span
              :class="EXAMPLE_MARKS[example.tone].tone"
              class="col-start-2 text-[11px] leading-4 font-medium sm:col-start-3 sm:text-right"
            >
              {{ example.outcome }}
            </span>
          </li>
        </ul>
      </SamplePanel>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.flow"
      description="What every provider sign-in does, whichever provider it is. None of it is configurable, and each row says why."
      expandable
      title="The flow"
    >
      <template #badge>
        <StatusBadge label="Fixed by the deployment" tone="neutral" />
      </template>

      <div class="divide-y divide-line">
        <SettingRow
          :description="`Authorization code with PKCE (${FLOW.challengeMethod}), on every provider and every request. It is not only for public clients: it binds the code to this one flow, so a code intercepted at the redirect is useless without a verifier that never left our database.`"
          fixed="Always"
          label="Proof key for code exchange"
        />
        <SettingRow
          description="The state is consumed in the same statement that reads it, so it is a one-shot token rather than a value that merely matches. A callback carrying a state we did not issue, or one already spent, is refused before the code it carries is worth anything."
          fixed="Single use"
          label="State"
        />
        <SettingRow
          :description="`Issuer, audience and nonce are checked on the id_token, which is the mix-up defence: without it a code obtained from a provider an attacker controls can be presented at one we trust. ${oidcCount} of your providers issue one; the rest are plain OAuth 2 and have no such token to check.`"
          fixed="OIDC providers"
          label="Issuer and nonce"
        />
        <SettingRow label="Our callback">
          <template #description>
            What a provider console needs from you, once per provider. Copy the exact one from
            a provider's menu; this is its shape.
          </template>
          <template #detail>
            <p
              class="m-0 inline-flex max-w-full items-center rounded-(--idenzy-radius-x-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-1.5 font-mono text-[11px] break-all text-ink"
            >
              {{ callbackShape(apiBase) }}
            </p>
          </template>
        </SettingRow>
        <SettingRow
          :description="`A started authorization has ${FLOW.flowMinutes} minutes to come back, and the code we hand your route is single use and good for ${FLOW.exchangeMinutes} minutes after that. Both are set for the deployment.`"
          fixed="Deployment"
          label="How long a sign-in has"
        />
        <SettingRow
          :description="`Our shared OAuth apps exist so a provider works before you have one of your own. They carry our name on the consent screen and are refused anywhere but ${INSTANT_HOSTS}, so a project cannot reach real users on them by accident.`"
          fixed="Localhost only"
          label="Instant mode"
        />
        <SettingRow
          description="A provider's access and refresh tokens are kept only where you asked for them, per provider, and are envelope encrypted under this project's data key. A refresh token nobody uses is a standing grant on somebody's account and a liability rather than a feature."
          fixed="Only when asked"
          label="Provider tokens"
        />
        <SettingRow
          description="The only HTML in a provider sign-in belongs to the identity provider. We take the browser there, take the callback, and send it to your route with a code. There is no page of ours to brand, to translate or to trust."
          fixed="None"
          label="Pages of ours in the flow"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <ProviderSetupDialog v-model="setupOpen" :provider="editing" :start-at="startAt" />
    <ProviderRemoveDialog
      v-model="removeOpen"
      :busy="removing !== null && isBusy(removing)"
      :info="removingInfo"
      :stranded="stranded"
      @confirm="confirmRemoval"
    />
    <ProviderReturnUrlDialog
      v-model="returnUrlDialog"
      :allowed-origins="allowedOrigins"
      :callback="callbackShape(apiBase)"
      :return-uris="returnUris"
      @confirm="addReturnUrl"
    />
  </div>
</template>
