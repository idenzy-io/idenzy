<script setup lang="ts">
/**
 * Step-up for the project: proving a factor again inside a session that already exists,
 * in front of something sensitive (PROJECT.md 4.5, apps/auth-api/src/mfa/step-up-service).
 * Nothing is created by one; a session's factor age moves and a fresh access token
 * carries the new `fva`, which is the claim a customer's own server reads.
 *
 * What a project decides is one number, how recent a proof has to be, and the screen
 * says so. The rest is listed row by row because most of it is a refusal the server
 * makes on its own: which of our routes ask, why a user holding nothing passes, why a
 * recovery code may not answer, and why a challenge minted in one session cannot raise
 * the factor age of another. An operator who finds "why was this address change refused"
 * should find the answer here rather than in a support ticket.
 *
 * The one control saves itself, as on the passwords screen. The figures on the side are
 * the step-up's own, and the breakdown counts what answered rather than who asked.
 */
import { humanizeSeconds } from "~/utils/otp";
import {
  isStepUpWindow,
  STEP_UP,
  STEP_UP_ASKS,
  STEP_UP_WINDOWS,
  type StepUpWindow,
  sampleClaims,
} from "~/utils/step-up";

const projects = useProjectStore();
const store = useMfaStore();

const saved = computed(() => store.stepUpFor(projects.current.id));
const stats = computed(() => store.stepUpStats(projects.current.id));

/* Which cards start unfolded. The window is what most visits are for, so it is open. */
const expanded = reactive({ window: true, asks: false, challenge: false, claim: false });

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

/* The segmented control hands back a string; it is narrowed before it is stored. */
const proofWindow = computed({
  get: () => String(saved.value.maxAgeMinutes),
  set: (value: string) => {
    const minutes = Number(value);
    if (!isStepUpWindow(minutes) || minutes === saved.value.maxAgeMinutes) return;
    void whileBusy("maxAge", () =>
      store.patchStepUp(projects.current.id, { maxAgeMinutes: minutes }),
    );
  },
});

const WINDOW_OPTIONS = STEP_UP_WINDOWS.map((minutes: StepUpWindow) => ({
  value: String(minutes),
  label: `${minutes} min`,
}));

const windowLabel = computed(() => humanizeSeconds(saved.value.maxAgeMinutes * 60));
const challengeLifetime = humanizeSeconds(STEP_UP.challengeSeconds);
const capLabel = humanizeSeconds(STEP_UP.maxAgeCapSeconds);

/* The box that shows what a step-up leaves in the token, with an age inside the window. */
const claims = sampleClaims(42);

/*
 * The figures.
 */
const answered = computed(() => [
  {
    key: "totp",
    name: "Authenticator app",
    icon: "material-symbols:timer-outline",
    count: stats.value.answeredBy.totp,
  },
  {
    key: "passkey",
    name: "Passkey",
    icon: "material-symbols:passkey",
    count: stats.value.answeredBy.passkey,
  },
]);

const totalAnswered = computed(() =>
  answered.value.reduce((total, entry) => total + entry.count, 0),
);

const share = (count: number) =>
  totalAnswered.value === 0 ? 0 : Math.round((count / totalAnswered.value) * 100);

