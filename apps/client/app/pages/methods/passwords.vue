<script setup lang="ts">
/**
 * Email and password sign-in for the project: what a password has to be, how failed
 * attempts are limited, and how a reset behaves.
 *
 * Every control saves itself. A switch or a segment writes the moment it is changed
 * and shows its own busy state until the server has it; a number writes when the field
 * is left or Enter is pressed, and a value the policy would refuse stays on screen with
 * the reason and is not sent. There is no draft and no save button, because a policy
 * of ten independent switches has nothing to batch. The screen still keeps a copy of
 * the policy to edit against, so a field can hold a refused value without the saved
 * policy changing under it.
 *
 * Rules the server fixes are rows too, marked as such, because an operator looking for
 * composition rules or the reset token's lifetime should find the answer here and not
 * in a support ticket. The figures on the side are the method's own.
 */

import {
  DEFAULT_PASSWORD_POLICY,
  HASHING,
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
  validatePolicy,
} from "~/utils/password-policy";

const projects = useProjectStore();
const store = usePasswordPolicyStore();

const saved = computed(() => store.policyFor(projects.current.id));
const draft = ref<PasswordPolicy>({ ...DEFAULT_PASSWORD_POLICY });

/* The copy follows the saved policy whenever that changes underneath: a project switch,
   the placeholder arriving, or a patch landing. */
watch(
  saved,
  (policy) => {
    draft.value = { ...policy };
  },
  { immediate: true },
);

const stats = computed(() => store.stats(projects.current.id));

/* Which cards start unfolded. The switch is what most visits are for, so it is open. */
const expanded = reactive({ signIn: true, requirements: false, attempts: false, reset: false });

/* The fields on their way to the server, so each control can show its own wait. */
const busy = ref<Set<keyof PasswordPolicy>>(new Set());

function isBusy(key: keyof PasswordPolicy): boolean {
  return busy.value.has(key);
}

/**
 * Writes one field. The value goes into the copy first so the screen shows it, is
 * checked against the policy it would make, and is sent only if that policy stands.
 * A refused value is left in the copy with its reason beside the field.
 */
async function commit<K extends keyof PasswordPolicy>(key: K, value: PasswordPolicy[K]) {
  draft.value = { ...draft.value, [key]: value };
  if (saved.value[key] === value) return;
  if (validatePolicy({ ...saved.value, [key]: value }).length > 0) return;

  busy.value = new Set([...busy.value, key]);
  try {
    await store.patch(projects.current.id, { [key]: value });
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

/*
 * The two numbers are set through a dialog each, so a value on its way to two digits
 * is never written and the bounds are checked before anything is sent.
 */
const minLengthDialog = ref(false);
const lockoutAttemptsDialog = ref(false);

function confirmMinLength(value: number) {
  draft.value = { ...draft.value, minLength: value };
  void commit("minLength", value);
}

function confirmLockoutAttempts(value: number) {
  draft.value = { ...draft.value, lockoutAttempts: value };
  void commit("lockoutAttempts", value);
}

/* For the line at the foot of the sidebar. */
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));
const saving = computed(() => busy.value.size > 0);

