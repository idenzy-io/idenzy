<script setup lang="ts">
/**
 * Authenticator apps for the project, arranged as `notes/mfa-totp.md` asks: availability
 * and who is challenged, the name an app files the account under beside a live preview of
 * it, the journey a user walks, then coverage, with everything nobody can change folded
 * at the foot.
 *
 * The screen exists to answer one question before any control is touched. Available is
 * not required: an authenticator is demanded of the accounts that enrolled one and of
 * nobody else, a project-wide requirement is not built, and a green badge cannot say
 * either of those things. So the strip under the header says it in a sentence with the
 * count in it, and the matrix below says it case by case, which is what replaced a card
 * of prose about factors that demand and factors that answer.
 *
 * Two save models, as on passwords. The switch is one discrete state and writes at once,
 * asking first when it would stop accounts being challenged, because that is a decision
 * about somebody else's defence and the switch itself cannot state the number. The name
 * is typed, so it is a draft with Save and Cancel: saving the "A" of "Acme" would file
 * every enrolment started in the meantime under the wrong product.
 *
 * The example secret and code are sample values behind a disclosure, clearly labelled,
 * because a page about second factors that shows a secret is a page somebody reads as
 * their own enrolment. The reader's own authenticator is on Account, and the sample says so.
 */

import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import {
  CHALLENGE_SCENARIOS_NOTE,
  challengeScenarios,
  coverageOf,
  ENROLMENT_JOURNEY,
  FACTOR_ROLES,
  groupCode,
  groupSecret,
  ISSUER_ISSUE_LABELS,
  ISSUER_MAX_LENGTH,
  OUTCOME_TONES,
  otpauthUri,
  SAMPLE_ACCOUNT,
  SAMPLE_SECRET,
  scopeSummary,
  TOTP,
  validateIssuer,
} from "~/utils/mfa";
import { humanizeSeconds, SAMPLE_CODE } from "~/utils/otp";

const projects = useProjectStore();
const store = useMfaStore();
const passkeys = usePasskeysStore();

const saved = computed(() => store.authenticatorFor(projects.current.id));
const stats = computed(() => store.authenticatorStats(projects.current.id));

/* Two numbers, read by the strip, the switch's own sentence and the tiles at the foot. */
const coverage = computed(() => coverageOf(stats.value.enrolled, stats.value.accounts));

/* The fields on their way to the server, so each control can show its own wait. */
const busy = ref<Set<string>>(new Set());

function isBusy(key: string): boolean {
  return busy.value.has(key);
}

