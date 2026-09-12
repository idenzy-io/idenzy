<script setup lang="ts">
/**
 * Passkey sign-in for the project, arranged as a setup screen rather than a settings
 * one: whether it works, what is stopping it, the three things a customer decides, and
 * a check that says why a browser would refuse a ceremony.
 *
 * Three of those decisions are named here in the reader's words and not WebAuthn's. The
 * passkey domain is the RP ID, and it is the whole configuration: it decides which
 * credentials an assertion may address and is never read off the request, so a project
 * without one has no working passkeys. Setting it goes through a dialog because its
 * three fields are checked against each other and written as one record; changing it
 * goes through another, because it orphans every passkey on the project.
 *
 * The setup check exists because two of the four things that have to be true are not on
 * this screen. An application URL that is not also on the CORS allowlist is refused by
 * the browser with nothing in our logs to explain it (ADR-0006), and a project nobody
 * has integrated looks exactly like one whose integration is broken.
 *
 * Everything here saves itself: switches and list edits write at once and show their own
 * wait, and a value the rules refuse is never sent. The WebAuthn rules are fixed by the
 * server on purpose and sit folded at the foot, stated rather than hidden.
 */
import {
  authenticatorOf,
  backupLine,
  CEREMONY,
  creationOptions,
  evaluatePasskeySetup,
  passkeyBlockers,
  type RelyingParty,
  validateRelyingParty,
} from "~/utils/passkeys";

const projects = useProjectStore();
const store = usePasskeysStore();
const origins = useOriginsStore();

/* The CORS allowlist is read from the management API over a cache, and this screen's setup
   check asks whether a ceremony origin may also call us: two lists, one of them real. */
watch(
  () => projects.current.id,
  (id) => void origins.load(id),
  { immediate: true },
);

const saved = computed(() => store.settingsFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));
const configured = computed(() => saved.value.relyingParty !== null);

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
 * The relying party, as a copy to edit against, so a list edit shows at once and the
 * saved party does not change under a write that has not landed.
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

/* Setting it up, for a project with none. One record, written whole. */
const partyDialog = ref(false);

function createParty(created: RelyingParty) {
  party.value = { ...created, origins: [...created.origins] };
  void whileBusy("create", () => store.setRelyingParty(projects.current.id, created));
}

/* The product name, edited through a dialog like the domain, though nothing hangs on it. */
const rpNameDialog = ref(false);

function confirmRpName(rpName: string) {
  party.value = { ...party.value, rpName };
  void commitParty({ rpName }, "rpName");
}

/*
 * The domain. It is shown, not typed: a change orphans every passkey on the project and
 * may drop URLs with it, so it goes through a dialog that takes the new one, states the
 * cost and settles the URLs in the same write. The values it moves from are held still
 * so it does not re-read the write as it closes.
 */
const rpIdDialog = ref(false);
const dialogFrom = ref<RelyingParty>({ rpId: "", rpName: "", origins: [] });

function openRpIdDialog() {
  const current = saved.value.relyingParty;
  if (current === null) return;
  dialogFrom.value = { ...current, origins: [...current.origins] };
  rpIdDialog.value = true;
}

function confirmRpId(rpId: string, next: string[]) {
  party.value = { ...party.value, rpId, origins: next };
  void commitParty({ rpId, origins: next }, "rpId");
}

/*
 * The application URLs. Each add and each removal is a write. An add goes through a
 * dialog that checks the text against the domain as it is typed. The last one cannot be
 * removed, because a party with none refuses every ceremony and that is worse than an
 * out-of-date list.
 */
const originDialog = ref(false);

function addOrigin(origin: string) {
  if (party.value.origins.includes(origin)) return;
  const next = [...party.value.origins, origin];
  party.value = { ...party.value, origins: next };
  void commitParty({ origins: next }, "origins");
}

function removeOrigin(origin: string) {
  if (party.value.origins.length < 2) return;
  const next = party.value.origins.filter((entry) => entry !== origin);
  party.value = { ...party.value, origins: next };
  void commitParty({ origins: next }, "origins");
}

/*
 * The state of the setup, and the four checks behind it. The checks read what the panel
 * already knows, so they are live rather than a snapshot; the button re-runs them and
 * says when it last did, because a reader who has just changed something in another
 * screen wants to watch this answer change.
 */
