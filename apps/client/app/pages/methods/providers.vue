<script setup lang="ts">
/**
 * Social sign-in for the project: which providers are on, whose OAuth app each one uses,
 * and the one rule that decides whether a provider sign-in joins an account somebody
 * already has (apps/auth-api/src/oauth, PROJECT.md 4.6).
 *
 * The screen is in the order the work happens. The providers already set up come first,
 * because that is what most visits are for; the catalogue under them is the way in, and
 * each card says what its provider asserts about an address before any credentials are
 * pasted, since that is the field with consequences. Account linking is its own card
 * because it is a project-wide decision rather than a provider's. The flow card states
 * what the server does and nobody configures, so an operator looking for "is PKCE on"
 * finds the answer here rather than in a support ticket.
 *
 * Every control saves itself, as on the passwords and passkeys screens: a switch writes
 * the moment it is changed and shows its own wait, and credentials are written as one
 * record from a dialog, because a provider half saved fails at the token endpoint. The
 * client secret is never read back, here or anywhere: the panel is told only that one is
 * stored and when it was written.
 */
import {
  ASSERTION_LOOK,
  AVAILABLE_PROVIDERS,
  callbackShape,
  callbackUri,
  type EmailAssertion,
  FLOW,
  INSTANT_HOSTS,
  LINKING_ERROR,
  PROVIDERS,
  type ProviderConfig,
  type ProviderDraft,
  type ProviderInfo,
  type ProviderName,
  providerInfo,
} from "~/utils/providers";

const projects = useProjectStore();
const store = useProvidersStore();
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
 * The same providers for the assertion list, grouped by what they say about an address
 * so that "the first kind" in the box's own sentence is the first group on the screen.
 * Within a group the order is the catalogue's, like the list above.
 */
const ASSERTION_ORDER: readonly EmailAssertion[] = ["asserts", "silent", "denies", "none"];

const assertions = computed(() =>
  ASSERTION_ORDER.flatMap((kind) =>
    configured.value
      .filter((entry) => entry.info.email === kind)
      .map((entry) => ({ ...entry, look: ASSERTION_LOOK[kind] })),
  ),
);

const names = computed(() => configured.value.map((entry) => entry.info.id));
const enabledCount = computed(
  () => configured.value.filter((entry) => entry.config.enabled).length,
);
const oidcCount = computed(
  () => configured.value.filter((entry) => entry.info.protocol === "oidc").length,
);
const remaining = computed(() => AVAILABLE_PROVIDERS.length - configured.value.length);

/* Sign-ins per provider over the window, for the row's figure and the sidebar's bars. */
const signInsBy = computed(() => {
  const counts = new Map<ProviderName, number>();
  for (const entry of stats.value.byProvider) counts.set(entry.id, entry.count);
  return counts;
});

/*
 * Which cards start unfolded. The providers are what most visits are for, and the
 * catalogue unfolds itself for a project with none, because it is then the only thing on
 * the screen that does anything.
 */
const expanded = reactive({ catalogue: false, linking: false, flow: false });

watch(
  () => (store.loading ? null : configured.value.length === 0),
  (empty) => {
    if (empty === true) expanded.catalogue = true;
  },
  { immediate: true },
);

/* The providers on their way to the server, so each row can show its own wait. */
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
 * The dialogs. Both are opened against a provider, which is held here rather than passed
 * down, so the dialog keeps its subject while it closes.
 */
const editing = ref<ProviderName | null>(null);
const setupOpen = ref(false);
const removing = ref<ProviderName | null>(null);
const removeOpen = ref(false);

const editingInfo = computed(() => (editing.value ? providerInfo(editing.value) : null));
const editingConfig = computed(() =>
  editing.value ? store.configFor(projects.current.id, editing.value) : null,
);
const removingInfo = computed(() => (removing.value ? providerInfo(removing.value) : null));
const stranded = computed(() =>
  removing.value ? store.strandedBy(projects.current.id, removing.value) : 0,
);

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

function configure(id: ProviderName) {
  editing.value = id;
  setupOpen.value = true;
}

function confirmSetup(draft: ProviderDraft) {
  const id = editing.value;
  if (id === null) return;
  void whileBusy(id, () => store.save(projects.current.id, id, draft));
}

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

/*
 * The sidebar.
 */
