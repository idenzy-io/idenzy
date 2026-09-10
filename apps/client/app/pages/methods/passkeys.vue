<script setup lang="ts">
/**
 * Passkey sign-in for the project: the one thing it decides, which is the relying
 * party, the switch, and the rules of the ceremony stated as rows because they are
 * fixed on purpose (apps/auth-api/src/passkey).
 *
 * The relying party is the whole configuration. The RP ID decides which credentials an
 * assertion may address and is never read off the request, so a project with none has
 * no working passkeys, and the screen says so in place of the settings. Changing the id
 * on a project that already holds passkeys orphans every one of them, which is why that
 * one edit goes through a dialog that states the count. Origins are matched exactly.
 *
 * Every control saves itself, as on the passwords screen: switches and list edits at
 * once, text half a second after the last keystroke, with a refused value kept on screen
 * beside its reason and not sent. The figures on the side are the method's own, and the
 * authenticator breakdown comes from the AAGUID each registration carries.
 */
import {
  authenticatorOf,
  CEREMONY,
  normaliseOrigin,
  type RelyingParty,
  RP_ISSUE_LABELS,
  validateRelyingParty,
} from "~/utils/passkeys";

const projects = useProjectStore();
const store = usePasskeysStore();

const saved = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));
const configured = computed(() => saved.value.relyingParty !== null);

/*
 * Which cards start unfolded. The switch is what most visits are for, so it is open;
 * the party unfolds itself for a project that has none, because its form is the only
 * thing on the screen that does anything until it does.
 */
const expanded = reactive({ signIn: true, party: false, ceremony: false });