const completionShare = computed(() =>
  stats.value.asked === 0 ? 0 : Math.round((stats.value.completed / stats.value.asked) * 100),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES = [
  {
    icon: "material-symbols:lock-clock-outline",
    title: "Step-up, end to end",
    detail: "startStepUp, a null that means go ahead, and the token that comes back.",
    href: "https://idenzy.dev/docs/mfa/step-up",
  },
  {
    icon: "material-symbols:token-outline",
    title: "Reading fva on your server",
    detail: "factorVerifiedSecondsAgo in @idenzy/node, and what null means.",
    href: "https://idenzy.dev/docs/sdk/node/claims",
  },
  {
    icon: "material-symbols:alternate-email",
    title: "Changing an address",
    detail: "The one action of ours that asks, and the two confirmations after it.",
    href: "https://idenzy.dev/docs/account/email-change",
  },
  {
    icon: "material-symbols:code",
    title: "The JS SDK's MFA calls",
    detail: "MfaChallenge, submit and submitPasskey.",
    href: "https://idenzy.dev/docs/sdk/js/mfa",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:lock-clock-outline" title="Step-up">
      <template #description>
        Proving a factor again inside a session, in front of something sensitive, on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>. How recent
        a proof has to be, what asks for one, and what a step-up leaves in the token.
        Changes save as you make them.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.window"
          expandable
          description="The one thing a project decides, and the three things the server decides about who is asked at all."
          title="The window"
        >
          <template #badge>
            <StatusBadge :label="`Within ${windowLabel}`" tone="neutral" />
          </template>
          <div class="divide-y divide-line">
            <SettingRow
              :description="`The session's factor age is compared against this before a sensitive action goes ahead. Long enough that changing an address and then a password does not ask twice; short enough that a session left open on a shared machine has stopped counting. The server caps it at ${capLabel}.`"
              label="How recent a proof has to be"
            >
              <SegmentedControl
                v-model="proofWindow"
                :disabled="isBusy('maxAge')"
                :options="WINDOW_OPTIONS"
                label="How recent a proof has to be"
              />
            </SettingRow>
            <SettingRow
              description="A user with no second factor passes, and that is deliberate rather than a hole: a step-up asks for something the caller holds, and somebody who holds nothing could never satisfy it, so demanding one would lock them out of changing their own address for ever. The check is worth exactly as much as the factor behind it, which is the honest shape of the guarantee."
              fixed="Passes"
              label="An account holding nothing"
            />
            <SettingRow
              description="Re-entering the password would let an account with nothing enrolled be asked for something, and is the honest fix for the row above. It is on the roadmap and not built, so today the only proofs are a second factor's."
              fixed="Not built"
              label="A password as the proof"
            />
            <SettingRow
              description="Nothing is created. The session's factor age moves, and a fresh access token comes back carrying the new age; no refresh token is reissued, because rotating the credential that mints tokens for a check that only reads would be a rotation nobody asked for."
              fixed="The session"
              label="What a step-up changes"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.asks"
          expandable
          description="Which actions want a recent proof: the ones we refuse on our own, and the ones your product decides."
          title="What asks for one"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="ask in STEP_UP_ASKS"
              :key="ask.id"
              :description="ask.note"
              :fixed="ask.live ? (ask.who === 'ours' ? 'Ours' : 'Yours') : 'Not yet'"
              :label="ask.label"
            />
          </div>

          <SamplePanel
            class="mt-5"
            note="Two calls on the client and one comparison on your server. The challenge carries what to prompt for, strongest first."
            title="Asking from your own code"
          >
            <dl class="m-0 grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div class="flex min-w-0 flex-col gap-0.5">
                <dt class="font-mono text-xs leading-5 text-ink">const challenge = await idenzy.mfa.startStepUp()</dt>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  Null means the caller holds nothing to be asked for: go ahead with the action.
                </dd>
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <dt class="font-mono text-xs leading-5 text-ink">await challenge.submit({ factor: "totp", code })</dt>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  Or submitPasskey(). The answer swaps the held token, so the next call is allowed.
                </dd>
              </div>
            </dl>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.challenge"
          expandable
          description="How a step-up challenge is minted, pinned and spent. It shares the attempt cap and the one refusal with a sign-in's, and differs where a session already exists."
          title="The challenge"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Pinned to the caller's user and to the caller's session, and both are checked when it is answered. A challenge minted in one session cannot raise the factor age of another, or a device that proved nothing would inherit a proof made somewhere else, for the same person."
              fixed="Always"
              label="Pinned to the session"
            />
            <SettingRow
              description="Minted for step-up and refused by the sign-in route, and the other way round. A challenge issued inside a session the caller already holds must not be spendable to create a new one."
              fixed="Never a sign-in"
              label="Its purpose"
            />
            <SettingRow
              description="A passkey and an authenticator, in that order: the passkey leads because it is the one factor phishing cannot carry away. A recovery code is not offered and is refused if presented: it is single use and exists for a lost phone, and spending one to confirm an email change spends the wrong thing, in a session that already has a cheaper way to ask."
              fixed="Passkey, app"
              label="What may answer"
            />
            <SettingRow
              :description="`How long a started step-up waits for its answer, set for the deployment. Longer than one authenticator step on purpose, so a code typed as the step rolls over can be retyped.`"
              :fixed="challengeLifetime"
              label="Lifetime"
            />
            <SettingRow
              :description="`Wrong answers before the challenge dies, and one refusal whatever went wrong: a wrong code, a spent step, a factor the challenge does not offer. Everyone at a step-up already holds a session, which is exactly what a stolen one looks like from here.`"
              :fixed="String(STEP_UP.attempts)"
              label="Attempts"
            />
            <SettingRow
              :description="`Start answers ${STEP_UP.nothingToAskStatus} and no challenge when the caller holds nothing to be asked for. A client that gets it should go ahead: the same absence is what lets them past the check on the other side.`"
              :fixed="String(STEP_UP.nothingToAskStatus)"
              label="Nothing to ask"
            />
            <SettingRow
              description="The factor age is read off the session row and not off the token in hand, because the row is what a step-up writes to and the token was minted before it. A caller who has just stepped up would otherwise still be refused until their next refresh."
              fixed="The row"
              label="Where the check reads"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.claim"
          expandable
          description="What a step-up leaves in the next access token, which is what your own server reads to decide whether an action goes ahead."
          title="The claim"
        >
          <div class="divide-y divide-line">
            <SettingRow label="fva">
              <template #description>
                The age of the most recent proof in seconds at the moment the token was
                minted, so a verifier compares a number and never a clock. Absent, not zero,
                when the session never proved a factor. A reserved name: a
                <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/tokens/claims">claim template</NuxtLink>
                cannot overwrite it.
              </template>
              <template #actions>
                <span class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55">Seconds</span>
              </template>
            </SettingRow>
            <SettingRow label="amr">
              <template #description>
                Gains the factor that answered and
                <span class="font-mono text-ink/80">mfa</span>, RFC 8176's own value for "more
                than one factor was used", beside what the first factor proved. Deduplicated,
                so a second step-up in one session does not list them twice.
              </template>
              <template #actions>
                <span class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55">Both factors</span>
              </template>
            </SettingRow>
            <SettingRow
              description="Carried across a refresh rather than dropped. The factor age belongs to the session and a rotation does not undo the proof; minting without it would make the claim disappear one access-token lifetime after a step-up, and a customer gating on it would ask for a proof the user had just given."
              fixed="Kept"
              label="After a refresh"
            />
            <SettingRow label="On your server">
              <template #description>
                <span class="font-mono text-ink/80">@idenzy/node</span> hands the claim on as
                <span class="font-mono text-ink/80">{{ STEP_UP.verifierField }}</span>, a number or
                null. Null means no restriction can be satisfied, never that none applies: a
                route that treats it as "nothing to check" has turned the guarantee off.
              </template>
              <template #actions>
                <span class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55">Number or null</span>
              </template>
            </SettingRow>
          </div>

          <SamplePanel
            class="mt-5"
            meta="After a step-up, a sample"
            note="The claims a step-up leaves beside the ones every token has. Compare the age against your own window and refuse the request when it is missing or past it."
            title="What the token carries"
          >
            <pre class="m-0 overflow-x-auto font-mono text-xs leading-5 text-ink"><code>{{ claims }}</code></pre>
          </SamplePanel>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Step-up</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="61" :series="stats.askedDaily" :value="stats.asked" info="Challenges minted in front of an action, by our routes and by yours." label="Asked" />
          <UsageTile :seed="67" :series="stats.completedDaily" :value="stats.completed" info="Challenges answered, each of which moved a session's factor age." label="Completed" />
          <UsageTile :seed="71" :series="stats.refusedDaily" :value="stats.refused" info="Actions of ours refused for a missing or stale proof, before any challenge was asked for." label="Refused" />
          <UsageTile :seed="73" :series="stats.passedThroughDaily" :value="stats.passedThrough" info="Starts answered 204: the account held nothing to be asked for, and the action went ahead." label="Passed through" />
        </div>

        <LayerCard :padded="false" description="By what completed each step-up. A recovery code never can." title="Answered with">
          <ul v-if="totalAnswered > 0" class="m-0 flex list-none flex-col gap-2.5 p-4 text-xs">
            <li v-for="entry in answered" :key="entry.key" class="flex items-center gap-2.5">
              <Icon :name="entry.icon" aria-hidden="true" class="flex-none text-base text-ink/70" />
              <span class="w-28 flex-none truncate text-ink/80">{{ entry.name }}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/8">
                <span :style="{ width: `${share(entry.count)}%` }" class="block h-full rounded-full bg-primary" />
              </span>
              <span class="w-12 flex-none text-right font-mono text-ink tabular-nums">{{ entry.count.toLocaleString("en") }}</span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            No step-up answered on this project yet.
          </p>
          <div
            v-if="stats.asked > 0"
            class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink/55"
          >
            <span>
              <span class="font-mono text-ink tabular-nums">{{ completionShare }}%</span> of asks were answered
            </span>
            <v-tooltip
              location="top"
              max-width="260"
              text="Challenges answered over challenges minted. The rest expired, ran out of attempts, or were abandoned with the action."
            >
              <template #activator="{ props: tip }">
                <Icon v-bind="tip" aria-label="What the share counts" class="flex-none text-sm text-ink/40" name="material-symbols:info-outline" role="img" />
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
  </div>
</template>
