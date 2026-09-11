<script setup lang="ts">
/**
 * Additional verification, arranged as `notes/mfa-step-up.md` asks: who can actually be
 * asked, then the window with a worked example, then an action-by-action matrix of who
 * enforces what, then the paired client and server example, with the mechanics folded at
 * the foot.
 *
 * The order is the note's P1 and it is the whole design. A fifteen-minute window reads as
 * enforcement for everybody, and it is not: `assertRecent` lets a user holding no passkey
 * and no authenticator past, because a step-up asks for something the caller holds and
 * somebody who holds nothing can never satisfy it. So the coverage figures and the
 * limitation come before the control, not in a footnote under it, and asking for the
 * password instead is named as not built rather than implied to exist.
 *
 * The matrix exists because this page used to make one claim over four unlike rows. One
 * route of ours refuses on this today; a second is guidance the SDK gives and our server
 * does not enforce yet; the customer's own actions are theirs to check with our claim; and
 * a signal cannot raise a step-up at all, though a detector rule can challenge a sign-in,
 * which is a different thing in a different place and is why the two screens read as
 * disagreeing.
 *
 * The window is a draft with Save and Cancel beside it rather than a control that writes
 * itself: it is small and reversible, so the note asks for no dialog, and the before and
 * after belong next to the thing that changed. The example follows the draft, because the
 * question a reader has is what the number they are about to save will do.
 */
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import { humanizeSeconds } from "~/utils/otp";
import {
  CLIENT_EXAMPLE,
  ENFORCEMENT_LABELS,
  ENFORCEMENT_TONES,
  isStepUpWindow,
  STEP_UP,
  STEP_UP_ACTIONS,
  STEP_UP_WINDOWS,
  type StepUpWindow,
  sampleClaims,
  serverExample,
  stepUpCoverage,
  windowSentence,
} from "~/utils/step-up";

const projects = useProjectStore();
const store = useMfaStore();
const users = useUsersStore();

const saved = computed(() => store.stepUpFor(projects.current.id));
const stats = computed(() => store.stepUpStats(projects.current.id));

/*
 * Coverage, first. A tombstone is left out: an erased account signs in to nothing, so
 * counting it as covered or as a gap would both be wrong.
 */