watch(
  () => (store.loading ? null : configured.value),
  (isConfigured) => {
    if (isConfigured === false) expanded.party = true;
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

function setEnabled(value: boolean) {
  if (value === saved.value.enabled) return;
  void whileBusy("enabled", () => store.patch(projects.current.id, { enabled: value }));
}

/*
 * The relying party, as a copy to edit against. It follows the saved one whenever that
 * changes underneath, and starts empty for a project that has none, where the same copy
 * is the form that creates it.
 */
const party = ref<RelyingParty>({ rpId: "", rpName: "", origins: [] });

watch(
  saved,
  (settings) => {
    party.value = settings.relyingParty
      ? { ...settings.relyingParty, origins: [...settings.relyingParty.origins] }
      : { rpId: "", rpName: "", origins: [] };
  },
  { immediate: true },
);

/** One write for the whole party, sent only if the party it makes stands. */
async function commitParty(change: Partial<RelyingParty>, key: string) {
  const current = saved.value.relyingParty;
  if (current === null) return;
  const next = { ...current, ...change };
  if (validateRelyingParty(next).length > 0) return;
  await whileBusy(key, () => store.setRelyingParty(projects.current.id, next));
}

/* The RP name, renamed through a dialog like the id, though nothing hangs on it. */
const rpNameDialog = ref(false);

function confirmRpName(rpName: string) {
  party.value = { ...party.value, rpName };
  void commitParty({ rpName }, "rpName");
}

/*
 * The RP ID. It is shown, not typed: a change orphans every passkey on the project and
 * may drop origins with it, so it goes through a dialog that takes the new id, states
 * the cost and settles the origins in the same write. The values it moves from are held
 * still so it does not re-read the write as it closes.
 */
const rpIdDialog = ref(false);
const dialogFrom = ref<RelyingParty>({ rpId: "", rpName: "", origins: [] });

function openRpIdDialog() {
  const current = saved.value.relyingParty;
  if (current === null) return;
  dialogFrom.value = { ...current, origins: [...current.origins] };
  rpIdDialog.value = true;
}

function confirmRpId(rpId: string, origins: string[]) {
  party.value = { ...party.value, rpId, origins };
  void commitParty({ rpId, origins }, "rpId");
}

/*
 * Origins. Each add and each removal is a write. An add goes through a dialog that
 * checks the text against the RP ID as it is typed. The last origin cannot be removed,
 * because a party with none refuses every ceremony and that is worse than an old one.
 */
const originDialog = ref(false);

function addOrigin(origin: string) {
  if (party.value.origins.includes(origin)) return;
  const origins = [...party.value.origins, origin];
  party.value = { ...party.value, origins };
  void commitParty({ origins }, "origins");
}

function removeOrigin(origin: string) {
  if (party.value.origins.length < 2) return;
  const origins = party.value.origins.filter((entry) => entry !== origin);
  party.value = { ...party.value, origins };
  void commitParty({ origins }, "origins");
}

/*
 * Creating the party, for a project without one. The form is the same copy with the
 * first origin typed beside it, and it is written once, whole.
 */
const firstOrigin = ref("");
const creation = computed(() => ({
  ...party.value,
  origins: firstOrigin.value.trim() === "" ? [] : [normaliseOrigin(firstOrigin.value)],
}));
const creationIssues = computed(() => validateRelyingParty(creation.value));
const createTried = ref(false);

function issueFor(...codes: readonly string[]): string {
  if (!createTried.value) return "";
  const found = creationIssues.value.find((issue) => codes.includes(issue));
  return found === undefined ? "" : RP_ISSUE_LABELS[found];
}

function createParty() {
  createTried.value = true;
  if (creationIssues.value.length > 0) return;
  const created = creation.value;
  void whileBusy("create", () => store.setRelyingParty(projects.current.id, created));
}

/*
 * The figures.
 */
const authenticators = computed(() =>
  [...stats.value.byAuthenticator]
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({
      ...authenticatorOf(entry.aaguid),
      count: entry.count,
      key: entry.aaguid ?? "other",
    })),
);

const share = (count: number) =>
  stats.value.enrolled === 0 ? 0 : Math.round((count / stats.value.enrolled) * 100);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES = [
  {
    icon: "material-symbols:passkey",
    title: "Passkeys, end to end",
    detail: "Enrolment inside a session, usernameless sign-in, autofill.",
    href: "https://idenzy.dev/docs/passkeys",
  },
  {
    icon: "material-symbols:domain",
    title: "Choosing the RP ID",
    detail: "Why it is the registrable domain, and what a change costs.",
    href: "https://idenzy.dev/docs/passkeys/relying-party",
  },
  {
    icon: "material-symbols:shield-lock-outline",
    title: "Passkeys as a second factor",
    detail: "Answering a step-up without turning MFA on.",
    href: "https://idenzy.dev/docs/mfa/passkeys",
  },
  {
    icon: "material-symbols:code",
    title: "The JS SDK's ceremony calls",
    detail: "signIn({ conditional: true }) and the registration pair.",
    href: "https://idenzy.dev/docs/sdk/js/passkeys",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:passkey" title="Passkeys">
      <template #description>
        Passkey sign-in on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>: the relying
        party the credentials belong to, and the rules of the ceremony. Changes save as you
        make them.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.signIn"
          expandable
          description="Whether the method exists on this project, and what it never does."
          title="Passkey sign-in"
        >
          <template #badge>
            <StatusBadge
              :label="saved.enabled ? 'On' : 'Off'"
              :tone="saved.enabled ? 'success' : 'neutral'"
            />
          </template>
          <div class="divide-y divide-line">
            <SettingRow label="Enabled">
              <template #description>
                Users enrol a passkey from inside a session and sign in with it afterwards.
                Off, the ceremony endpoints answer as if the method did not exist, and
                enrolled credentials are kept for when it is back.
                <span v-if="!configured" class="text-warning">
                  Nothing works until a relying party is configured below.
                </span>
              </template>
              <v-switch
                :disabled="isBusy('enabled')"
                :loading="isBusy('enabled')"
                :model-value="saved.enabled"
                aria-label="Passkey sign-in"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled($event === true)"
              />
            </SettingRow>
            <SettingRow
              description="Authentication options name no credential, so the browser offers whatever it holds for this RP ID, and the SDK's conditional sign-in puts that in the address field's autofill. An endpoint that took an email would say which addresses have passkeys, an enumeration oracle in front of the method we promote."
              fixed="Always"
              label="Usernameless, with autofill"
            />
            <SettingRow
              description="A passkey may answer a step-up or a second-factor challenge that something else demanded. Enrolling one never turns two-factor on for the account: a credential enrolled to sign in with must not silently start being demanded on top of the password."
              fixed="Never demanded"
              label="As a second factor"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.party"
          expandable
          description="The domain the passkeys belong to and the pages allowed to run a ceremony. Exactly one per project: the RP ID decides which credentials an assertion may address, and a second would split the passkeys into two sets that cannot substitute for each other."
          title="Relying party"
        >
          <template #badge>
            <StatusBadge
              :label="configured ? 'Configured' : 'Not configured'"
              :tone="configured ? 'success' : 'warning'"
            />
          </template>

          <div v-if="!configured" class="flex flex-col gap-5">
            <div class="flex items-start gap-3 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-4 py-3">
              <Icon aria-hidden="true" class="mt-px flex-none text-base text-warning" name="material-symbols:warning-outline" />
              <div class="flex flex-col gap-0.5 text-xs">
                <p class="m-0 font-medium text-ink">No relying party yet</p>
                <p class="m-0 leading-5 text-ink/70">
                  Every ceremony on this project is refused until the RP ID and at least one
                  origin are set, and the SDK reports it as a configuration error rather
                  than a failed sign-in. It is never taken from the request's host: whoever
                  controls a request would otherwise choose which credentials it may use.
                </p>
              </div>
            </div>

            <div class="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-medium opacity-70" for="rp-create-id">RP ID</label>
                <v-text-field
                  id="rp-create-id"
                  :error="issueFor('rp_id_invalid') !== ''"
                  :model-value="party.rpId"
                  autocomplete="off"
                  class="font-mono"
                  hide-details
                  placeholder="example.com"
                  variant="underlined"
                  @update:model-value="party = { ...party, rpId: String($event).trim().toLowerCase() }"
                />
                <p v-if="issueFor('rp_id_invalid')" class="m-0 text-[11px] text-error">{{ issueFor('rp_id_invalid') }}</p>
                <p v-else class="m-0 text-[11px] text-ink/50">
                  The registrable domain your pages share. Subdomains of it may run the ceremony.
                </p>
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-medium opacity-70" for="rp-create-name">RP name</label>
                <v-text-field
                  id="rp-create-name"
                  :error="issueFor('rp_name_missing') !== ''"
                  :model-value="party.rpName"
                  autocomplete="off"
                  hide-details
                  placeholder="Your product's name"
                  variant="underlined"
                  @update:model-value="party = { ...party, rpName: String($event) }"
                />
                <p v-if="issueFor('rp_name_missing')" class="m-0 text-[11px] text-error">{{ issueFor('rp_name_missing') }}</p>
                <p v-else class="m-0 text-[11px] text-ink/50">
                  What the authenticator shows when it asks. Yours, not ours.
                </p>
              </div>
              <div class="flex flex-col gap-2 sm:col-span-2">
                <label class="text-xs font-medium opacity-70" for="rp-create-origin">First origin</label>
                <v-text-field
                  id="rp-create-origin"
                  v-model="firstOrigin"
                  :error="issueFor('origins_empty', 'origin_invalid', 'origin_insecure', 'origin_outside_rp') !== ''"
                  autocomplete="off"
                  class="font-mono"
                  hide-details
                  placeholder="https://app.example.com"
                  variant="underlined"
                />
                <p v-if="issueFor('origins_empty', 'origin_invalid', 'origin_insecure', 'origin_outside_rp')" class="m-0 text-[11px] text-error">
                  {{ issueFor('origins_empty', 'origin_invalid', 'origin_insecure', 'origin_outside_rp') }}
                </p>
                <p v-else class="m-0 text-[11px] text-ink/50">
                  Scheme, host and port, matched exactly. More can be added once the party exists.
                </p>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3">
              <p class="m-0 text-[11px] text-ink/50">
                Written as one record. Localhost is allowed only by the development build, never by data.
              </p>
              <FancyButton :disabled="isBusy('create')" @click="createParty">
                <Icon
                  :class="isBusy('create') ? 'animate-spin' : ''"
                  :name="isBusy('create') ? 'material-symbols:progress-activity' : 'material-symbols:add'"
                  aria-hidden="true"
                  class="text-sm"
                />
                Create relying party
              </FancyButton>
            </div>
          </div>

          <div v-else class="divide-y divide-line">
            <SettingRow
              description="The registrable domain the passkeys are bound to, and the domain every origin has to sit on. Change it and every passkey on the project stops answering, and any origin off the new domain comes off the list; the screen asks first."
              label="RP ID"
            >
              <template #actions>
                <span class="font-mono text-xs text-ink/60" data-testid="rp-id">{{ party.rpId }}</span>
                <v-btn
                  :loading="isBusy('rpId')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="openRpIdDialog"
                >
                  Change
                </v-btn>
              </template>
            </SettingRow>
            <SettingRow
              description="What the authenticator shows when it asks someone to create or use a passkey. The customer's product, not us."
              label="RP name"
            >
              <template #actions>
                <span class="text-xs text-ink/60">{{ party.rpName }}</span>
                <v-btn
                  :loading="isBusy('rpName')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="rpNameDialog = true"
                >
                  Change
                </v-btn>
              </template>
            </SettingRow>
            <SettingRow
              description="The pages allowed to run a ceremony, matched exactly: scheme, host and port, no wildcards, https everywhere but localhost. Each has to sit on the RP ID's domain, which is WebAuthn's rule and not ours. A ceremony from anywhere else is refused, whatever the RP ID says."
              label="Origins"
            >
              <template #actions>
                <v-btn
                  :loading="isBusy('origins')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:add"
                  size="small"
                  variant="text"
                  @click="originDialog = true"
                >
                  Add origin
                </v-btn>
              </template>
              <template #detail>
                <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                  <li
                    v-for="origin in party.origins"
                    :key="origin"
                    class="flex items-center gap-2 rounded-(--idenzy-radius-x-small) border border-line bg-canvas py-1 pr-1 pl-2.5"
                  >
                    <Icon aria-hidden="true" class="flex-none text-sm text-ink/45" name="material-symbols:language" />
                    <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">{{ origin }}</span>
                    <v-tooltip
                      :text="party.origins.length < 2 ? 'The last origin stays: a party with none refuses every ceremony.' : `Remove ${origin}`"
                      location="top"
                    >
                      <template #activator="{ props: tip }">
                        <span v-bind="tip">
                          <button
                            :aria-label="`Remove ${origin}`"
                            :disabled="party.origins.length < 2 || isBusy('origins')"
                            class="inline-flex size-6 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/50 transition-colors duration-150 hover:bg-ink/6 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                            type="button"
                            @click="removeOrigin(origin)"
                          >
                            <Icon aria-hidden="true" class="text-sm" name="material-symbols:close" />
                          </button>
                        </span>
                      </template>
                    </v-tooltip>
                  </li>
                </ul>
              </template>
            </SettingRow>
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.ceremony"
          expandable
          description="How every registration and assertion runs. None of it is configurable, and each row says why."
          title="Ceremony"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Every passkey is a resident key, so sign-in can name no credential and still find one. Relax it and sign-in has nothing discoverable to offer, so the usernameless flow stops working for credentials enrolled after the change."
              fixed="Required"
              label="Discoverable credentials"
            />
            <SettingRow
              description="The authenticator has to check the person, by biometrics or a PIN, before it signs. That is what makes a passkey a complete sign-in on its own rather than a second factor waiting for a first."
              fixed="Required"
              label="User verification"
            />
            <SettingRow
              description="We do not ask what make the authenticator is. Knowing it is not needed to trust the signature, and it is one more thing about a person to keep. The AAGUID an authenticator volunteers is recorded for the breakdown beside this page and nothing else."
              fixed="Not collected"
              label="Attestation"
            />
            <SettingRow
              :description="`${CEREMONY.algorithms.map((algorithm) => algorithm.name).join(', ')}, advertised at registration and accepted at verification from one list, so an authenticator can never enrol with an algorithm it could not later sign in with.`"
              fixed="Fixed"
              label="Signature algorithms"
            />
            <SettingRow
              :description="`${CEREMONY.challengeTtlSeconds / 60} minutes to answer, set for the deployment. A challenge is claimed the moment it is presented and before anything is verified, so a nonce that failed once cannot be signed against again.`"
              fixed="Deployment"
              label="Challenge lifetime"
            />
            <SettingRow
              description="Every assertion carries a counter, and one that does not advance past the last we saw is refused and counted as a security event: it is the signature of a cloned authenticator."
              fixed="Always"
              label="Sign counter"
            />
            <SettingRow
              description="Whether a passkey syncs to a provider's cloud or lives on one device is read from the flags the authenticator signs, not from anything the browser reports, and the breakdown beside this page counts them."
              fixed="Recorded"
              label="Backup state"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Passkeys</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="13" :series="stats.signInsDaily" :value="stats.signIns" label="Sign-ins" />
          <UsageTile :seed="17" :series="stats.enrolledDaily" :value="stats.enrolled" info="Credentials on the project. The line is how many were added each day." label="Enrolled" />
          <UsageTile :seed="19" :value="stats.accounts" info="Accounts holding at least one passkey." label="Accounts with one" />
          <UsageTile :seed="23" :series="stats.refusedDaily" :value="stats.refused" info="Assertions refused: a counter that went backwards, an origin off the list, or a challenge already spent." label="Refused" />
        </div>

        <LayerCard :padded="false" description="By the authenticator that made each credential." title="Where passkeys live">
          <ul v-if="authenticators.length > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="entry in authenticators" :key="entry.key" class="flex items-center gap-2.5">
              <Icon
                :class="entry.monochrome ? '[.v-theme--dark_&]:invert' : ''"
                :name="entry.icon"
                aria-hidden="true"
                class="flex-none text-base"
              />
              <span class="w-32 flex-none truncate text-ink/80">{{ entry.name }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span :style="{ width: `${share(entry.count)}%` }" class="block h-full rounded-full bg-primary" />
              </span>
              <span class="w-8 flex-none text-right font-mono tabular-nums text-ink">{{ entry.count }}</span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            No passkeys enrolled on this project yet.
          </p>
          <div v-if="stats.enrolled > 0" class="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11px] text-ink/55">
            <span>
              <span class="font-mono tabular-nums text-ink">{{ stats.backedUp }}</span> synced to a cloud
            </span>
            <span>
              <span class="font-mono tabular-nums text-ink">{{ stats.deviceBound }}</span> bound to one device
            </span>
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

    <PasskeyRpNameDialog v-model="rpNameDialog" :current="party.rpName" @confirm="confirmRpName" />
    <PasskeyOriginDialog
      v-model="originDialog"
      :origins="party.origins"
      :rp-id="party.rpId"
      @confirm="addOrigin"
    />
    <PasskeyRpIdDialog
      v-model="rpIdDialog"
      :enrolled="stats.enrolled"
      :from="dialogFrom.rpId"
      :origins="dialogFrom.origins"
      @confirm="confirmRpId"
    />
  </div>
</template>