/** Answers whether the server took it, so a dialog can stay open on a failure. */
async function whileBusy(key: string, work: () => Promise<void>): Promise<boolean> {
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
    return true;
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

/*
 * Availability. On costs nobody anything and writes at once; off stops a code being
 * asked for on every account that holds one, so it is asked for with the count in front
 * of it.
 */
const disableDialog = ref(false);

function setEnabled(enabled: boolean) {
  if (enabled === saved.value.enabled) return;
  if (!enabled) {
    disableDialog.value = true;
    return;
  }
  void whileBusy("enabled", () => store.patchAuthenticator(projects.current.id, { enabled }));
}

async function confirmDisable() {
  const written = await whileBusy("enabled", () =>
    store.patchAuthenticator(projects.current.id, { enabled: false }),
  );
  if (written) disableDialog.value = false;
}

/** Passkey sign-in is the one other way an account here proves two factors. */
const passkeysOn = computed(() => {
  const settings = passkeys.settingsFor(projects.current.id);
  return settings.enabled && settings.relyingParty !== null;
});

/*
 * The name an app files the account under, as a draft.
 *
 * Two states rather than one field, because "follow the project's name" is a choice and
 * not an empty string: null carries a later rename of the project along, and a name typed
 * here holds still. The mode is what the reader picks; the field only exists for the
 * second one.
 */
type IssuerMode = "project" | "custom";

const issuerMode = ref<IssuerMode>("project");
const nameText = ref("");
const touched = ref(false);

const MODES: readonly SegmentedOption[] = [
  { value: "project", label: "Project name" },
  { value: "custom", label: "Custom name" },
];

/* The control speaks strings; the state is one of two words, so the set is guarded. */
const mode = computed<string>({
  get: () => issuerMode.value,
  set: (value) => {
    if (value === "project" || value === "custom") issuerMode.value = value;
  },
});

watch(
  saved,
  (settings) => {
    issuerMode.value = settings.issuer === null ? "project" : "custom";
    nameText.value = settings.issuer ?? "";
    touched.value = false;
  },
  { immediate: true },
);

/* Switching to a custom name starts from the one in force, which is what a rename is. */
watch(issuerMode, (next) => {
  if (next === "custom" && nameText.value.trim() === "") nameText.value = projects.current.name;
});

const issue = computed(() =>
  issuerMode.value === "project" ? null : validateIssuer(nameText.value),
);

/* Not shown against an untouched field: a blank one is unfinished, not wrong. */
const nameError = computed(() =>
  !touched.value || issue.value === null ? "" : ISSUER_ISSUE_LABELS[issue.value],
);

/** What would be written: null to follow the project, or the name trimmed. */
const draftIssuer = computed(() => (issuerMode.value === "project" ? null : nameText.value.trim()));

const nameDirty = computed(() => draftIssuer.value !== saved.value.issuer);
const nameSaving = computed(() => isBusy("issuer"));
const canSaveName = computed(() => nameDirty.value && issue.value === null);

async function saveName() {
  touched.value = true;
  if (!canSaveName.value) return;
  await whileBusy("issuer", () =>
    store.patchAuthenticator(projects.current.id, { issuer: draftIssuer.value }),
  );
  touched.value = false;
}

function cancelName() {
  issuerMode.value = saved.value.issuer === null ? "project" : "custom";
  nameText.value = saved.value.issuer ?? "";
  touched.value = false;
}

/* The name in force, and the name the draft would put there. */
const savedName = computed(() => saved.value.issuer ?? projects.current.name);

/*
 * The preview follows the draft, not the saved name, so a rename shows before it is
 * written. A blank custom name previews the project's own, which is what the field's
 * placeholder promises and what the server would fall back to anyway.
 */
const previewName = computed(() =>
  draftIssuer.value === null || draftIssuer.value === ""
    ? projects.current.name
    : draftIssuer.value,
);

const uri = computed(() => otpauthUri(previewName.value, SAMPLE_ACCOUNT, SAMPLE_SECRET));
const sampleCode = groupCode(SAMPLE_CODE);
const sampleSecret = groupSecret(SAMPLE_SECRET);

/* Folded, and labelled a sample when open: a secret on this screen must never read as
   somebody's own enrolment. */
const sampleOpen = ref(false);

/* A dialog and a disclosure both belong to the project they were opened from. */
watch(
  () => projects.current.id,
  () => {
    disableDialog.value = false;
    sampleOpen.value = false;
  },
);

/*
 * Who is challenged, and how recent a proof has to be for a sensitive action.
 */
const stepUpWindow = computed(() => humanizeSeconds(TOTP.stepUpSeconds));
const scenarios = computed(() => challengeScenarios(stepUpWindow.value));
const challengeLifetime = humanizeSeconds(TOTP.challengeSeconds);

/*
 * Coverage. What answered each challenge takes its label and its glyph from the factor
 * family, so this screen and the recovery one name a factor the same way.
 */
const ANSWERING = [
  { kind: "totp", note: "The code the app generated." },
  { kind: "passkey", note: "Offered first where the account holds one." },
  { kind: "recovery", note: "A single-use code, spent to get back in." },
] as const;

const answered = computed(() =>
  ANSWERING.map(({ kind, note }) => {
    const role = FACTOR_ROLES.find((entry) => entry.kind === kind);
    return {
      kind,
      note,
      label: role?.label ?? kind,
      icon: role?.icon ?? "material-symbols:shield-lock-outline",
      count: stats.value.answeredBy[kind],
    };
  }),
);

const totalAnswered = computed(() =>
  answered.value.reduce((total, entry) => total + entry.count, 0),
);

const share = (count: number) =>
  totalAnswered.value === 0 ? 0 : Math.round((count / totalAnswered.value) * 100);

/* The heading states what was found rather than naming the topic again. */
const coverageHeading = computed(() =>
  coverage.value.enrolled === 0
    ? "No account holds an authenticator yet"
    : `${coverage.value.share}% of accounts hold an authenticator`,
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/* Folded by default: RFC 6238's own rules and the enrolment's, none of them ours. */
const advanced = ref(false);

const GUIDES_URL = "https://idenzy.dev/docs/mfa/totp";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Authenticator apps">
      <template #badge>
        <StatusBadge
          :label="saved.enabled ? 'Available' : 'Disabled'"
          :tone="saved.enabled ? 'success' : 'neutral'"
        />
      </template>
      <template #description>
        Time-based codes from an app on the user's phone, on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >: the one factor that turns two-factor on for an account.
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
          Authenticator guides
        </v-btn>
      </template>
    </PageHeader>

    <!--
      Enforcement scope, ahead of every control. The badge above says whether the method
      exists and the switch says what it does; neither can answer "must everybody enrol",
      because that answer is a count. The strip is the tray of a card with no panel in
      it, so it belongs to the same family as the sections below rather than being a
      tinted notice of its own.
    -->
    <section
      class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-(--idenzy-radius-large) bg-ink/4 ring-1 ring-ink/6 ring-inset px-4 py-3"
    >
      <!-- Full width below `sm`, or the link keeps its place on the line and the
           sentence is squeezed into a narrow column seven lines tall. -->
      <p class="m-0 flex w-full min-w-0 items-start gap-3 text-xs leading-5 text-ink/70 sm:w-auto sm:flex-1">
        <span aria-hidden="true" class="flex h-5 w-5 flex-none items-center justify-center">
          <Icon class="text-base text-ink/45" name="material-symbols:shield-outline" />
        </span>
        <span class="min-w-0">{{ scopeSummary(saved.enabled, coverage) }}</span>
      </p>
      <NuxtLink
        class="inline-flex flex-none items-center gap-0.5 text-xs font-medium text-ink no-underline hover:underline"
        to="/users?mfa=yes"
      >
        Who has one
        <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
      </NuxtLink>
    </section>

    <LayerCard
      description="Whether users can add an authenticator, and whether the project can insist on it."
      title="Availability"
    >
      <template #badge>
        <StatusBadge
          :label="saved.enabled ? 'Available' : 'Disabled'"
          :tone="saved.enabled ? 'success' : 'neutral'"
        />
      </template>

      <div class="divide-y divide-line">
        <SettingRow label="Make authenticator enrolment available">
          <template #description>
            Users add an app from inside a session and are asked for its code at every
            sign-in afterwards. Off, enrolment answers as if the method did not exist and
            <template v-if="coverage.enrolled > 0">
              the
              <span class="font-mono text-ink/80">
                {{ coverage.enrolled.toLocaleString("en") }}
              </span>
              {{ coverage.enrolled === 1 ? "account" : "accounts" }} holding one
              {{ coverage.enrolled === 1 ? "signs" : "sign" }} in with one factor. Nothing
              is deleted either way.
            </template>
            <template v-else>
              nothing already enrolled is deleted. No account holds one today.
            </template>
          </template>
          <v-switch
            :disabled="isBusy('enabled')"
            :loading="isBusy('enabled')"
            :model-value="saved.enabled"
            aria-label="Make authenticator enrolment available"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="setEnabled($event === true)"
          />
        </SettingRow>

        <SettingRow
          description="A second factor is owed because the account enrolled one, which is per user and never per project. Requiring it of everybody needs an enrolment step inside sign-in, or the first person without an app is refused a sign-in they cannot complete; that step is on the roadmap and this row will become a switch when it lands."
          fixed="Not yet"
          label="Require every user to enrol"
        />
      </div>
    </LayerCard>

    <!--
      The name and what it makes, in one card rather than two: on a phone the preview has
      to follow the field it previews, and two cards would put the save row between them.
      `lg:items-start` or the preview is stretched to the editor's height and ends in a
      panel of empty surface.
    -->
    <LayerCard
      description="What an authenticator app shows beside the address, in its own list of every app the person has."
      title="Name shown in authenticator apps"
    >
      <template #badge>
        <!-- The saved value in the heading, as on the passwords screen: nobody should
             have to read the control to find out what is in force. -->
        <StatusBadge
          :label="nameDirty ? 'Unsaved changes' : (saved.issuer ?? 'Project name')"
          :tone="nameDirty ? 'warning' : 'neutral'"
        />
      </template>

      <div class="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div class="flex min-w-0 flex-col gap-4">
          <div class="flex min-w-0 flex-col gap-2">
            <span class="text-sm font-medium text-ink">Where the name comes from</span>
            <!-- In a row of its own: the control is `inline-flex`, and a flex column
                 would otherwise stretch it across the card. -->
            <div class="flex">
              <SegmentedControl v-model="mode" :options="MODES" label="Where the name comes from" />
            </div>
            <p class="m-0 text-xs leading-5 text-ink/60">
              The project's name follows a rename of the project. A custom name holds still,
              which is what you want when the product and the project are called different
              things.
            </p>
          </div>

          <div v-if="mode === 'custom'" class="flex min-w-0 flex-col gap-1">
            <label class="text-xs font-medium text-ink" for="totp-issuer">Custom name</label>
            <v-text-field
              id="totp-issuer"
              v-model="nameText"
              :error="nameError !== ''"
              :placeholder="projects.current.name"
              autocomplete="off"
              density="compact"
              hide-details
              name="idenzy-authenticator-name"
              variant="filled"
              @blur="touched = true"
            />
            <p v-if="nameError" class="m-0 text-[11px] leading-4 text-error">{{ nameError }}</p>
            <p v-else class="m-0 text-[11px] leading-4 text-ink/50">
              Short, and the product's as its users know it: at most {{ ISSUER_MAX_LENGTH }}
              characters, and every app cuts a long one off.
            </p>
          </div>

          <p class="m-0 text-xs leading-5 text-ink/60">
            Apps already enrolled keep the name they were enrolled with, because the entry
            lives on the phone. This is what the next enrolment files the account under.
          </p>
        </div>

        <SamplePanel meta="Sample" title="What the app shows">
          <template #note>
            A sample account, not anybody's. Your own authenticator is on
            <NuxtLink
              class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/settings/account"
            >
              Account </NuxtLink
            >.
          </template>

          <div
            class="flex items-center gap-3 rounded-(--idenzy-radius-x-small) bg-surface px-3.5 py-3 ring-1 ring-ink/6 ring-inset"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate text-xs font-medium text-ink">{{ previewName }}</span>
              <span class="truncate text-[11px] text-ink/55">{{ SAMPLE_ACCOUNT }}</span>
            </div>
            <span
              class="font-mono text-xl leading-none font-medium tracking-wider text-ink tabular-nums"
            >
              {{ sampleCode }}
            </span>
            <!-- The thirty seconds an app draws, held still: a code that counted down
                 would read as one somebody could type. -->
            <svg
              aria-hidden="true"
              class="size-5 flex-none -rotate-90 text-primary"
              viewBox="0 0 20 20"
            >
              <circle
                cx="10"
                cy="10"
                fill="none"
                r="8"
                stroke="currentColor"
                stroke-opacity="0.18"
                stroke-width="2"
              />
              <circle
                cx="10"
                cy="10"
                fill="none"
                r="8"
                stroke="currentColor"
                stroke-dasharray="50.27"
                stroke-dashoffset="18"
                stroke-linecap="round"
                stroke-width="2"
              />
            </svg>
          </div>

          <!-- Only where the preview and the saved name actually differ: pinning the
               project's own name is a change with nothing to warn about. -->
          <p
            v-if="nameDirty && previewName !== savedName"
            class="m-0 mt-2.5 text-[11px] leading-4 text-warning"
          >
            Not saved yet. Enrolments today still file the account under
            <span class="font-medium">{{ savedName }}</span>.
          </p>

          <!-- The enrolment data behind a disclosure, as the note asks: it is the part a
               reader mistakes for their own, and it is only needed while integrating. -->
          <v-btn
            :append-icon="
              sampleOpen
                ? 'material-symbols:visibility-off-outline'
                : 'material-symbols:visibility-outline'
            "
            class="mt-3 -ml-2 text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="sampleOpen = !sampleOpen"
          >
            {{ sampleOpen ? "Hide sample enrolment data" : "Show sample enrolment data" }}
          </v-btn>

          <div v-if="sampleOpen" class="mt-2 flex flex-col gap-2">
            <div
              class="flex flex-col gap-1 rounded-(--idenzy-radius-x-small) bg-surface px-3.5 py-3 ring-1 ring-ink/6 ring-inset"
            >
              <span class="text-[11px] text-ink/55">Typed instead of scanned</span>
              <span class="font-mono text-xs tracking-wide text-ink">{{ sampleSecret }}</span>
            </div>
            <SampleLine icon="material-symbols:qr-code-2" mono>{{ uri }}</SampleLine>
            <SampleLine icon="material-symbols:info-outline" tone="muted">
              Example values, generated by nobody and belonging to nobody. A real secret is
              returned once, to the user's own session, and is never shown here.
            </SampleLine>
          </div>
        </SamplePanel>
      </div>

      <!-- Save at the section's bottom right, Cancel immediately to its left. -->
      <div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        <p v-if="nameDirty" class="m-0 mr-auto text-[11px] text-ink/55">
          Not saved yet. Nothing changes for anybody until you save.
        </p>
        <v-btn
          :disabled="!nameDirty || nameSaving"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="cancelName"
        >
          Cancel changes
        </v-btn>
        <v-btn
          :disabled="!canSaveName"
          :loading="nameSaving"
          class="text-xs font-medium"
          color="primary"
          size="small"
          variant="flat"
          @click="saveName"
        >
          Save name
        </v-btn>
      </div>
    </LayerCard>

    <!--
      The factor model as a matrix, which is what replaced three cards of prose about
      factors that demand and factors that answer. Two columns on desktop with a head
      above them; below `sm` the head goes and the scenario becomes the row's own label,
      with the result under it, which is the short labelled row the note asks for.
    -->
    <LayerCard
      :padded="false"
      description="What a sign-in does, by how it signed in and what the account holds. Nothing here is configurable: it is the gate's own answer."
      title="Who is challenged?"
    >
      <div
        aria-hidden="true"
        class="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-x-6 border-b border-line px-4 py-2.5 text-[11px] text-ink/45 sm:grid"
      >
        <span>Scenario</span>
        <span>Result</span>
      </div>

      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="scenario in scenarios"
          :key="scenario.id"
          class="grid gap-x-6 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
        >
          <span class="text-xs leading-5 font-medium text-ink">{{ scenario.scenario }}</span>
          <span class="flex min-w-0 flex-col items-start gap-1.5">
            <Tag :label="scenario.result" :tone="OUTCOME_TONES[scenario.outcome]" />
            <span class="text-[11px] leading-4 text-ink/60">{{ scenario.detail }}</span>
          </span>
        </li>
      </ul>

      <!-- The rows are the rules while the method is available, so a project with it off
           has to be told that here rather than reading a table that does not apply. -->
      <p
        v-if="!saved.enabled"
        class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-warning"
      >
        Authenticator apps are off on this project, so no sign-in is asked for a code today
        whatever the account holds. These are the rules that come back with the method.
      </p>
      <p class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
        {{ CHALLENGE_SCENARIOS_NOTE }}
      </p>
    </LayerCard>

    <LayerCard
      :padded="false"
      description="What a user walks through, and which step is your page's. Two calls and a sheet of codes you have to show once."
      title="Enrolment and recovery"
    >
      <ol class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="(step, index) in ENROLMENT_JOURNEY"
          :key="step.id"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-3.5"
        >
          <span
            aria-hidden="true"
            class="flex size-5 items-center justify-center rounded-full bg-ink/8 font-mono text-[10px] leading-none font-medium text-ink/70 tabular-nums"
          >
            {{ index + 1 }}
          </span>
          <span class="flex min-w-0 flex-col gap-1">
            <span class="text-xs leading-4 font-medium text-ink">{{ step.title }}</span>
            <span class="text-[11px] leading-4 text-ink/60">{{ step.detail }}</span>
            <span v-if="step.call" class="font-mono text-[11px] leading-4 text-ink/70">
              {{ step.call }}
            </span>
            <NuxtLink
              v-if="step.link"
              :to="step.link.to"
              class="inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
            >
              {{ step.link.label }}
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
            </NuxtLink>
          </span>
        </li>
      </ol>
    </LayerCard>

    <section class="flex flex-col gap-4">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">{{ coverageHeading }}</h2>
        <!-- Neutral about where the tiles sit: they are a row on a desktop and a column
             on a phone, and "beside it" is only true in one of the two. -->
        <p class="m-0 text-xs text-ink/55">
          The count is every account on the project; the other three are the last 30 days.
        </p>
      </header>

      <!-- One short line each, so four tiles side by side are the same object four
           times. What each figure does and does not count is behind the glyph. -->
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Statistic
          :description="`Of ${coverage.accounts.toLocaleString('en')} on the project.`"
          :info="`Accounts holding a confirmed authenticator, which are the accounts asked for a code. A passkey alone does not count: it answers a challenge and never demands one.`"
          :value="coverage.enrolled"
          label="Accounts with one"
        />
        <Statistic
          :value="stats.challenges"
          description="Sign-ins that stopped at a code."
          info="Sign-ins that proved a first factor and were answered with a challenge, whether or not the person went on to finish."
          label="Challenges"
        />
        <Statistic
          :value="stats.refused"
          description="Proofs we would not take."
          info="A wrong code, a step already spent, or the last attempt on a challenge. Every one of them costs an attempt."
          label="Refused"
          positive="down"
        />
        <Statistic
          :value="stats.stepUps"
          description="Asked inside a session."
          info="Challenges raised in front of something sensitive, in a session that already existed. A recovery code can never answer one."
          label="Step-ups"
        />
      </div>

    </section>

    <section class="flex flex-col gap-4">
      <header class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">What answered the challenge</h2>
          <p class="m-0 text-xs text-ink/55">
            By the factor that completed it, over the same 30 days.
          </p>
        </div>
        <p v-if="totalAnswered > 0" class="m-0 text-xs text-ink/55">
          Shares of the
          <span class="font-mono text-ink tabular-nums">
            {{ totalAnswered.toLocaleString("en") }}
          </span>
          that were completed
        </p>
      </header>

      <!-- Cards rather than a row of bars, as on passkeys: a bar of 3 against a bar of
           214 is a rule and a dot, and the two rejected shapes there are the two that
           would be rejected here. -->
      <div v-if="totalAnswered > 0" class="grid gap-4 sm:grid-cols-3">
        <v-card v-for="entry in answered" :key="entry.kind" border flat>
          <div class="flex flex-col p-4">
            <div class="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" class="flex h-4 w-5 flex-none items-center justify-center">
                <Icon :name="entry.icon" class="text-[15px] text-ink/60" />
              </span>
              <span class="min-w-0 truncate text-[0.8125rem] font-medium text-ink/60">
                {{ entry.label }}
              </span>
            </div>
            <p class="m-0 mt-4 flex items-baseline gap-2">
              <span
                class="font-mono text-2xl leading-none font-medium tracking-tight text-ink tabular-nums"
              >
                {{ entry.count.toLocaleString("en") }}
              </span>
              <span class="font-mono text-xs text-ink/55 tabular-nums">
                {{ share(entry.count) }}%
              </span>
            </p>
            <p class="m-0 mt-0.5 text-[0.6875rem] text-ink/55">{{ entry.note }}</p>
          </div>
        </v-card>
      </div>
      <v-card v-else border flat>
        <p class="m-0 px-4 py-6 text-center text-xs text-ink/50">
          No challenge has been answered on this project yet.
        </p>
      </v-card>
    </section>

    <LayerCard
      v-model:open="advanced"
      expandable
      description="How a code is generated, accepted and spent, and what an enrolment may hold. None of it is configurable, and each row says why."
      title="Technical details"
    >
      <!-- The heading names the standard and the first row carries its values, rather
           than printing the same three figures twice on one card. -->
      <template #badge>
        <StatusBadge label="RFC 6238 defaults" tone="neutral" />
      </template>

      <div class="divide-y divide-line">
        <SettingRow
          :fixed="`${TOTP.algorithm} · ${TOTP.digits} digits · ${TOTP.periodSeconds} s`"
          description="RFC 6238's defaults, and what Google Authenticator, 1Password and Authy actually implement. Several ignore the algorithm and the digit count in the URI entirely, so advertising anything else enrols a factor whose codes we would reject. HMAC-SHA-1 over a fresh 160-bit key is untouched by the collision attacks on SHA-1."
          label="Parameters"
        />
        <SettingRow
          :fixed="`${TOTP.secretBits} bits`"
          description="Base32, unpadded, as RFC 4648 and every app expect it, and the length RFC 4226 recommends. Drawn from a cryptographic source and never derived from anything about the account."
          label="Secret"
        />
        <SettingRow
          description="The secret is envelope encrypted under the project's data key rather than hashed, and that is forced rather than chosen: we are the party that computes the expected code, so there is nothing to compare a digest against. It is the opposite of every code a user presents to us."
          fixed="Encrypted"
          label="At rest"
        />
        <SettingRow
          :fixed="`One step, ${TOTP.periodSeconds} s`"
          description="A code from the step before or after now is accepted, so a phone half a minute out still gets in. One step and not more, because the window an intercepted code is replayable in is exactly this tolerance."
          label="Clock drift"
        />
        <SettingRow
          description="Verification returns the step a code came from rather than a boolean, and that step is written back under a greatest() guard. A code is valid for its whole thirty seconds, so refusing a step already spent is the only defence against one read over a shoulder or off a screen share."
          fixed="Refused"
          label="The same code, twice"
        />
        <SettingRow
          :fixed="String(TOTP.attempts)"
          description="Wrong codes on one challenge before it dies, whatever the clock says. Counted outside the transaction that would issue anything, so a wrong guess persists even though the request fails and the cap advances."
          label="Attempts"
        />
        <SettingRow
          :fixed="challengeLifetime"
          description="How long a proved first factor waits for the second, set for the deployment. Longer than one step on purpose: a code typed just as the step rolls over has to be able to be retyped."
          label="Challenge lifetime"
        />
        <SettingRow
          description="A wrong code, a spent step, a factor the account never enrolled and a factor the challenge does not offer are indistinguishable from outside, and each costs an attempt. Everyone at a challenge has already got past a first factor, which is exactly where a stolen password puts an attacker, and a distinguishable answer would tell them what the account holds."
          fixed="Always"
          label="One refusal"
        />
        <SettingRow label="One authenticator per account">
          <template #description>
            A second is refused with
            <span class="font-mono text-ink/80">mfa_factor_already_enrolled</span> once one is
            confirmed. The unique index covers confirmed rows only, so an enrolment that was
            started and never finished is replaced by the next start rather than standing in
            the way of it.
          </template>
          <template #actions>
            <span
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              One
            </span>
          </template>
        </SettingRow>
        <SettingRow
          :description="`Up to ${TOTP.labelMaxLength} characters, shown on their own security screen so two authenticators are tellable apart. It is theirs and not yours: stored as personal data and erased with the account.`"
          fixed="Optional"
          label="The user's own name for it"
        />
        <SettingRow
          description="Every route here takes a session, and a factor id is scoped to that principal in the repository as well, so a valid session cannot reach a stranger's factor by guessing one. Removing a factor is the first thing somebody holding a stolen session would do, which is why the SDK asks for a step-up in front of it."
          fixed="Always"
          label="Enrolled from a session"
        />
        <SettingRow :fixed="stepUpWindow" label="How recent a proof has to be">
          <template #description>
            The window a sensitive action compares the session's factor age against, set for
            the deployment. Long enough that changing an address and then a password does not
            ask twice, short enough that a session left open on a shared machine has stopped
            counting. Its own screen is
            <NuxtLink
              class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/mfa/step-up"
            >
              Additional verification </NuxtLink
            >.
          </template>
        </SettingRow>
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <TotpDisableDialog
      v-model="disableDialog"
      :busy="isBusy('enabled')"
      :coverage="coverage"
      :passkeys="passkeysOn"
      :project="projects.current.name"
      @confirm="confirmDisable"
    />
  </div>
</template>
