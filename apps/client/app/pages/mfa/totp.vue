<script setup lang="ts">
/**
 * Authenticator apps for the project: time-based codes from an app on the user's phone,
 * which is the one factor that turns two-factor on for an account (PROJECT.md 4.5,
 * ADR-0010). A passkey answers a challenge and a recovery sheet answers a challenge; an
 * authenticator is what demands one.
 *
 * What a project decides is two things and the screen says so: whether the method
 * exists, and the name an app files the account under. A project-wide requirement is
 * not built and is shown as such rather than as a switch that does nothing. Everything
 * else is fixed by the server on purpose and listed row by row, so an operator looking
 * for "how many attempts" or "why SHA-1" finds the answer and the reason together.
 *
 * Every control saves itself, as on the passwords screen: a switch writes the moment it
 * is changed and shows its own wait, and the issuer goes through a dialog. The figures
 * on the side are the factor's own, and the breakdown counts what answered a challenge
 * rather than who signed in.
 */

import {
  FACTOR_ROLES,
  groupCode,
  groupSecret,
  otpauthUri,
  SAMPLE_ACCOUNT,
  SAMPLE_SECRET,
  TOTP,
} from "~/utils/mfa";
import { humanizeSeconds, SAMPLE_CODE } from "~/utils/otp";

const projects = useProjectStore();
const store = useMfaStore();

const saved = computed(() => store.authenticatorFor(projects.current.id));
const stats = computed(() => store.authenticatorStats(projects.current.id));

/* Which cards start unfolded. The switch is what most visits are for, so it is open. */
const expanded = reactive({ apps: true, enrolment: false, code: false, factors: false });

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

function setEnabled(enabled: boolean) {
  if (enabled === saved.value.enabled) return;
  void whileBusy("enabled", () => store.patchAuthenticator(projects.current.id, { enabled }));
}

/*
 * The issuer. Null follows the project's name, which is what most projects want and
 * what a rename of the project then carries along; a name set here holds still.
 */
const issuerDialog = ref(false);
const issuer = computed(() => saved.value.issuer ?? projects.current.name);

function confirmIssuer(value: string | null) {
  if (value === saved.value.issuer) return;
  void whileBusy("issuer", () => store.patchAuthenticator(projects.current.id, { issuer: value }));
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    issuerDialog.value = false;
  },
);

/*
 * What the app shows, rendered from the project's own name and a sample the screen
 * mints nothing for. The URI is the one a QR code encodes; the secret in fours is what
 * somebody types when they cannot scan.
 */
const uri = computed(() => otpauthUri(issuer.value, SAMPLE_ACCOUNT, SAMPLE_SECRET));
const sampleCode = groupCode(SAMPLE_CODE);
const sampleSecret = groupSecret(SAMPLE_SECRET);

const challengeLifetime = humanizeSeconds(TOTP.challengeSeconds);
const stepUpWindow = humanizeSeconds(TOTP.stepUpSeconds);

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
  {
    key: "recovery",
    name: "Recovery code",
    icon: "material-symbols:key-outline",
    count: stats.value.answeredBy.recovery,
  },
]);

const totalAnswered = computed(() =>
  answered.value.reduce((total, entry) => total + entry.count, 0),
);

const share = (count: number) =>
  totalAnswered.value === 0 ? 0 : Math.round((count / totalAnswered.value) * 100);