const setup = computed(() => ({
  enabled: saved.value.enabled,
  party: saved.value.relyingParty,
  allowedOrigins: origins.forProject(projects.current.id).map((entry) => entry.origin),
  ceremonies: stats.value.signIns + stats.value.enrolled,
}));

const blockers = computed(() => passkeyBlockers(setup.value));
const ready = computed(() => !store.loading && blockers.value.length === 0);
const checks = computed(() => evaluatePasskeySetup(setup.value));

const testing = ref(false);
const testedAt = ref<string | null>(null);

async function runTest() {
  testing.value = true;
  await new Promise((resolve) => setTimeout(resolve, 900));
  testedAt.value = new Date().toISOString();
  testing.value = false;
}

/* Run once as the screen settles, so the card carries an answer before it is asked. */
watch(
  () => store.loading || origins.loading,
  (waiting) => {
    if (!waiting && testedAt.value === null) void runTest();
  },
  { immediate: true },
);

/* The options the browser is given, read from the domain above and the fixed rules. */
const options = computed(() => creationOptions(party.value));

/*
 * The figures.
 */
const authenticators = computed(() =>
  [...stats.value.byAuthenticator]
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({
      ...authenticatorOf(entry.aaguid),
      count: entry.count,
      backedUp: entry.backedUp,
      key: entry.aaguid ?? "other",
    })),
);

const share = (count: number) =>
  stats.value.enrolled === 0 ? 0 : Math.round((count / stats.value.enrolled) * 100);

/* Summed from the rows rather than held beside them, so the two cannot disagree. */
const backedUp = computed(() =>
  stats.value.byAuthenticator.reduce((total, entry) => total + entry.backedUp, 0),
);