const coverage = computed(() =>
  stepUpCoverage(users.forProject(projects.current.id).filter((user) => user.deletedAt === null)),
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

/*
 * The window, as a draft. Small and reversible, so it is an inline Save and Cancel rather
 * than a dialog, and the example under it follows the draft rather than the saved value.
 */
const draft = ref<StepUpWindow>(saved.value.maxAgeMinutes);

watch(
  saved,
  (settings) => {
    draft.value = settings.maxAgeMinutes;
  },
  { immediate: true },
);

/* The control speaks strings; the value is one of four numbers, so the set is guarded. */
const windowChoice = computed<string>({
  get: () => String(draft.value),
  set: (value) => {
    const minutes = Number(value);
    if (isStepUpWindow(minutes)) draft.value = minutes;
  },
});

const WINDOW_OPTIONS: readonly SegmentedOption[] = STEP_UP_WINDOWS.map((minutes) => ({
  value: String(minutes),
  label: `${minutes} min`,
}));

const dirty = computed(() => draft.value !== saved.value.maxAgeMinutes);
const savingWindow = computed(() => isBusy("maxAge"));

async function saveWindow() {
  if (!dirty.value) return;
  await whileBusy("maxAge", () =>
    store.patchStepUp(projects.current.id, { maxAgeMinutes: draft.value }),
  );
}

function cancelWindow() {
  draft.value = saved.value.maxAgeMinutes;
}

const savedLabel = computed(() => humanizeSeconds(saved.value.maxAgeMinutes * 60));
const draftLabel = computed(() => humanizeSeconds(draft.value * 60));
const walk = computed(() => walkthrough(draft.value));

const challengeLifetime = humanizeSeconds(STEP_UP.challengeSeconds);
const capLabel = humanizeSeconds(STEP_UP.maxAgeCapSeconds);

/* The two halves of one contract, the server's written against the project's own window. */
const serverCode = computed(() => serverExample(draft.value));

/* The box that shows what a step-up leaves in the token, with an age inside the window. */
const claims = sampleClaims(42);

/*
 * The figures. `Statistic` tiles rather than the sparkline rail this screen used to carry,
 * as on every other method screen.
 */
const completionShare = computed(() =>
  stats.value.asked === 0 ? 0 : Math.round((stats.value.completed / stats.value.asked) * 100),
);

const askedHeading = computed(() =>
  stats.value.asked === 0
    ? "No step-up was asked for in the last 30 days"
    : `${completionShare.value}% of the step-ups asked for were answered`,
);

/* Folded: everything nobody can change, which is where the note wants the mechanics. */
const expanded = reactive({ example: false, challenge: false, claim: false });

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES_URL = "https://idenzy.dev/docs/mfa/step-up";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <!-- "Additional verification" alone, with the spec's own word in the first line: the
         header's title is one truncating line, and the parenthetical the note draws is what
         gets cut on a phone. -->
    <PageHeader title="Additional verification">
      <template #description>
        Also called step-up: proving a factor again inside a session that already exists, in
        front of something sensitive, on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >. One project decision, and a short list of who enforces it.
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
          Step-up guide
        </v-btn>
      </template>
    </PageHeader>

    <!--
      Coverage before the control, which is the note's P1: a window is not enforcement for
      everybody, and the number that says so is a count of accounts.
    -->
    <section class="flex flex-col gap-4">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Who can be asked</h2>
        <p class="m-0 text-xs text-ink/55">
          A step-up can only ask for a factor the account already holds: a passkey or an
          authenticator, in that order. A recovery code never answers one.
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2">
        <Statistic
          :description="`${coverage.share}% of accounts on this project.`"
          :value="coverage.challengeable"
          info="Accounts holding a passkey or a confirmed authenticator. These are the accounts a sensitive action can be refused for."
          label="Can be asked"
        />
        <Statistic
          :value="coverage.passing"
          description="Hold neither, so nothing is asked."
          info="Accounts with no passkey and no authenticator. Every check on this page lets them through, because a challenge nobody can answer is an action nobody could ever complete."
          label="Cannot be asked"
        />
      </div>

      <!-- The limitation, stated where the note puts it: above the freshness choice, in
           the same tray shape as the cards around it rather than a tinted notice. -->
      <div
        class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-(--idenzy-radius-large) bg-ink/4 ring-1 ring-ink/6 ring-inset px-4 py-3"
      >
        <p class="m-0 flex w-full min-w-0 items-start gap-3 text-xs leading-5 text-ink/70 sm:w-auto sm:flex-1">
          <span aria-hidden="true" class="flex h-5 w-5 flex-none items-center justify-center">
            <Icon class="text-base text-warning" name="material-symbols:error-outline" />
          </span>
          <span class="min-w-0">
            <template v-if="coverage.passing > 0">
              <span class="font-mono text-ink/80">
                {{ coverage.passing.toLocaleString("en") }}
              </span>
              {{ coverage.passing === 1 ? "account holds" : "accounts hold" }} no second
              factor, so the window below does not apply to
              {{ coverage.passing === 1 ? "it" : "them" }}: a sensitive action goes ahead
              without a check. Asking for the password again would be the honest fix and is
              not built, so the way to close this is enrolment.
            </template>
            <template v-else>
              Every account here holds a factor, so the window below applies to all of them.
              An account enrolling nothing later would pass every check until it does:
              a step-up can only ask for something the caller holds.
            </template>
          </span>
        </p>
        <div class="flex flex-none flex-wrap items-center gap-1">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            to="/mfa/totp"
            variant="text"
          >
            Authenticator apps
          </v-btn>
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            to="/methods/passkeys"
            variant="text"
          >
            Passkeys
          </v-btn>
        </div>
      </div>
    </section>

    <!--
      The one decision. A draft with Save beside it: the note asks for no modal on a small
      reversible number, and for the before and after next to what changed.
    -->
    <LayerCard
      description="How recent the last successful factor check has to be before a sensitive action goes ahead."
      title="Ask again after"
    >
      <template #badge>
        <StatusBadge
          :label="dirty ? 'Unsaved changes' : savedLabel"
          :tone="dirty ? 'warning' : 'neutral'"
        />
      </template>

      <div class="divide-y divide-line">
        <SettingRow
          :description="`Compared against the session's own factor age, which a step-up writes and a refresh carries over. Long enough that changing an address and then a password does not ask twice, short enough that a session left open on a shared machine has stopped counting. The server caps it at ${capLabel}.`"
          label="Ask again after"
        >
          <SegmentedControl
            v-model="windowChoice"
            :disabled="savingWindow"
            :options="WINDOW_OPTIONS"
            label="Ask again after"
          />
        </SettingRow>
      </div>

      <!--
        One person's afternoon rather than a table of ages: the sequence is what a reader
        came to understand, and it ends on the answer that puts the user back where they
        started. Every figure in it follows the draft, so the answer to "what will this do"
        is on screen before it is saved.
      -->
      <SamplePanel
        :meta="dirty ? `Draft: ${draftLabel}` : `In force: ${savedLabel}`"
        :note="windowSentence(draft)"
        class="mt-5"
        title="What a user runs into"
      >
        <ol class="m-0 flex list-none flex-col gap-2 p-0">
          <template v-for="step in walk.steps" :key="step.id">
            <!-- The line the window draws, drawn where it falls in the story. The rules are
                 decoration; the caption is the sentence that carries it. -->
            <!-- A rule across and the caption under it on a phone, where two rules either
                 side of a sentence leave a stub each; the pair on a desktop, where the
                 caption is the width of a few words. -->
            <li
              v-if="step.id === walk.boundaryBefore"
              class="flex flex-col gap-1 py-0.5 text-[11px] leading-4 text-warning/85 sm:flex-row sm:items-center sm:gap-3"
            >
              <span aria-hidden="true" class="h-px w-full bg-warning/25 sm:w-auto sm:flex-1" />
              <span class="flex-none">{{ walk.boundary }}</span>
              <span aria-hidden="true" class="hidden h-px bg-warning/25 sm:block sm:flex-1" />
            </li>

            <li
              class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 sm:grid-cols-[1.25rem_minmax(0,26rem)_minmax(0,1fr)] sm:gap-x-6"
            >
              <span
                aria-hidden="true"
                class="flex size-5 items-center justify-center rounded-full bg-ink/8 font-mono text-[10px] leading-none font-medium text-ink/70 tabular-nums"
              >
                {{ step.number }}
              </span>
              <span class="text-xs leading-5 text-ink/75">{{ step.what }}</span>
              <!-- Under the sentence on a phone, and beside it on a desktop rather than at
                   the row's far edge. The sentence column is bounded rather than free: every
                   row is its own grid, so a `1fr` third column aligns the answers only by
                   pushing them to the panel's edge, a screen's width from the line they
                   answer. -->
              <span
                :class="step.fresh ? 'text-ink/55' : 'text-warning'"
                class="col-start-2 text-[11px] leading-5 sm:col-start-3"
              >
                {{ step.outcome }}
              </span>
            </li>
          </template>
        </ol>

        <p class="m-0 mt-3 border-t border-line/60 pt-2.5 text-[11px] leading-4 text-ink/55">
          An account holding no passkey and no authenticator never reaches the third step.
          There is nothing to ask it for, so the change goes ahead.
        </p>
      </SamplePanel>

      <!-- Save at the section's bottom right, Cancel immediately to its left. -->
      <div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <p v-if="dirty" class="m-0 mr-auto text-[11px] leading-4 text-ink/55">
          <span class="text-ink/80">{{ savedLabel }}</span> today,
          <span class="text-ink/80">{{ draftLabel }}</span> once saved. It applies to the next
          action anybody attempts: no session is signed out, and nobody's existing proof is
          cleared.
        </p>
        <v-btn
          :disabled="!dirty || savingWindow"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="cancelWindow"
        >
          Cancel changes
        </v-btn>
        <v-btn
          :disabled="!dirty"
          :loading="savingWindow"
          class="text-xs font-medium"
          color="primary"
          size="small"
          variant="flat"
          @click="saveWindow"
        >
          Save window
        </v-btn>
      </div>
    </LayerCard>

    <!--
      Who enforces what. Four unlike answers used to read as one claim of protection, so
      each row names the party that refuses and what happens today. Three columns on a
      desktop with a head above them; below `sm` the action becomes the row's own label and
      the rest sits under it as a summary.
    -->
    <LayerCard
      :padded="false"
      description="What actually asks for a recent proof. Exactly one route of ours refuses on it today; the rest is named for what it is."
      title="Action by action"
    >
      <div
        aria-hidden="true"
        class="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.6fr)] gap-x-6 border-b border-line px-4 py-2.5 text-[11px] text-ink/45 sm:grid"
      >
        <span>Action</span>
        <span>Enforced by</span>
        <span>What happens today</span>
      </div>

      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="entry in STEP_UP_ACTIONS"
          :key="entry.id"
          class="grid gap-x-6 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]"
        >
          <span class="flex min-w-0 items-start gap-2.5">
            <span aria-hidden="true" class="flex h-5 w-5 flex-none items-center justify-center">
              <Icon :name="entry.icon" class="text-base text-ink/45" />
            </span>
            <span class="text-xs leading-5 font-medium text-ink">{{ entry.action }}</span>
          </span>

          <span class="flex min-w-0 flex-col items-start gap-1.5">
            <Tag
              :label="ENFORCEMENT_LABELS[entry.enforcement]"
              :tone="ENFORCEMENT_TONES[entry.enforcement]"
            />
            <span class="text-[11px] leading-4 text-ink/55">{{ entry.enforcedBy }}</span>
          </span>

          <span class="flex min-w-0 flex-col items-start gap-1.5">
            <span class="text-[11px] leading-4 text-ink/60">{{ entry.behaviour }}</span>
            <NuxtLink
              v-if="entry.link"
              :to="entry.link.to"
              class="inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
            >
              {{ entry.link.label }}
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
            </NuxtLink>
          </span>
        </li>
      </ul>

      <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
        Nothing here is a switch. A step-up is a refusal the party in the middle column makes,
        so the only thing this project decides is how recent the proof behind it has to be.
      </p>
    </LayerCard>

    <!--
      The paired example. One contract, both halves together: split up, the client's null
      and the server's null read as the same "allow" and they are not the same thing.
    -->
    <LayerCard
      v-model:open="expanded.example"
      expandable
      description="The client call that raises a challenge and the server check that refuses without one, written against the window above."
      title="Client and server, together"
    >
      <div class="grid gap-4 lg:grid-cols-2 lg:items-start">
        <SamplePanel meta="Client" note="A null challenge means this caller holds nothing to be asked for. Go ahead: the same absence is what lets them past the check on the other side." title="Raising the challenge">
          <pre
            class="m-0 overflow-x-auto font-mono text-[11px] leading-5 text-ink"
          ><code>{{ CLIENT_EXAMPLE }}</code></pre>
        </SamplePanel>

        <SamplePanel meta="Server" note="A null claim is the opposite case: no proof can be given, never that none is needed. A route that reads it as nothing to check has turned the guarantee off." title="Refusing without a proof">
          <pre
            class="m-0 overflow-x-auto font-mono text-[11px] leading-5 text-ink"
          ><code>{{ serverCode }}</code></pre>
        </SamplePanel>
      </div>

      <p class="m-0 mt-4 text-[11px] leading-4 text-ink/55">
        The two nulls are not the same answer. On the client it means there is nothing to ask
        this caller for, which is why the action goes ahead. On the server it means the
        session never proved a factor, which is why the request is refused when your own rule
        needs one. Treating either as "allow everything" is how a check stops being one.
      </p>
    </LayerCard>

    <section class="flex flex-col gap-4">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">{{ askedHeading }}</h2>
        <p class="m-0 text-xs text-ink/55">
          Over the last 30 days on this project, counting our own routes and yours.
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistic
          :value="stats.asked"
          description="Challenges raised in front of an action."
          info="Step-up challenges minted, by our routes and by yours. A challenge nobody answered still counts."
          label="Asked"
        />
        <Statistic
          :info="`Answered, and each one moved a session's factor age. ${stats.answeredBy.passkey.toLocaleString('en')} by a passkey and ${stats.answeredBy.totp.toLocaleString('en')} by an authenticator; a recovery code never answers one.`"
          :value="stats.completed"
          description="Answered with a factor."
          label="Completed"
        />
        <Statistic
          :value="stats.refused"
          description="Actions refused for a stale proof."
          info="Actions of ours answered reauthentication_required because the proof was missing or past the window, before any challenge was asked for."
          label="Refused"
        />
        <Statistic
          :value="stats.passedThrough"
          description="Nothing to ask, so they went ahead."
          info="Starts answered 204: the account held no passkey and no authenticator, so the action was allowed. This is the coverage gap above, counted as it happens."
          label="Passed through"
        />
      </div>
    </section>

    <!-- Reference, folded, at the foot: how a challenge is minted and what the token then
         carries. None of it is configurable. -->
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
        <SettingRow
          description="Nothing is created. The session's factor age moves and a fresh access token comes back carrying the new age; no refresh token is reissued, because rotating the credential that mints tokens for a check that only reads would be a rotation nobody asked for."
          fixed="The session"
          label="What a step-up changes"
        />
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.claim"
      expandable
      description="What a step-up leaves in the next access token, which is what your own server reads to decide whether an action goes ahead."
      title="The claim in the token"
    >
      <div class="divide-y divide-line">
        <SettingRow label="fva">
          <template #description>
            The age of the most recent proof in seconds at the moment the token was minted,
            so a verifier compares a number and never a clock. Absent, not zero, when the
            session never proved a factor. A reserved name: a
            <NuxtLink
              class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/tokens/claims"
              >claim template</NuxtLink
            >
            cannot overwrite it.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Seconds
            </span>
          </template>
        </SettingRow>
        <SettingRow label="amr">
          <template #description>
            Gains the factor that answered and
            <span class="font-mono text-ink/80">mfa</span>, RFC 8176's own value for "more
            than one factor was used", beside what the first factor proved. Deduplicated, so
            a second step-up in one session does not list them twice.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Both factors
            </span>
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
            <span class="font-mono text-ink/80">{{ STEP_UP.verifierField }}</span
            >, a number or null. Null means no restriction can be satisfied, never that none
            applies: a route that treats it as "nothing to check" has turned the guarantee
            off.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Number or null
            </span>
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

    <SaveStatus :last-saved="lastSaved" :saving="saving" />
  </div>
</template>