const enrolledShare = computed(() =>
  stats.value.accounts === 0 ? 0 : Math.round((stats.value.enrolled / stats.value.accounts) * 100),
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

const GUIDES = [
  {
    icon: "material-symbols:phonelink-lock-outline",
    title: "Authenticator apps, end to end",
    detail: "enrollTotp, confirmTotp, and the QR code your page draws.",
    href: "https://idenzy.dev/docs/mfa/totp",
  },
  {
    icon: "material-symbols:key-outline",
    title: "Recovery codes",
    detail: "What to show once, and what regenerating the sheet costs.",
    href: "https://idenzy.dev/docs/mfa/recovery",
  },
  {
    icon: "material-symbols:lock-clock-outline",
    title: "Step-up",
    detail: "Asking for a factor again in front of something sensitive.",
    href: "https://idenzy.dev/docs/mfa/step-up",
  },
  {
    icon: "material-symbols:code",
    title: "The JS SDK's MFA calls",
    detail: "AuthResult, challenge.submit and the MfaApi.",
    href: "https://idenzy.dev/docs/sdk/js/mfa",
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:phonelink-lock-outline" title="Authenticator apps">
      <template #description>
        Time-based codes from an app, on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>: the one factor
        that turns two-factor on for an account, and the rules every code is checked by.
        Changes save as you make them.
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          v-model:open="expanded.apps"
          expandable
          description="Whether the method exists on this project, what the app shows, and what holding one means for an account."
          title="Authenticator apps"
        >
          <template #badge>
            <StatusBadge
              :label="saved.enabled ? 'On' : 'Off'"
              :tone="saved.enabled ? 'success' : 'neutral'"
            />
          </template>
          <div class="divide-y divide-line">
            <SettingRow
              description="Users enrol an app from inside a session and are asked for its code at every sign-in after that. Off, the enrolment endpoints answer as if the method did not exist, and enrolled authenticators are kept and not demanded until it is back."
              label="Enabled"
            >
              <v-switch
                :disabled="isBusy('enabled')"
                :loading="isBusy('enabled')"
                :model-value="saved.enabled"
                aria-label="Authenticator apps"
                color="primary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled($event === true)"
              />
            </SettingRow>
            <SettingRow
              description="What the app files the account under, beside the address: the product's name, not ours. It goes into the URI twice, percent-encoded in the label and again as a parameter, because some apps read only one of the two."
              label="Issuer"
            >
              <template #actions>
                <span class="flex items-center gap-2 text-xs text-ink/60">
                  <span data-testid="issuer">{{ issuer }}</span>
                  <span
                    v-if="saved.issuer === null"
                    class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
                  >
                    Project name
                  </span>
                </span>
                <v-btn
                  :loading="isBusy('issuer')"
                  class="text-xs font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:edit-outline"
                  size="small"
                  variant="text"
                  @click="issuerDialog = true"
                >
                  Change
                </v-btn>
              </template>
            </SettingRow>
            <SettingRow
              description="Today a second factor is owed because the account enrolled one, which is per user and not per project. A project-wide requirement would put a challenge in front of accounts holding nothing, and a challenge nobody can answer is a sign-in that cannot be completed; it waits on an enrolment step at sign-in and is on the roadmap."
              fixed="Not yet"
              label="Require of everybody"
            />
            <SettingRow
              description="A confirmed authenticator puts a challenge in front of every password and one-time-code sign-in on that account. Nothing else does: a passkey and a recovery sheet answer a challenge something else demanded. A passkey sign-in with user verification is already two factors, so it is never followed by a demand for a code."
              fixed="Demands"
              label="What holding one means"
            />
          </div>

          <SamplePanel
            class="mt-5"
            meta="Sample secret and code"
            note="The entry an app files the account under, and the URI a QR code encodes. We return the URI and the secret and never an image: drawing the code is your page's, for the reason your sign-in screen is."
            title="What the app shows"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="flex items-center gap-3 rounded-(--idenzy-radius-x-small) bg-surface px-3.5 py-3 ring-1 ring-ink/6 ring-inset">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-xs font-medium text-ink">{{ issuer }}</span>
                  <span class="truncate text-[11px] text-ink/55">{{ SAMPLE_ACCOUNT }}</span>
                </div>
                <span class="font-mono text-xl leading-none font-medium tracking-wider text-ink tabular-nums">
                  {{ sampleCode }}
                </span>
                <!-- The thirty seconds an app draws, held still: a code that counted down would
                     read as one somebody could type. -->
                <svg aria-hidden="true" class="size-5 flex-none -rotate-90 text-primary" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" fill="none" r="8" stroke="currentColor" stroke-opacity="0.18" stroke-width="2" />
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
              <div class="flex flex-col justify-center gap-1 rounded-(--idenzy-radius-x-small) bg-surface px-3.5 py-3 ring-1 ring-ink/6 ring-inset">
                <span class="text-[11px] text-ink/55">Typed instead of scanned</span>
                <span class="font-mono text-xs tracking-wide text-ink">{{ sampleSecret }}</span>
              </div>
            </div>
            <SampleLine class="mt-3" icon="material-symbols:qr-code-2" mono>{{ uri }}</SampleLine>
          </SamplePanel>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.enrolment"
          expandable
          description="How an authenticator is added to an account, from a session, and what comes with the first one. None of it is configurable, and each row says why."
          title="Enrolment"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="Start returns the secret and the URI, and the factor satisfies nothing until a code generated from it comes back. A factor usable from the moment it was generated would let somebody whose QR code failed to scan lock themselves out of their own account at the next sign-in."
              fixed="Two calls"
              label="Confirmed before it counts"
            />
            <SettingRow
              description="We return the otpauth URI and the raw secret, and never an image. Drawing the code is your page's, with your own library, for the same reason your sign-in screen is; the secret is what somebody types when they cannot scan."
              fixed="Yours"
              label="The QR code"
            />
            <SettingRow label="Per account">
              <template #description>
                A second authenticator is refused with
                <span class="font-mono text-ink/80">mfa_factor_already_enrolled</span> once one is
                confirmed. The unique index covers confirmed rows only, so an enrolment that was
                started and never finished is replaced by the next start rather than standing in
                the way of it.
              </template>
              <template #actions>
                <span class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55">One</span>
              </template>
            </SettingRow>
            <SettingRow
              :description="`Up to ${TOTP.labelMaxLength} characters, shown on their own security screen so two apps are tellable apart. Stored as personal data and erased with the account.`"
              fixed="Optional"
              label="The user's name for it"
            />
            <SettingRow fixed="With the first factor" label="Recovery codes">
              <template #description>
                {{ TOTP.recoveryCodes }} are issued in the reply that confirms the first factor an
                account holds, and never again on a later enrolment: reissuing would invalidate a
                sheet somebody already printed. They go when the last factor is removed. Their own
                screen is
                <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/mfa/recovery">Recovery codes</NuxtLink>.
              </template>
            </SettingRow>
            <SettingRow
              description="Every route here takes a session, and a factor id is scoped to that principal in the repository as well, so a valid session cannot reach a stranger's factor by guessing one. Removing the factor is the first thing somebody holding a stolen session would do, which is why the SDK asks for a step-up in front of it."
              fixed="Always"
              label="From a session"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.code"
          expandable
          description="How every code is generated, accepted and spent. RFC 6238 at its defaults, and each row says why the default is the only choice."
          title="Every code"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :fixed="`${TOTP.algorithm} · ${TOTP.digits} digits · ${TOTP.periodSeconds} s`"
              description="RFC 6238's defaults, and what Google Authenticator, 1Password and Authy actually implement. Several ignore the algorithm and digits in the URI entirely, so advertising anything else enrols a factor whose codes we would reject. HMAC-SHA-1 over a fresh 160-bit key is untouched by the collision attacks on SHA-1."
              label="Parameters"
            />
            <SettingRow
              :fixed="`${TOTP.secretBits} bits`"
              description="Base32, unpadded, as RFC 4648 and every app expect it, and the length RFC 4226 recommends. Drawn from a cryptographic source and never derived from anything about the account."
              label="Secret"
            />
            <SettingRow
              description="A code from the step before or after now is accepted, so a phone half a minute out still gets in. One step and not more, because the window an intercepted code is replayable in is exactly this tolerance."
              fixed="One step"
              label="Clock drift"
            />
            <SettingRow
              description="Verification returns the step a code came from rather than a boolean, and that step is written back. A code stays valid for its whole thirty seconds, so the only defence against one read over a shoulder or off a screen share is refusing a step already spent. The counter moves under a greatest() guard, because two requests inside one step would otherwise let the second write it back down."
              fixed="Refused"
              label="The same code, twice"
            />
            <SettingRow
              :fixed="String(TOTP.attempts)"
              description="Wrong codes on one challenge before it dies, whatever the clock says. Counted outside the transaction that would issue anything, so a wrong guess persists even though the request fails, and the cap advances."
              label="Attempts"
            />
            <SettingRow
              :description="`How long a proved first factor waits for the second, set for the deployment. Longer than one step on purpose: a code typed just as the step rolls over has to be able to be retyped.`"
              :fixed="challengeLifetime"
              label="Challenge lifetime"
            />
            <SettingRow
              description="A wrong code, a spent step, a factor the account never enrolled and a factor the challenge does not offer are indistinguishable from outside, and each costs an attempt. Everyone at a challenge has already got past a first factor, which is exactly where a stolen password puts an attacker, and a distinguishable answer would tell them what the account holds."
              fixed="Always"
              label="One refusal"
            />
            <SettingRow
              description="The secret is envelope encrypted under the project's data key rather than hashed, and that is forced rather than chosen: we are the party that computes the expected code, so there is nothing to compare a digest against. It is the opposite of every code a user presents to us."
              fixed="Encrypted"
              label="At rest"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.factors"
          expandable
          description="What may complete the challenge an authenticator demands, in the order a form should offer it: strongest first, the rest behind a way to try another."
          title="Answering a challenge"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="role in FACTOR_ROLES"
              :key="role.kind"
              :description="role.note"
              :fixed="role.available ? (role.demands ? 'Demands' : 'Answers') : 'Not yet'"
              :label="role.label"
            >
              <template v-if="role.available" #actions>
                <span class="flex items-center gap-1.5">
                  <span
                    v-if="role.answers.signIn"
                    class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                  >
                    Sign-in
                  </span>
                  <span
                    v-if="role.answers.stepUp"
                    class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                  >
                    Step-up
                  </span>
                </span>
              </template>
            </SettingRow>
            <SettingRow :fixed="stepUpWindow" label="How recent a proof has to be">
              <template #description>
                The window a sensitive action compares the session's factor age against, set for
                the deployment. Long enough that changing an address and then a password does not
                ask twice, short enough that a session left open on a shared machine has stopped
                counting. Its own screen is
                <NuxtLink class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" to="/mfa/step-up">Step-up</NuxtLink>.
              </template>
            </SettingRow>
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Authenticator apps</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile :seed="43" :series="stats.challengesDaily" :value="stats.challenges" info="Sign-ins that proved a first factor and stopped at a second, whether or not they finished." label="Challenges" />
          <UsageTile :seed="47" :series="stats.enrolledDaily" :value="stats.enrolled" info="Accounts holding a confirmed authenticator. The line is how many confirmed one each day." label="Enrolled" />
          <UsageTile :seed="53" :series="stats.refusedDaily" :value="stats.refused" info="Proofs refused: a wrong code, a step already spent, or the fifth attempt." label="Refused" />
          <UsageTile :seed="59" :series="stats.stepUpsDaily" :value="stats.stepUps" info="Challenges asked for in front of something sensitive, inside a session that already existed." label="Step-ups" />
        </div>

        <LayerCard :padded="false" description="By what completed each challenge." title="Answered with">
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
            No challenge answered on this project yet.
          </p>
          <div
            v-if="stats.accounts > 0"
            class="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[11px] text-ink/55"
          >
            <span>
              <span class="font-mono text-ink tabular-nums">{{ enrolledShare }}%</span> of accounts hold an authenticator
            </span>
            <v-tooltip
              location="top"
              max-width="260"
              text="Accounts with a confirmed authenticator over every account on the project. A passkey alone does not count: it answers a challenge and never demands one."
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

    <TotpIssuerDialog
      v-model="issuerDialog"
      :current="saved.issuer"
      :fallback="projects.current.name"
      @confirm="confirmIssuer"
    />
  </div>
</template>