/* The enrolled tile is a total, so what the window did to it goes in its description. */
const addedThisMonth = computed(() =>
  stats.value.enrolledDaily.reduce((total, day) => total + day, 0),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/* Folded by default: WebAuthn's own rules, none of which anybody here can change. */
const advanced = ref(false);

const GUIDES_URL = "https://idenzy.dev/docs/passkeys";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Passkeys">
      <template #badge>
        <StatusBadge
          :label="ready ? 'Ready' : 'Setup incomplete'"
          :tone="ready ? 'success' : 'warning'"
        />
      </template>
      <template #description>
        Signing in with a face, a fingerprint or a device PIN on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>, with no
        password behind it. Changes save as you make them.
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
          Passkey guides
        </v-btn>
      </template>
    </PageHeader>

    <!-- The blockers strip stands only while something is blocking; afterwards the badge
         above and the setup check below carry the state. -->
    <SetupBlockerCard
      v-if="!store.loading && blockers.length > 0"
      :blockers="blockers"
      description="Nobody can sign in with a passkey on this project until these are settled."
    >
      <template #actions>
        <FancyButton
          v-if="saved.relyingParty === null"
          :disabled="isBusy('create')"
          @click="partyDialog = true"
        >
          <Icon
            :class="isBusy('create') ? 'animate-spin' : ''"
            :name="isBusy('create') ? 'material-symbols:progress-activity' : 'material-symbols:add'"
            aria-hidden="true"
            class="text-sm"
          />
          Complete setup
        </FancyButton>
      </template>
      <template #action="{ blocker }">
        <v-btn
          v-if="blocker.id === 'disabled'"
          :loading="isBusy('enabled')"
          class="-mt-1 text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="setEnabled(true)"
        >
          {{ blocker.action }}
        </v-btn>
      </template>
    </SetupBlockerCard>

    <LayerCard
      description="The method, the domain your passkeys belong to, and the pages allowed to run a ceremony."
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
            Off, the ceremony endpoints answer as if the method did not exist, and enrolled
            credentials are kept for when it is back.
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
          description="The domain your pages share, and the one every application URL has to sit on. A passkey is bound to it, so changing it stops every passkey on the project answering and drops any URL off the new domain; the dialog says how many before it does anything. It is called the RP ID in WebAuthn and in our API."
          label="Passkey domain (RP ID)"
        >
          <template #actions>
            <template v-if="configured">
              <span class="font-mono text-xs text-ink/60" data-testid="rp-id">
                {{ party.rpId }}
              </span>
              <v-btn
                :loading="isBusy('rpId')"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:edit-outline"
                size="small"
                variant="text"
                @click="openRpIdDialog"
              >
                Change domain
              </v-btn>
            </template>
            <span v-else class="text-xs text-ink/45">Not set</span>
          </template>
        </SettingRow>

        <SettingRow
          description="What the authenticator shows when it asks someone to create or use a passkey. Your product, as its users know it, never us. A passkey is bound to the domain rather than to this, so a rename costs nothing."
          label="Product name"
        >
          <template #actions>
            <template v-if="configured">
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
                Edit
              </v-btn>
            </template>
            <span v-else class="text-xs text-ink/45">Not set</span>
          </template>
        </SettingRow>

        <SettingRow
          description="The pages allowed to run a ceremony, matched exactly: scheme, host and port, no wildcards, https everywhere but localhost. Each has to sit on the passkey domain, which is WebAuthn's rule and not ours. A ceremony from anywhere else is refused, whatever the domain says."
          label="Allowed application URLs"
        >
          <template #actions>
            <v-btn
              :disabled="!configured"
              :loading="isBusy('origins')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:add"
              size="small"
              variant="text"
              @click="originDialog = true"
            >
              Add URL
            </v-btn>
          </template>
          <template #detail>
            <!--
              Three columns on one grid rather than a flex row per URL: the glyph sits
              centred in a box the height of one line, so every host starts at the same x
              however long the scheme before it is.
            -->
            <ul
              v-if="party.origins.length > 0"
              class="m-0 list-none divide-y divide-line border-t border-line p-0"
            >
              <li
                v-for="origin in party.origins"
                :key="origin"
                class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 py-1.5"
              >
                <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
                  <Icon class="text-[15px] text-ink/45" name="material-symbols:language" />
                </span>
                <span class="truncate font-mono text-xs leading-4 text-ink">{{ origin }}</span>
                <v-tooltip
                  :disabled="party.origins.length > 1"
                  location="top"
                  text="The last URL stays: a project with none refuses every ceremony."
                >
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="inline-flex">
                      <v-btn
                        :disabled="party.origins.length < 2 || isBusy('origins')"
                        class="text-xs font-medium"
                        color="neutral"
                        size="small"
                        variant="text"
                        @click="removeOrigin(origin)"
                      >
                        Remove
                      </v-btn>
                    </span>
                  </template>
                </v-tooltip>
              </li>
            </ul>
            <p v-else class="m-0 border-t border-line pt-2 text-xs text-ink/45">
              None yet, so every ceremony is refused.
            </p>
          </template>
        </SettingRow>
      </div>
    </LayerCard>

    <SetupCheckCard
      v-if="configured"
      :checks="checks"
      :testing="testing"
      description="The four things that have to be true before a browser can finish a ceremony. Two of them are settled on other screens."
      note="Read from this project's own configuration, so it answers the moment something changes. Nothing here signs in on a user's behalf: a passkey needs the person and their device, which is the property that makes it worth having."
      @test="runTest"
    />

    <section class="flex flex-col gap-4">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Enrollment summary</h2>
        <p class="m-0 text-xs text-ink/55">
          Passkeys on this project, and what the last 30 days did to them.
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <!-- One short line each, so four tiles side by side are the same object four
             times. What each figure does and does not count is behind the glyph. -->
        <Statistic
          :previous="stats.signInsPrevious"
          :value="stats.signIns"
          compare="vs the 30 days before"
          description="Accepted, and given a session."
          info="Assertions that verified and issued a session. A ceremony somebody abandoned is not one."
          label="Sign-ins"
        />
        <Statistic
          :info="`Credentials on the project, across every account. ${addedThisMonth.toLocaleString('en')} were added in the last 30 days.`"
          :value="stats.enrolled"
          description="Credentials on this project."
          label="Passkeys enrolled"
        />
        <Statistic
          :value="stats.accounts"
          description="Accounts holding at least one."
          info="Accounts with a passkey they can sign in with. The rest sign in another way."
          label="Accounts with one"
        />
        <Statistic
          :previous="stats.refusedPrevious"
          :value="stats.refused"
          compare="vs the 30 days before"
          description="Assertions we would not take."
          info="A counter that went backwards, a URL off the list, or a challenge already spent."
          label="Refused"
          positive="down"
        />
      </div>

    </section>

    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">Where the passkeys live</h2>
          <p class="m-0 text-xs text-ink/55">
            By the authenticator that made each credential, from the AAGUID it volunteers.
          </p>
        </div>
        <p v-if="stats.enrolled > 0" class="m-0 text-xs text-ink/55">
          <span class="font-mono text-ink tabular-nums">{{ backedUp.toLocaleString("en") }}</span>
          of
          <span class="font-mono text-ink tabular-nums">{{ stats.enrolled.toLocaleString("en") }}</span>
          sync to a cloud
        </p>
      </header>

      <!-- The same card as the tiles above, one per authenticator: a mark and a name for
           the label, the count for the figure, and where those passkeys live under it. -->
      <div
        v-if="authenticators.length > 0"
        class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <v-card v-for="entry in authenticators" :key="entry.key" border flat>
          <div class="flex flex-col p-4">
            <div class="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" class="flex h-4 w-5 flex-none items-center justify-center">
                <Icon :class="entry.tint" :name="entry.icon" class="text-[15px]" />
              </span>
              <!-- Not `capitalize` as the tiles above are: these are proper nouns, and CSS
                   would make iCloud Keychain into ICloud Keychain. -->
              <span
                :title="entry.name"
                class="min-w-0 truncate text-[0.8125rem] font-medium text-ink/60"
              >
                {{ entry.name }}
              </span>
            </div>
            <p class="m-0 mt-4 flex items-baseline gap-2">
              <span
                class="font-mono text-2xl leading-none font-medium tracking-tight text-ink tabular-nums"
              >
                {{ entry.count }}
              </span>
              <span class="font-mono text-xs text-ink/55 tabular-nums">
                {{ share(entry.count) }}%
              </span>
            </p>
            <p class="m-0 mt-0.5 text-[0.6875rem] text-ink/55">
              {{ backupLine(entry.count, entry.backedUp) }}
            </p>
          </div>
        </v-card>
      </div>
      <v-card v-else border flat>
        <p class="m-0 px-4 py-6 text-center text-xs text-ink/50">
          No passkeys enrolled on this project yet.
        </p>
      </v-card>

      <!-- The caveat sits at the foot of what it qualifies, not above it. -->
      <p v-if="stats.enrolled > 0" class="m-0 text-[11px] leading-4 text-ink/55">
        Read from the backup-state flag each authenticator signs, never from anything the
        browser reports. A passkey bound to its device is lost with the device, which is what
        the recovery codes are for.
      </p>
    </section>

    <LayerCard
      v-model:open="advanced"
      expandable
      description="How every registration and assertion runs. None of it is configurable, and each row says why."
      title="Advanced WebAuthn details"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="Authentication options name no credential, so the browser offers whatever it holds for this domain, and the SDK's conditional sign-in puts that in the address field's autofill. An endpoint that took an email would say which addresses have passkeys, an enumeration oracle in front of the method we promote."
          fixed="Always"
          label="Usernameless, with autofill"
        />
        <SettingRow
          description="A passkey may answer a step-up or a second-factor challenge that something else demanded. Enrolling one never turns two-factor on for the account: a credential enrolled to sign in with must not silently start being demanded on top of the password."
          fixed="Never demanded"
          label="As a second factor"
        />
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
          description="We do not ask what make the authenticator is. Knowing it is not needed to trust the signature, and it is one more thing about a person to keep. The AAGUID an authenticator volunteers is recorded for the breakdown above and nothing else."
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
          description="Whether a passkey syncs to a provider's cloud or lives on one device is read from the flags the authenticator signs, not from anything the browser reports, and the split above counts them."
          fixed="Recorded"
          label="Backup state"
        />
      </div>

      <SamplePanel
        v-if="configured"
        class="mt-5"
        meta="At registration"
        note="What the SDK hands the browser, assembled from the settings above and the rules in these rows. Nothing in it is yours to set beyond the first line."
        title="What the browser is asked for"
      >
        <SampleLine
          v-for="option in options"
          :key="option.name"
          :name="option.name"
          :value="option.value"
        />
        <SampleLine class="mt-2" icon="material-symbols:info-outline" tone="muted">
          Sign-in sends the mirror of this with no
          <span class="font-mono">allowCredentials</span>, which is what lets the browser offer
          whatever it holds for this domain without being told an address first.
        </SampleLine>
      </SamplePanel>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <PasskeyPartyDialog v-model="partyDialog" @confirm="createParty" />
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