/* The segmented control hands back a string; it is narrowed before it is stored. */
const resetLifetime = computed({
  get: () => String(draft.value.resetLifetime),
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

const requirements = computed(() => requirementsOf(draft.value));

const GUIDES = [
  {
    icon: "material-symbols:password",
    title: "Password policy",
    detail: "Why there are no composition rules, and what the SDK reports.",
    href: "https://idenzy.dev/docs/passwords/policy",
  },
  {
    icon: "material-symbols:shield-outline",
    title: "Breached-password check",
    detail: "The k-anonymity range query, and what leaves your project.",
    href: "https://idenzy.dev/docs/passwords/breach-check",
  },
  {
    icon: "material-symbols:lock-reset",
    title: "Reset and change flows",
    detail: "Single-use links, sessions after a reset, and the emails sent.",
    href: "https://idenzy.dev/docs/passwords/reset",
  },
  {
    icon: "material-symbols:upload-file-outline",
    title: "Migrating hashes",
    detail: "bcrypt and scrypt hashes import as they are and upgrade on sign-in.",
    href: "https://idenzy.dev/docs/migrate",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:password" title="Passwords">
      <template #description>
        Email and password sign-in on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>. What a
        password has to be, how attempts are limited, and how a reset works. Changes save
        as you make them.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.signIn"
          expandable
          description="Whether the method exists on this project, and for whom."
          title="Password sign-in"
        >
          <template #badge>
            <StatusBadge
              :label="draft.enabled ? 'On' : 'Off'"
              :tone="draft.enabled ? 'success' : 'neutral'"
            />
          </template>
          <div class="divide-y divide-line">
            <SettingRow
              description="Users sign in with an email address and a password. Off, the endpoints answer as if the method did not exist, and accounts keep their hashes for when it is back."
              label="Enabled"
            >
              <v-switch
                :disabled="isBusy('enabled')"
                :loading="isBusy('enabled')"
                :model-value="draft.enabled"
                aria-label="Password sign-in"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="commit('enabled', $event === true)"
              />
            </SettingRow>
            <SettingRow
              :disabled="!draft.enabled"
              description="Off, only accounts that already hold a password can use one: the shape of a project going passwordless that still honours what it imported."
              label="New accounts may set a password"
            >
              <v-switch
                :disabled="!draft.enabled || isBusy('allowSignUp')"
                :loading="isBusy('allowSignUp')"
                :model-value="draft.allowSignUp"
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

        <LayerCard
          v-model:open="expanded.requirements"
          expandable
          description="Bounded, not composed. A length floor and a breach check are the rules that measurably help; mixing rules are refused on purpose."
          title="Requirements"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :description="`Between ${LENGTH_FLOOR} and ${LENGTH_FLOOR_MAX}. The protocol's own floor is ${LENGTH_FLOOR}; raising it is the one length rule that costs guessers more than it costs people.`"
              label="Minimum length"
            >
              <template #actions>
                <span class="font-mono text-xs text-ink/60">{{ draft.minLength }} chars</span>
                <v-btn
                  :loading="isBusy('minLength')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="minLengthDialog = true"
                >
                  Change
                </v-btn>
              </template>
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
            <SettingRow
              description="A new password is checked against Have I Been Pwned's corpus at sign-up and at reset, by k-anonymity: five characters of its SHA-1 leave your project and the rest is compared here. If the service is unreachable the password is allowed and the gap is logged, because a breach check is a warning and not a gate."
              label="Breached-password check"
            >
              <v-switch
                :disabled="isBusy('breachCheck')"
                :loading="isBusy('breachCheck')"
                :model-value="draft.breachCheck"
                aria-label="Breached-password check"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="commit('breachCheck', $event === true)"
              />
            </SettingRow>
            <SettingRow
              :description="`Every password is normalised (${HASHING.normalisation}) before it is hashed, so the same word typed on two keyboards is the same password.`"
              fixed="Always"
              label="Unicode normalisation"
            />
          </div>

          <SamplePanel
            class="mt-5"
            note="The rules the SDK reports, in the words its error codes map to. Your form shows them however you like."
            title="What users are told"
          >
            <ul class="m-0 flex list-none flex-col gap-1 p-0">
              <li v-for="rule in requirements" :key="rule" class="flex items-start gap-2">
                <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-success" name="material-symbols:check-circle-outline" />
                {{ rule }}
              </li>
            </ul>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.attempts"
          expandable
          description="What happens to somebody who keeps getting it wrong, whether or not they are the account's owner."
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
                :model-value="draft.lockout"
                aria-label="Account lockout"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="commit('lockout', $event === true)"
              />
            </SettingRow>
            <SettingRow
              :disabled="!draft.lockout"
              description="Consecutive failures before the account locks. The owner unlocks it from a link sent to their address, so a lockout is never a call to support."
              label="Lock after"
            >
              <template #actions>
                <span class="font-mono text-xs text-ink/60">{{ draft.lockoutAttempts }} attempts</span>
                <v-btn
                  :disabled="!draft.lockout"
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

        <LayerCard
          v-model:open="expanded.reset"
          expandable
          description="A reset is a single-use link to the address on the account. A change from inside a session needs the current password."
          title="Reset and change"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="How long the link in the reset email stays valid. Asking for another invalidates every earlier one, and a link is spent the moment it is used."
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
                :model-value="draft.signOutOnReset"
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
                after a reset or a change, so an owner who did not do it finds out. Edited under
                <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/email/templates">Email templates</NuxtLink>.
              </template>
              <v-switch
                :disabled="isBusy('notifyOnChange')"
                :loading="isBusy('notifyOnChange')"
                :model-value="draft.notifyOnChange"
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
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Passwords</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="3" :series="stats.signInsDaily" :value="stats.signIns" label="Sign-ins" />
          <UsageTile :seed="5" :value="stats.accounts" info="Accounts holding a password hash, in any format." label="With a password" />
          <UsageTile :seed="7" :series="stats.breachedDaily" :value="stats.breachedRefused" info="Passwords refused at sign-up or reset because the breach corpus held them." label="Breached, refused" />
          <UsageTile :seed="11" :series="stats.resetsDaily" :value="stats.resets" info="Reset links requested. A link that was never used still counts." label="Resets requested" />
        </div>

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
    <NumberDialog
      v-model="minLengthDialog"
      :current="draft.minLength"
      :hint="`Between ${LENGTH_FLOOR} and ${LENGTH_FLOOR_MAX}. The protocol's own floor is ${LENGTH_FLOOR}.`"
      :integer-label="POLICY_ISSUE_LABELS.min_length_integer"
      :max="LENGTH_FLOOR_MAX"
      :min="LENGTH_FLOOR"
      :range-label="POLICY_ISSUE_LABELS.min_length_range"
      description="Applies to the next password anyone sets. Nobody is asked to change theirs."
      label="Minimum length"
      suffix="chars"
      title="Change the minimum length"
      @confirm="confirmMinLength"
    />
    <NumberDialog
      v-model="lockoutAttemptsDialog"
      :current="draft.lockoutAttempts"
      :hint="`Between ${LOCKOUT_ATTEMPTS_MIN} and ${LOCKOUT_ATTEMPTS_MAX}. A successful sign-in starts the count again.`"
      :integer-label="'A whole number of attempts.'"
      :max="LOCKOUT_ATTEMPTS_MAX"
      :min="LOCKOUT_ATTEMPTS_MIN"
      :range-label="POLICY_ISSUE_LABELS.lockout_attempts_range"
      description="Consecutive failures before the account locks. The owner unlocks it from the link sent to their address."
      label="Lock after"
      suffix="attempts"
      title="Change when an account locks"
      @confirm="confirmLockoutAttempts"
    />
  </div>
</template>
