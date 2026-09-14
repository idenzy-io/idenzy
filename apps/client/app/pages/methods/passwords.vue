<script setup lang="ts">
/**
 * Email and password sign-in for the project, arranged as the decision it is: what the
 * method costs the people who hold one, what a password has to be, what a reset does,
 * and the parts of it nobody can change.
 *
 * Two save models, on purpose. The switches and the reset controls write the moment they
 * are changed, because each is one discrete state with a consequence stated beside it.
 * The requirements are a draft with Save and Cancel, because a minimum length is typed a
 * digit at a time and saving the "1" of a "12" would refuse every password on the
 * project for as long as it took to type the second digit.
 *
 * Two switches ask first. Turning the method off can lock out every account that holds no
 * other credential, and turning lockout on hands anybody who knows an address a way to
 * lock its owner out; both dialogs state the number and what is left, because the switch
 * itself cannot.
 *
 * What a project cannot change is not on the screen at all: the hash, the pepper and the
 * normalisation are documentation rather than a card nobody can act on. What is left is
 * what somebody came here to decide, and each folded card carries its saved values in its
 * heading, because a screen that hides the policy behind closed cards makes an operator
 * open every one of them to read it.
 */

import {
  attemptsSummary,
  DEFAULT_PASSWORD_POLICY,
  LENGTH_CEILING,
  LENGTH_FLOOR,
  LENGTH_FLOOR_MAX,
  LOCKOUT_ATTEMPTS_MAX,
  LOCKOUT_ATTEMPTS_MIN,
  LOCKOUT_NOTE,
  type PasswordPolicy,
  POLICY_ISSUE_LABELS,
  RESET_LIFETIMES,
  type ResetLifetime,
  requirementsOf,
  requirementsSummary,
  resetSummary,
  validatePolicy,
} from "~/utils/password-policy";

const projects = useProjectStore();
const store = usePasswordPolicyStore();
const passkeys = usePasskeysStore();
const otp = useOtpStore();
const providers = useProvidersStore();

const saved = computed(() => store.policyFor(projects.current.id));
const stats = computed(() => store.stats(projects.current.id));

/* The fields on their way to the server, so each control can show its own wait. */
const busy = ref<Set<keyof PasswordPolicy>>(new Set());

function isBusy(key: keyof PasswordPolicy): boolean {
  return busy.value.has(key);
}

/**
 * Writes one field and answers whether the server took it, so a dialog can stay open on a
 * failure rather than closing on the busy flag going false. A value the policy would
 * refuse is never sent.
 */