const breakdown = computed(() => {
  const total = stats.value.byProvider.reduce((sum, entry) => sum + entry.count, 0);
  return stats.value.byProvider
    .map((entry) => ({
      ...providerInfo(entry.id),
      count: entry.count,
      share: total === 0 ? 0 : Math.round((entry.count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count);
});

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.dev/docs/providers";

const GUIDES = [
  {
    icon: "material-symbols:hub-outline",
    title: "Social sign-in, end to end",
    detail: "The start call, the callback, and the code your route exchanges.",
    href: GUIDES_URL,
  },
  {
    icon: "material-symbols:join-inner",
    title: "Account linking",
    detail: "Why a verified address is the only one an account is joined on.",
    href: `${GUIDES_URL}/linking`,
  },
  {
    icon: "material-symbols:link",
    title: "Redirect URIs",
    detail: "Where a user lands afterwards, and why there are no wildcards.",
    href: "https://idenzy.dev/docs/redirect-uris",
  },
  {
    icon: "material-symbols:code",
    title: "The JS SDK's OAuth calls",
    detail: "signIn, the exchange, and linking a provider inside a session.",
    href: "https://idenzy.dev/docs/sdk/js/oauth",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:hub-outline" title="Social providers">
      <template #description>
        Signing in with an identity your users already have, on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>. Each provider
        is your own OAuth app, and we render no page in the flow. Changes save as you make
        them.
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
        <FancyButton :disabled="remaining === 0" @click="expanded.catalogue = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add a provider
        </FancyButton>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          :padded="false"
          description="A provider answers as though it were never configured until it is on, whatever credentials it holds."
          title="On this project"
        >
          <template #badge>
            <StatusBadge
              :label="enabledCount === 0 ? 'None on' : `${enabledCount} on`"
              :tone="enabledCount === 0 ? 'neutral' : 'success'"
            />
          </template>

          <!-- Three rows of nothing while the store answers, so the card keeps its height
               and the list does not arrive as a jump. -->
          <div v-if="store.loading" class="divide-y divide-line">
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
            description="Nobody can sign in with Google, Apple or any of the other seventeen until one is set up here. Each takes a client id and a secret from that provider's console, and about two minutes."
            icon="material-symbols:hub-outline"
            title="No provider yet"
          >
            <template #actions>
              <FancyButton @click="expanded.catalogue = true">
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
                Add a provider
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

          <div v-else class="divide-y divide-line">
            <ProviderRow
              v-for="entry in configured"
              :key="entry.info.id"
              :busy="isBusy(entry.info.id)"
              :config="entry.config"
              :info="entry.info"
              :sign-ins="signInsBy.get(entry.info.id) ?? 0"
              @configure="configure(entry.info.id)"
              @copy-callback="copyCallback(entry.info.id)"
              @remove="askRemoval(entry.info.id)"
              @toggle="setEnabled(entry.info.id, $event)"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.catalogue"
          expandable
          description="Eighteen adapters, each an endpoint pair and a profile mapping over the same checked flow. What differs between them is what they tell us about an address."
          title="Add a provider"
        >
          <template #badge>
            <StatusBadge
              :label="remaining === 0 ? 'All eighteen set up' : `${remaining} available`"
              tone="neutral"
            />
          </template>

          <ProviderCatalogue v-if="remaining > 0" :hidden="names" @select="configure" />
          <p v-else class="m-0 text-xs text-ink/60">
            Every provider this deployment implements is set up on this project. The generic
            OIDC connector, for an issuer of your own, ships with enterprise SSO.
          </p>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.linking"
          expandable
          description="What happens when somebody signs in with a provider and the address already belongs to an account here. One rule, and it is the one that prevents the most common takeover through an identity provider."
          title="Account linking"
        >
          <div class="divide-y divide-line">
            <SettingRow label="Join accounts on a verified address">
              <template #description>
                A provider that asserts the address is verified signs the person straight
                into the account holding it. Off, every match goes through an email code
                first, even where the provider proved the address, which is safe and is one
                more step for everybody.
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
                A provider that asserts nothing about the address never joins an account on
                it, whatever the switch above says. A provider that lets somebody set an
                address they do not own would otherwise hand them every account holding it.
                The sign-in is answered
                <span class="font-mono text-ink/80">{{ LINKING_ERROR }}</span>
                and your screen sends them through an email code, which is a detour rather
                than a refusal.
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

          <SamplePanel
            v-if="configured.length > 0"
            class="mt-5"
            note="Only the first kind can join an existing account. The rest is not an oversight: a provider that states nothing is reported as stating nothing, because an assumption is not an assertion."
            title="What your providers assert"
          >
            <!--
              Four columns on one grid rather than a flex row per provider, because the
              logos are not the same width and a row that starts at the logo's own edge
              puts every name, glyph and note at a different x. Each logo sits centred in
              a box the height of one line, so a wide mark and a tall one both land on the
              row's first line; the assertion's name is written out beside its glyph so
              the kind is read, not inferred from a colour.
            -->
            <ul class="m-0 mt-2.5 list-none divide-y divide-line p-0">
              <li
                v-for="entry in assertions"
                :key="entry.info.id"
                class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[1.25rem_5.5rem_7.75rem_minmax(0,1fr)] sm:gap-y-0"
              >
                <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
                  <Icon
                    :class="[
                      entry.info.monochrome ? '[.v-theme--dark_&]:invert' : '',
                      entry.info.tint ?? '',
                    ]"
                    :name="entry.info.icon"
                    class="text-[15px]"
                  />
                </span>
                <span class="truncate text-xs leading-4 font-medium text-ink">
                  {{ entry.info.label }}
                </span>
                <span
                  class="col-start-2 flex h-4 items-center gap-1.5 text-[11px] leading-4 whitespace-nowrap text-ink/70 sm:col-start-3"
                >
                  <Icon
                    :class="entry.look.tone"
                    :name="entry.look.icon"
                    aria-hidden="true"
                    class="flex-none text-xs"
                  />
                  {{ entry.look.label }}
                </span>
                <span class="col-start-2 text-[11px] leading-4 text-ink/60 sm:col-start-4">
                  {{ entry.info.emailNote }}
                </span>
              </li>
            </ul>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.flow"
          expandable
          description="What every provider sign-in does, whichever provider it is. None of it is configurable, and each row says why."
          title="The flow"
        >
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
            <SettingRow
              description="Where the user lands after the exchange is a URI you registered, matched exactly, with no wildcards and no prefixes. It is checked when the flow starts and again at the callback, because a target removed in between must stop working, and it is the only thing standing between our redirect and somebody else's."
              fixed="Exact match"
              label="Redirect URIs"
            />
            <SettingRow label="Our callback">
              <template #description>
                What a provider console needs from you, once per provider. Copy the exact one
                from a provider's menu; this is its shape.
              </template>
              <template #detail>
                <p
                  class="m-0 inline-flex max-w-full items-center rounded-(--idenzy-radius-x-small) border border-line bg-canvas px-3 py-1.5 font-mono text-[11px] break-all text-ink"
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
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Social sign-in</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="31"
            :series="stats.signInsDaily"
            :value="stats.signIns"
            label="Sign-ins"
          />
          <UsageTile
            :seed="33"
            :series="stats.newAccountsDaily"
            :value="stats.newAccounts"
            info="Accounts a provider sign-in created, rather than joined to one that already existed."
            label="New accounts"
          />
          <UsageTile
            :seed="37"
            :value="stats.linked"
            info="Accounts holding at least one provider identity, however they first signed up."
            label="Accounts linked"
          />
          <UsageTile
            :seed="39"
            :series="stats.refusedDaily"
            :value="stats.refused"
            info="Sign-ins that matched an address the provider had not verified. They are sent through an email code rather than refused outright."
            label="Sent to verify"
          />
        </div>

        <LayerCard :padded="false" description="By the provider each one came through." title="Where sign-ins come from">
          <ul v-if="breakdown.length > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="entry in breakdown" :key="entry.id" class="flex items-center gap-2.5">
              <Icon
                :class="[entry.monochrome ? '[.v-theme--dark_&]:invert' : '', entry.tint ?? '']"
                :name="entry.icon"
                aria-hidden="true"
                class="flex-none text-base"
              />
              <span class="w-20 flex-none truncate text-ink/80">{{ entry.label }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span :style="{ width: `${entry.share}%` }" class="block h-full rounded-full bg-primary" />
              </span>
              <span class="w-12 flex-none text-right font-mono tabular-nums text-ink">
                {{ entry.count.toLocaleString("en") }}
              </span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            No social sign-ins on this project yet.
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

    <ProviderSetupDialog
      v-model="setupOpen"
      :busy="editing !== null && isBusy(editing)"
      :callback="editing ? callbackUri(apiBase, editing) : ''"
      :config="editingConfig"
      :info="editingInfo"
      @confirm="confirmSetup"
    />
    <ProviderRemoveDialog
      v-model="removeOpen"
      :busy="removing !== null && isBusy(removing)"
      :info="removingInfo"
      :stranded="stranded"
      @confirm="confirmRemoval"
    />
  </div>
</template>