async function commit<K extends keyof PasswordPolicy>(
  key: K,
  value: PasswordPolicy[K],
): Promise<boolean> {
  if (saved.value[key] === value) return true;
  if (validatePolicy({ ...saved.value, [key]: value }).length > 0) return false;

  busy.value = new Set([...busy.value, key]);
  try {
    await store.patch(projects.current.id, { [key]: value });
    return true;
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

/*
 * The method switch. Off is the one change here that can leave somebody with no way in,
 * so it is asked for; on is not, because nothing is lost by offering a method again.
 */
const disableDialog = ref(false);

function setEnabled(value: boolean) {
  if (value) {
    void commit("enabled", true);
    return;
  }
  disableDialog.value = true;
}

async function confirmDisable() {
  if (await commit("enabled", false)) disableDialog.value = false;
}

/** What the project would still offer, in the words the drawer uses for each. */
const otherMethods = computed(() => {
  const held: string[] = [];
  const party = passkeys.settingsFor(projects.current.id);
  if (party.enabled && party.relyingParty !== null) held.push("passkeys");
  const codes = otp.settingsFor(projects.current.id);
  if (codes.email.enabled || codes.sms.enabled) held.push("one-time codes");
  if (providers.configured(projects.current.id).some((entry) => entry.config.enabled)) {
    held.push("social providers");
  }
  return held;
});

/*
 * The requirements, as a draft. Both fields are checked against the policy they would
 * make before anything is sent, and a refused value stays on screen with its reason.
 */
const requirements = ref<Pick<PasswordPolicy, "minLength" | "breachCheck">>({
  minLength: DEFAULT_PASSWORD_POLICY.minLength,
  breachCheck: DEFAULT_PASSWORD_POLICY.breachCheck,
});

/** The field's own text, so a half-typed number is never a policy. */
const minLengthText = ref(String(DEFAULT_PASSWORD_POLICY.minLength));

watch(
  saved,
  (policy) => {
    requirements.value = { minLength: policy.minLength, breachCheck: policy.breachCheck };
    minLengthText.value = String(policy.minLength);
  },
  { immediate: true },
);

watch(minLengthText, (text) => {
  const value = Number(text.trim());
  requirements.value = {
    ...requirements.value,
    minLength: text.trim() === "" || !Number.isFinite(value) ? Number.NaN : value,
  };
});

const requirementIssues = computed(() => validatePolicy({ ...saved.value, ...requirements.value }));

/* Not shown against an untouched field: a blank one is unfinished, not wrong. */
const touched = ref(false);
const minLengthError = computed(() => {
  if (!touched.value) return "";
  const issue = requirementIssues.value.find(
    (code) => code === "min_length_range" || code === "min_length_integer",
  );
  return issue === undefined ? "" : POLICY_ISSUE_LABELS[issue];
});

const requirementsDirty = computed(
  () =>
    requirements.value.breachCheck !== saved.value.breachCheck ||
    (Number.isFinite(requirements.value.minLength) &&
      requirements.value.minLength !== saved.value.minLength),
);

const requirementsSaving = computed(() => isBusy("minLength") || isBusy("breachCheck"));
const canSaveRequirements = computed(
  () => requirementsDirty.value && requirementIssues.value.length === 0,
);

async function saveRequirements() {
  touched.value = true;
  if (!canSaveRequirements.value) return;
  await commit("minLength", requirements.value.minLength);
  await commit("breachCheck", requirements.value.breachCheck);
  touched.value = false;
}

function cancelRequirements() {
  requirements.value = {
    minLength: saved.value.minLength,
    breachCheck: saved.value.breachCheck,
  };
  minLengthText.value = String(saved.value.minLength);
  touched.value = false;
}

/** The preview follows the draft, so raising the floor shows before it is saved. */
const previewRules = computed(() =>
  requirementsOf({
    ...saved.value,
    ...requirements.value,
    minLength: Number.isFinite(requirements.value.minLength)
      ? requirements.value.minLength
      : saved.value.minLength,
  }),
);

/*
 * The reset group. Discrete controls, so they write on the spot.
 */
const resetLifetime = computed({
  get: () => String(saved.value.resetLifetime),
  set: (value: string) => {
    const minutes = Number(value);
    if (RESET_LIFETIMES.includes(minutes as ResetLifetime)) {
      void commit("resetLifetime", minutes as ResetLifetime); // narrowed by the check above
    }
  },
});

const LIFETIME_OPTIONS = RESET_LIFETIMES.map((minutes) => ({
  value: String(minutes),
  label: `${minutes} min`,
}));

/*
 * Lockout. Turning it on is a decision about somebody else's access, so it is asked for.
 */
const lockoutDialog = ref(false);
const lockoutAttemptsDialog = ref(false);

function setLockout(value: boolean) {
  if (value) {
    lockoutDialog.value = true;
    return;
  }
  void commit("lockout", false);
}

async function confirmLockout() {
  if (await commit("lockout", true)) lockoutDialog.value = false;
}

function confirmLockoutAttempts(value: number) {
  void commit("lockoutAttempts", value);
}

/* Which folded cards are open. Everything a project decides is open; reference is not. */
const expanded = reactive({ reset: true, attempts: false });

const lastSaved = computed(() => store.lastSavedAt(projects.current.id));
const saving = computed(() => busy.value.size > 0);

const GUIDES_URL = "https://idenzy.io/docs/passwords";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Passwords">
      <template #badge>
        <StatusBadge
          :label="saved.enabled ? 'Available' : 'Disabled'"
          :tone="saved.enabled ? 'success' : 'neutral'"
        />
      </template>
      <template #description>
        Email and password sign-in on
        <span class="font-medium text-ink">{{ projects.current.name }}</span
        >. What a password has to be, what a reset does, and what happens to somebody who
        keeps getting it wrong.
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
          Password guides
        </v-btn>
      </template>
    </PageHeader>

    <!-- The figures sit under the title rather than in a section of their own: they are
         the context for every decision below them, not a report at the foot. -->
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Statistic
        :previous="stats.signInsPrevious"
        :value="stats.signIns"
        compare="vs the 30 days before"
        description="Accepted, and given a session."
        info="Sign-ins that verified a password and issued a session. A locked-out attempt is not one."
        label="Sign-ins"
      />
      <Statistic
        :value="stats.accounts"
        description="Accounts holding a password."
        info="Accounts holding a password hash, in any format, whether or not they also hold another method."
        label="With a password"
      />
      <Statistic
        :value="stats.breachedRefused"
        description="Refused at sign-up or reset."
        info="Passwords refused because the breach corpus held them. Nothing is refused while the check is off."
        label="Breached, refused"
      />
      <Statistic
        :previous="stats.resetsPrevious"
        :value="stats.resets"
        compare="vs the 30 days before"
        description="Reset links requested."
        info="A link that was never used still counts, which is what makes this a demand figure and not a recovery one."
        label="Resets requested"
      />
    </div>

    <!-- The method switch sits at the top with its effect under it, rather than in a
         column of settings where its consequence reads like any other row's. -->
    <LayerCard
      description="Whether the method exists on this project, and for whom."
      title="Password sign-in"
    >
      <div class="divide-y divide-line">
        <SettingRow label="Password sign-in">
          <template #description>
            Users sign in with an email address and a password. Off, the endpoints answer as
            if the method did not exist and every stored hash is kept for when it is back.
            <span v-if="stats.passwordOnly > 0">
              <span class="font-mono text-ink/80">
                {{ stats.passwordOnly.toLocaleString("en") }}
              </span>
              of
              <span class="font-mono text-ink/80">
                {{ stats.accounts.toLocaleString("en") }}
              </span>
              accounts here hold no other way in.
            </span>
          </template>
          <v-switch
            :disabled="isBusy('enabled')"
            :loading="isBusy('enabled')"
            :model-value="saved.enabled"
            aria-label="Password sign-in"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="setEnabled($event === true)"
          />
        </SettingRow>
        <SettingRow
          :disabled="!saved.enabled"
          description="Off, only accounts that already hold a password can use one: the shape of a project going passwordless that still honours what it imported."
          label="New accounts may set a password"
        >
          <v-switch
            :disabled="!saved.enabled || isBusy('allowSignUp')"
            :loading="isBusy('allowSignUp')"
            :model-value="saved.allowSignUp"
            aria-label="Sign-up with a password"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="commit('allowSignUp', $event === true)"
          />
        </SettingRow>
      </div>
    </LayerCard>

    <!-- The editor and what it produces, side by side: a rule and the sentence a user
         will read are the same decision seen twice. -->
    <!-- `items-start`, or the preview is stretched to the editor's height and ends in a
         panel of empty surface: a grid item fills its row unless it is told not to. -->
    <div class="grid gap-6 lg:grid-cols-12 lg:items-start">
      <LayerCard
        class="lg:col-span-8"
        description="Bounded, not composed. A length floor and a breach check are the rules that measurably help; mixing rules are refused on purpose."
        title="Password requirements"
      >
        <template #badge>
          <StatusBadge
            :label="requirementsDirty ? 'Unsaved changes' : requirementsSummary(saved)"
            :tone="requirementsDirty ? 'warning' : 'neutral'"
          />
        </template>

        <div class="divide-y divide-line">
          <SettingRow
            :description="`Between ${LENGTH_FLOOR} and ${LENGTH_FLOOR_MAX}. The protocol's own floor is ${LENGTH_FLOOR}; raising it is the one length rule that costs guessers more than it costs people. It applies to the next password anybody sets, never to one already stored.`"
            control-id="min-length"
            label="Minimum length"
          >
            <div class="flex w-36 flex-col gap-1">
              <v-text-field
                id="min-length"
                v-model="minLengthText"
                :error="minLengthError !== ''"
                autocomplete="off"
                class="font-mono"
                hide-details
                inputmode="numeric"
                name="idenzy-password-min-length"
                suffix="characters"
                variant="filled"
                @blur="touched = true"
              />
              <p v-if="minLengthError" class="m-0 text-[11px] text-error">{{ minLengthError }}</p>
            </div>
          </SettingRow>
          <SettingRow
            description="A new password is checked against Have I Been Pwned's corpus at sign-up and at reset, by k-anonymity: five characters of its SHA-1 leave your project and the rest is compared here. If the service is unreachable the password is allowed and the gap is logged, because a breach check is a warning and not a gate."
            label="Breached-password check"
          >
            <v-switch
              :model-value="requirements.breachCheck"
              aria-label="Breached-password check"
              color="primary"
              density="compact"
              hide-details
              inset
              @update:model-value="requirements = { ...requirements, breachCheck: $event === true }"
            />
          </SettingRow>
          <SettingRow
            :description="`${LENGTH_CEILING} characters, so a passphrase is never cut short and a hash never takes unbounded work.`"
            fixed="Fixed"
            label="Maximum length"
          />
          <SettingRow
            description="No required mix of letters, digits and symbols, and no forbidden characters. NIST 800-63B found composition rules push people towards patterns a guesser already tries; length and the breach check do the work instead."
            fixed="None"
            label="Composition rules"
          />
        </div>

        <!-- Save at the section's bottom right, Cancel immediately to its left. -->
        <div class="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <p v-if="requirementsDirty" class="m-0 mr-auto text-[11px] text-ink/55">
            Not saved yet. Nothing changes for anybody until you save.
          </p>
          <v-btn
            :disabled="!requirementsDirty || requirementsSaving"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="cancelRequirements"
          >
            Cancel changes
          </v-btn>
          <v-btn
            :disabled="!canSaveRequirements"
            :loading="requirementsSaving"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="saveRequirements"
          >
            Save requirements
          </v-btn>
        </div>
      </LayerCard>

      <LayerCard
        class="lg:col-span-4"
        description="The rules the SDK reports, in the words its error codes map to. Your form shows them however you like."
        title="What users must enter"
      >
        <div class="flex flex-col gap-1">
          <SampleLine
            v-for="rule in previewRules"
            :key="rule"
            icon="material-symbols:check-circle-outline"
          >
            {{ rule }}
          </SampleLine>
        </div>
        <p v-if="requirementsDirty" class="m-0 mt-3 text-[11px] leading-4 text-warning">
          This is the draft above, not what the project enforces today.
        </p>
      </LayerCard>
    </div>

    <LayerCard
      v-model:open="expanded.reset"
      :description="
        expanded.reset
          ? 'A reset is a single-use link to the address on the account. A change from inside a session needs the current password.'
          : resetSummary(saved)
      "
      expandable
      title="Reset and sessions"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="How long the link in the reset email stays valid. Asking for another invalidates every earlier one, and a link is spent the moment it is used. This is the one clock on the Lifetimes screen a project sets itself."
          label="Reset link lifetime"
        >
          <SegmentedControl
            v-model="resetLifetime"
            :disabled="isBusy('resetLifetime')"
            :options="LIFETIME_OPTIONS"
            label="Reset link lifetime"
          />
        </SettingRow>
        <SettingRow
          description="A reset usually means the old password is no longer trusted, so every other device is signed out with it. Off keeps them signed in."
          label="Sign out other sessions after a reset"
        >
          <v-switch
            :disabled="isBusy('signOutOnReset')"
            :loading="isBusy('signOutOnReset')"
            :model-value="saved.signOutOnReset"
            aria-label="Sign out other sessions after a reset"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="commit('signOutOnReset', $event === true)"
          />
        </SettingRow>
        <SettingRow label="Email when a password changes">
          <template #description>
            Sends the <span class="font-mono text-ink/80">password_changed</span> template
            after a reset, so an owner who did not do it finds out. A signed-in change will
            use the same switch once that endpoint exists; today there is none. Edited under
            <NuxtLink
              class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
              to="/email/templates"
              >Email templates</NuxtLink
            >.
          </template>
          <v-switch
            :disabled="isBusy('notifyOnChange')"
            :loading="isBusy('notifyOnChange')"
            :model-value="saved.notifyOnChange"
            aria-label="Email when a password changes"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="commit('notifyOnChange', $event === true)"
          />
        </SettingRow>
        <SettingRow
          description="Changing the address on an account needs a recent sign-in and a confirmation on both the old address and the new one."
          fixed="Always"
          label="Re-authentication to change the email"
        />
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.attempts"
      :description="
        expanded.attempts
          ? 'What happens to somebody who keeps getting it wrong, whether or not they are the account\'s owner.'
          : attemptsSummary(saved)
      "
      expandable
      title="Failed attempts"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="Per account and per address, with exponential backoff. A wrong password and a missing account cost the same time and give the same answer, so a guesser learns nothing from either."
          fixed="Always"
          label="Adaptive rate limiting"
        />
        <SettingRow :description="LOCKOUT_NOTE" label="Account lockout">
          <v-switch
            :disabled="isBusy('lockout')"
            :loading="isBusy('lockout')"
            :model-value="saved.lockout"
            aria-label="Account lockout"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="setLockout($event === true)"
          />
        </SettingRow>
        <SettingRow
          :description="`Consecutive failures before the account locks, between ${LOCKOUT_ATTEMPTS_MIN} and ${LOCKOUT_ATTEMPTS_MAX}. The owner unlocks it from a link sent to their address, so a lockout is never a call to support.`"
          :disabled="!saved.lockout"
          label="Lock after"
        >
          <template #actions>
            <span class="font-mono text-xs text-ink/60">
              {{ saved.lockoutAttempts }} attempts
            </span>
            <v-btn
              :disabled="!saved.lockout"
              :loading="isBusy('lockoutAttempts')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="text"
              @click="lockoutAttemptsDialog = true"
            >
              Change
            </v-btn>
          </template>
        </SettingRow>
      </div>
    </LayerCard>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <PasswordDisableDialog
      v-model="disableDialog"
      :busy="isBusy('enabled')"
      :other-methods="otherMethods"
      :password-only="stats.passwordOnly"
      :project="projects.current.name"
      @confirm="confirmDisable"
    />
    <PasswordLockoutDialog
      v-model="lockoutDialog"
      :attempts="saved.lockoutAttempts"
      :busy="isBusy('lockout')"
      :project="projects.current.name"
      @confirm="confirmLockout"
    />
    <NumberDialog
      v-model="lockoutAttemptsDialog"
      :current="saved.lockoutAttempts"
      :hint="`Between ${LOCKOUT_ATTEMPTS_MIN} and ${LOCKOUT_ATTEMPTS_MAX} attempts. A successful sign-in starts the count again.`"
      :integer-label="'A whole number of attempts.'"
      :max="LOCKOUT_ATTEMPTS_MAX"
      :min="LOCKOUT_ATTEMPTS_MIN"
      :range-label="POLICY_ISSUE_LABELS.lockout_attempts_range"
      confirm-label="Save attempt limit"
      description="It applies to the next failure anybody makes. An account already locked stays locked until its owner unlocks it from the link sent to their address."
      label="Lock after"
      suffix="attempts"
      title="Change when an account locks"
      @confirm="confirmLockoutAttempts"
    />
  </div>
</template>
