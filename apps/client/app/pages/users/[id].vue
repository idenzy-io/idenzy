<script setup lang="ts">
/**
 * One account, as the place a support question is answered rather than as a row.
 *
 * The question this page exists for is "they cannot sign in, why", and answering it used
 * to mean reading a row here, a filter on the sessions screen and a search of the audit
 * trail, holding a user id in your head between the three (notes/users.md, P1). So the
 * subject is fixed and everything about them is gathered under it: how they can sign in
 * and whether the project still allows it, what has been verified, the second factor and
 * the recovery codes behind it, the devices, the detector's signals, and the trail.
 *
 * The order is the order of the question. What is wrong first, what could be wrong next,
 * the record last. Nothing here is a figure that also appears above it, and there is no
 * chart: this is one person, and a person is not a series.
 *
 * Every action on the row menu is here too, on the same dialogs, so an operator who
 * arrives from a link is not sent back to the list to act.
 */

import type { BadgeTone } from "~/components/StatusBadge.vue";
import { CODE_SET, STATE_LABELS, STATE_TEXT, stateOf } from "~/utils/recovery";
import { detectorCoverage } from "~/utils/security";
import { type SessionRow, sessionStatus } from "~/utils/sessions";
import { canSignInNow, methodStandings, type ProjectSignInSettings } from "~/utils/sign-in-paths";
import { canSendSms } from "~/utils/sms-policy";
import { formatDate, formatDateTime, relativeTime } from "~/utils/time";
import {
  initialsOf,
  isIndefinite,
  nameOf,
  type ProjectUser,
  STATUS_LABELS,
  statusOf,
} from "~/utils/users";

const route = useRoute();
const { copy } = useClipboard();

const projects = useProjectStore();
const store = useUsersStore();
const sessions = useSessionsStore();
const audit = useAuditStore();
const security = useSecurityStore();
const providers = useProvidersStore();
const policies = usePasswordPolicyStore();
const otp = useOtpStore();
const smsPolicy = useSmsPolicyStore();
const recovery = useRecoveryStore();

const now = useNow({ interval: 30_000 });
const { query: listQuery } = useUsersList();

const id = computed(() => String(route.params.id ?? ""));

/* Looked up across every project rather than inside the current one, so a link to
   somebody else's project says which project rather than "no such user". */
const found = computed(() => store.users.find((user) => user.id === id.value) ?? null);
const elsewhere = computed(() =>
  found.value !== null && found.value.projectId !== projects.current.id
    ? (projects.projects.find((project) => project.id === found.value?.projectId) ?? null)
    : null,
);
const user = computed<ProjectUser | null>(() =>
  found.value !== null && elsewhere.value === null ? found.value : null,
);

const status = computed(() => (user.value === null ? null : statusOf(user.value, now.value)));
const deleted = computed(() => status.value === "deleted");

const TONES: Record<string, BadgeTone> = {
  active: "success",
  suspended: "warning",
  deleted: "neutral",
};

/* The list as it was left, so the way back is the narrowing they came from. */
const back = computed(() => ({ path: "/users", query: listQuery.value }));

/* Names the last crumb and the browser tab: the tree calls this route "All users", which
   is where the reader came from rather than where they are. */
usePageCrumb(() =>
  user.value === null ? "" : deleted.value ? "Deleted user" : nameOf(user.value),
);

/*
 * What the project allows, which is half of every answer on this page.
 */

const settings = computed<ProjectSignInSettings>(() => {
  const codes = otp.settingsFor(projects.current.id);
  return {
    passwordEnabled: policies.policyFor(projects.current.id).enabled,
    emailCodeEnabled: codes.email.enabled,
    smsCodeEnabled: codes.sms.enabled,
    smsPolicyReady: canSendSms(smsPolicy.policyFor(projects.current.id)),
  };
});

const enabledProviders = computed(() =>
  providers
    .configured(projects.current.id)
    .filter((entry) => entry.config.enabled)
    .map((entry) => String(entry.id)),
);

const standings = computed(() =>
  user.value === null
    ? []
    : methodStandings(user.value.methods, settings.value, enabledProviders.value),
);

const usable = computed(() => standings.value.filter((standing) => standing.usable).length);
const signInPossible = computed(() => canSignInNow(standings.value));

/** The card's badge, which has three cases and not two. */
const signInLabel = computed(() => {
  if (!signInPossible.value) return "None available";
  return usable.value === standings.value.length
    ? "All available"
    : `${usable.value} of ${standings.value.length} available`;
});

/*
 * The rest of the account, gathered from the screens that own it.
 */

const ownSessions = computed<SessionRow[]>(() =>
  user.value === null
    ? []
    : sessions.forProject(projects.current.id).filter((row) => row.userId === id.value),
);

const openSessions = computed(() =>
  ownSessions.value.filter((row) => sessionStatus(row, now.value) === "active"),
);

const codes = computed(() =>
  user.value === null
    ? null
    : (recovery.setsFor(projects.current.id).find((row) => row.userId === id.value) ?? null),
);

const lowThreshold = computed(() => recovery.settingsFor(projects.current.id).lowThreshold);

/** Read three times by the recovery line: the bar, its colour and the word beside it. */
const codesState = computed(() =>
  codes.value === null ? null : stateOf(codes.value, lowThreshold.value),
);

const signals = computed(() =>
  user.value === null
    ? []
    : security.signalsFor(projects.current.id).filter((signal) => signal.userId === id.value),
);

const openSignals = computed(() => signals.value.filter((signal) => signal.state === "open"));

/* Which detectors were looking. Read here rather than inside the list, because an empty
   list is the one case where what was watching is the whole answer. */
const coverage = computed(() => detectorCoverage(security.settingsFor(projects.current.id).rules));

/** The section's sentence, which carries the count rather than a pill beside the title. */
const signalsNote = computed(() => {
  if (signals.value.length === 0) {
    return "What the detectors watch for, and what they have seen here.";
  }
  const open = openSignals.value.length;
  return open === 0
    ? "All recorded signals have been reviewed."
    : `${open} open ${open === 1 ? "signal" : "signals"}. Review the evidence alongside this account’s activity.`;
});

const activity = computed(() =>
  user.value === null ? [] : audit.forSubject(projects.current.id, id.value),
);

/*
 * The strip. Six answers, none of which is repeated anywhere else on the page.
 */

interface Fact {
  label: string;
  value: string;
  /** A tone dot before the value, where the value is a state rather than a figure. */
  dot?: string;
  /** Figures are mono; words are not. */
  mono?: boolean;
  note: string;
}

const signInFact = computed<Fact>(() => {
  if (deleted.value) {
    return { label: "Can sign in", value: "Erased", note: "The account is a tombstone" };
  }
  if (!signInPossible.value) {
    return {
      label: "Can sign in",
      value: "No way in",
      dot: "bg-warning",
      note: "Nothing on the account works today",
    };
  }
  return {
    label: "Can sign in",
    value: `${usable.value} ${usable.value === 1 ? "way" : "ways"}`,
    dot: "bg-success",
    note: "Methods the project allows",
  };
});

const sessionsFact = computed<Fact>(() => ({
  label: "Open sessions",
  value: openSessions.value.length.toString(),
  mono: true,
  note: deleted.value
    ? "Revoked by the erasure"
    : openSessions.value.length === 0
      ? "Nothing signed in"
      : `of ${ownSessions.value.length} on record`,
}));

const signedInFact = computed<Fact>(() => {
  const at = user.value?.lastSignInAt ?? null;
  return {
    label: "Last sign-in",
    value: at === null ? "Never" : relativeTime(at, now.value),
    note: at === null ? "No sign-in recorded" : formatDate(at),
  };
});

const factorFact = computed<Fact>(() => {
  const on = user.value?.mfaEnabled === true;
  return {
    label: "Second factor",
    value: on ? "On" : "Off",
    ...(on ? { dot: "bg-success" } : {}),
    note: deleted.value
      ? "Cleared by the erasure"
      : on
        ? "Password sign-ins are challenged"
        : "A password alone signs them in",
  };
});

/**
 * What has been proved about the identifiers on the account, which is the answer behind
 * half the tickets: a reset that never arrived is usually an address nobody confirmed.
 * The recovery codes are not a fact here on purpose, because the card below prints that
 * figure and one number twice on a screen is one too many.
 */
function verifiedNote(holds: number, proved: number): string {
  if (deleted.value) return "Cleared by the erasure";
  if (holds === 0) return "No address or number on the account";
  return proved === holds
    ? "Everything on the account is confirmed"
    : `${holds - proved} of ${holds} still unconfirmed`;
}

const verifiedFact = computed<Fact>(() => {
  const account = user.value;
  const proved = [
    account?.email !== null && account?.emailVerified === true ? "Email" : null,
    account?.phone !== null && account?.phoneVerified === true ? "Phone" : null,
  ].filter((entry): entry is string => entry !== null);
  const holds = [account?.email ?? null, account?.phone ?? null].filter(
    (entry) => entry !== null,
  ).length;
  return {
    label: "Verified",
    value: proved.length === 0 ? "Nothing" : proved.join(", "),
    ...(proved.length === 0 && holds > 0 && !deleted.value ? { dot: "bg-warning" } : {}),
    note: verifiedNote(holds, proved.length),
  };
});

const joinedFact = computed<Fact>(() => ({
  label: "Joined",
  value: user.value === null ? "" : relativeTime(user.value.createdAt, now.value),
  note: user.value === null ? "" : formatDate(user.value.createdAt),
}));

const facts = computed<Fact[]>(() =>
  user.value === null
    ? []
    : [
        signInFact.value,
        sessionsFact.value,
        signedInFact.value,
        factorFact.value,
        verifiedFact.value,
        joinedFact.value,
      ],
);

/*
 * Acting on them. The same dialogs the list uses, on one account.
 */

const suspendOpen = ref(false);
const deleteOpen = ref(false);
const revokeOpen = ref(false);
const revokeTargets = ref<SessionRow[]>([]);

const toast = ref("");
const toastOpen = ref(false);

function notify(text: string) {
  toast.value = text;
  toastOpen.value = true;
}

async function suspend(until: string, signOut: boolean) {
  await store.suspend([id.value], until);
  if (signOut) await store.signOutEverywhere([id.value]);
  notify(signOut ? "Suspended and signed out everywhere" : "Suspended");
}

async function restore() {
  await store.restore([id.value]);
  notify("Suspension lifted");
}

async function signOutEverywhere() {
  const count = await store.signOutEverywhere([id.value]);
  notify(count === 0 ? "No open sessions to end" : "Signed out everywhere");
}

/**
 * The erasure leaves the row, so the page stays: sending the operator back to the list
 * would hide the tombstone they just made, and the tombstone is the point.
 */
async function erase() {
  try {
    await store.remove([id.value]);
    notify("Account erased");
  } catch {
    notify("Erasure is not available yet");
  }
}

function askRevoke(session: SessionRow) {
  revokeTargets.value = [session];
  revokeOpen.value = true;
}

async function revoke() {
  const count = await sessions.revoke(revokeTargets.value.map((session) => session.id));
  notify(count === 0 ? "That session had already ended" : "Session revoked");
}

async function copyText(text: string, what: string) {
  await copy(text);
  notify(`${what} copied`);
}

/** Where the codes behind a second factor are managed. */
const RECOVERY_ROUTE = "/mfa/recovery";

function openElsewhere() {
  const project = elsewhere.value;
  if (project === null) return;
  projects.select(project);
}

/** How long a suspension has left, for the badge beside the name. */
function suspensionDetail(account: ProjectUser): string {
  if (status.value === "suspended" && account.bannedUntil !== null) {
    return isIndefinite(account.bannedUntil)
      ? "until lifted"
      : `until ${formatDate(account.bannedUntil)}`;
  }
  if (status.value === "deleted" && account.deletedAt !== null) {
    return formatDate(account.deletedAt);
  }
  return "";
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      :to="back"
      class="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-ink/55 no-underline transition-colors duration-150 hover:text-ink"
    >
      <Icon aria-hidden="true" class="text-sm" name="material-symbols:arrow-back" />
      All users
    </NuxtLink>

    <!-- The account is on another project. Said, rather than answered with "not found":
         a link between colleagues crosses projects more often than it is mistyped. -->
    <EmptyState
      v-if="elsewhere"
      icon="material-symbols:swap-horiz"
      title="That account is on another project"
    >
      <template #description>
        <span class="font-mono text-[13px]">{{ id }}</span>
        belongs to
        <span class="font-medium text-ink">{{ elsewhere.name }}</span
        >. Switch to it to open the account.
      </template>
      <template #actions>
        <FancyButton @click="openElsewhere">Switch to {{ elsewhere.name }}</FancyButton>
      </template>
    </EmptyState>

    <EmptyState
      v-else-if="user === null && !store.loading"
      icon="material-symbols:person-search-outline"
      title="No such user"
    >
      <template #description>
        Nothing on
        <span class="font-medium text-ink">{{ projects.current.name }}</span>
        has the id
        <span class="font-mono text-[13px]">{{ id }}</span
        >. It may have been erased, or the link may be for another project.
      </template>
      <template #actions>
        <v-btn
          :to="back"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
        >
          Back to users
        </v-btn>
      </template>
    </EmptyState>

    <div v-else-if="user === null" class="flex flex-col gap-3">
      <span aria-hidden="true" class="h-10 w-64 animate-pulse rounded-(--idenzy-radius) bg-ink/8" />
      <span aria-hidden="true" class="h-24 w-full animate-pulse rounded-(--idenzy-radius) bg-ink/6" />
    </div>

    <template v-else>
      <PageHeader :title="deleted ? 'Deleted user' : nameOf(user)">
        <template #mark>
          <span
            :class="
              deleted
                ? 'border border-dashed border-line text-ink/35'
                : 'bg-ink/6 text-sm font-medium text-ink/70'
            "
            aria-hidden="true"
            class="flex size-10 flex-none items-center justify-center overflow-hidden rounded-full"
          >
            <img
              v-if="user.avatarUrl && !deleted"
              :src="user.avatarUrl"
              alt=""
              class="size-full object-cover"
            />
            <Icon
              v-else-if="deleted"
              class="text-lg"
              name="material-symbols:person-off-outline"
            />
            <template v-else>{{ initialsOf(user) }}</template>
          </span>
        </template>

        <template #badge>
          <StatusBadge
            :detail="suspensionDetail(user)"
            :label="STATUS_LABELS[status ?? 'active']"
            :tone="TONES[status ?? 'active'] ?? 'neutral'"
          />
        </template>

        <template #description>
          <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span v-if="user.email" class="inline-flex items-center gap-1">
              {{ user.email }}
              <Icon
                v-if="user.emailVerified"
                aria-label="Verified"
                class="text-sm text-success"
                name="material-symbols:verified-outline"
                role="img"
              />
              <span v-else class="text-xs text-ink/45">unverified</span>
            </span>
            <span v-if="user.phone" class="inline-flex items-center gap-1 font-mono text-[13px]">
              {{ user.phone }}
              <Icon
                v-if="user.phoneVerified"
                aria-label="Verified"
                class="text-sm text-success"
                name="material-symbols:verified-outline"
                role="img"
              />
            </span>
            <button
              class="group/id inline-flex items-center gap-1 font-mono text-[13px] text-ink/55 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="Copy user ID"
              type="button"
              @click="copyText(user.id, 'User ID')"
            >
              {{ user.id }}
              <Icon
                aria-hidden="true"
                class="text-xs opacity-0 transition-opacity duration-150 group-hover/id:opacity-60"
                name="material-symbols:content-copy-outline"
              />
            </button>
          </span>
        </template>

        <template v-if="!deleted" #actions>
          <v-btn
            v-if="status === 'suspended'"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:lock-open-outline"
            size="small"
            variant="outlined"
            @click="restore"
          >
            Lift suspension
          </v-btn>
          <v-btn
            v-else
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:block"
            size="small"
            variant="outlined"
            @click="suspendOpen = true"
          >
            Suspend
          </v-btn>

          <v-btn
            :disabled="openSessions.length === 0"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:logout"
            size="small"
            variant="outlined"
            @click="signOutEverywhere"
          >
            Sign out everywhere
          </v-btn>

          <v-menu :offset="4" location="bottom end">
            <template #activator="{ props: activator }">
              <v-btn
                v-bind="activator"
                aria-label="More actions"
                class="text-xs font-medium"
                color="neutral"
                icon="material-symbols:more-horiz"
                size="small"
                variant="outlined"
              />
            </template>
            <v-list density="compact" min-width="208" nav>
              <v-list-item
                prepend-icon="material-symbols:content-copy-outline"
                title="Copy user ID"
                @click="copyText(user.id, 'User ID')"
              />
              <v-list-item
                v-if="user.email"
                prepend-icon="material-symbols:alternate-email"
                title="Copy email"
                @click="copyText(user.email ?? '', 'Email')"
              />
              <v-divider class="my-1" />
              <v-list-item
                class="user-detail__danger"
                prepend-icon="material-symbols:delete-outline"
                title="Delete user"
                @click="deleteOpen = true"
              />
            </v-list>
          </v-menu>
        </template>
      </PageHeader>

      <!-- The same strip the list carries, answering the same six questions about one
           person. Figures are mono; the two that are words are not. -->
      <div
        class="grid gap-px overflow-hidden rounded-(--idenzy-radius) border border-line bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="flex min-w-0 flex-col gap-1.5 bg-surface px-4 py-3.5"
        >
          <span class="text-xs text-ink/55">{{ fact.label }}</span>
          <span class="flex min-w-0 items-center gap-2">
            <span
              v-if="fact.dot"
              :class="fact.dot"
              aria-hidden="true"
              class="size-1.5 flex-none rounded-full"
            />
            <span
              :class="fact.mono ? 'font-mono text-lg leading-6 tabular-nums' : 'text-sm'"
              class="truncate font-medium text-ink"
            >
              {{ fact.value }}
            </span>
          </span>
          <span class="text-xs leading-4 text-ink/45">{{ fact.note }}</span>
        </div>
      </div>

      <!-- A tombstone has nothing under the strip worth drawing: what would fill these
           sections are the columns an erasure cleared. Said once, plainly. -->
      <PageSection
        v-if="deleted"
        :divided="false"
        description="What is left is the id, the timestamps and the trail."
        title="This account was erased"
      >
        <p class="m-0 max-w-2xl text-xs leading-6 text-ink/70">
          Name, email, phone, picture, metadata, sign-in methods and sessions were cleared on
          <span class="font-mono text-[13px] text-ink">{{
            formatDateTime(user.deletedAt ?? "")
          }}</span
          >, which is what an erasure is (PROJECT.md 4.13.6). The row survives so the audit
          trail keeps a subject it can no longer name, and that record is below.
        </p>
      </PageSection>

      <div class="account-details">
        <template v-if="!deleted">
          <div class="account-details__access">
            <UserDetailPanel
              title="How they sign in"
              description="Enrolled methods and their availability on this project."
              icon="material-symbols:key-outline"
            >
              <template #badge>
                <StatusBadge :label="signInLabel" :tone="signInPossible ? 'success' : 'warning'" />
              </template>
              <UserMethodList :standings="standings" />
              <p v-if="!signInPossible" class="account-details__note text-warning">
                Nothing enrolled on this account can be used on this project today.
              </p>
            </UserDetailPanel>

            <UserDetailPanel
              title="Second factor"
              description="An extra check when this person signs in."
              icon="material-symbols:shield-outline"
              :action="codes ? 'Manage recovery codes' : ''"
              :to="codes ? RECOVERY_ROUTE : undefined"
            >
              <div class="factor-status">
                <div>
                  <h3>{{ user.mfaEnabled ? 'Authenticator enrolled' : 'No authenticator enrolled' }}</h3>
                  <p>{{ user.mfaEnabled ? 'Password sign-ins require a second factor.' : 'A first factor alone signs them in.' }}</p>
                </div>
              </div>
              <p class="factor-explanation">
                {{ user.mfaEnabled
                  ? 'A passkey already proves a factor, so it is not challenged again.'
                  : 'Passkeys and recovery codes can answer a required challenge; neither enables the authenticator.' }}
              </p>
              <div v-if="codes && codesState" class="recovery-summary">
                <div class="flex items-center justify-between gap-3">
                  <span>Recovery codes</span>
                  <span class="font-mono text-ink">{{ codes.remaining }}<span class="text-ink/40"> / {{ CODE_SET.codes }}</span></span>
                </div>
                <div class="mt-2 flex items-center justify-between gap-3">
                  <RecoveryPips :remaining="codes.remaining" :state="codesState" />
                  <!-- The same three words the recovery screen's own badge uses. -->
                  <span :class="STATE_TEXT[codesState]">{{ STATE_LABELS[codesState] }}</span>
                </div>
              </div>
            </UserDetailPanel>
          </div>

          <UserDetailPanel
            title="Sessions"
            description="Devices signed in to this account, including sessions that have ended."
            icon="material-symbols:devices-outline"
            action="All sessions"
            to="/sessions"
          >
            <UserSessionList :loading="sessions.loading" :now="now" :sessions="ownSessions" @revoke="askRevoke" />
          </UserDetailPanel>
        </template>

        <div class="account-details__history" :class="{ 'account-details__history--single': deleted }">
          <UserDetailPanel
            v-if="!deleted"
            title="Security signals"
            :description="signalsNote"
            icon="material-symbols:radar"
            action="Security centre"
            to="/security"
          >
            <UserSignalList :coverage="coverage" :now="now" :signals="signals" />
          </UserDetailPanel>

          <UserDetailPanel
            title="Activity"
            description="What happened on this account, most recent first."
            icon="material-symbols:history"
            action="Audit trail"
            to="/audit"
          >
            <UserActivityFeed :events="activity" :now="now" />
          </UserDetailPanel>
        </div>
      </div>

      <UserSuspendDialog v-model="suspendOpen" :users="[user]" @confirm="suspend" />
      <UserDeleteDialog v-model="deleteOpen" :users="[user]" @confirm="erase" />
      <SessionRevokeDialog v-model="revokeOpen" :sessions="revokeTargets" @confirm="revoke" />
    </template>

    <v-snackbar
      v-model="toastOpen"
      :timeout="3000"
      class="user-detail__toast"
      color="surface"
      location="bottom right"
      rounded="lg"
      variant="flat"
    >
      <span class="text-xs text-ink">{{ toast }}</span>
    </v-snackbar>
  </div>
</template>

<style scoped>
.account-details { --detail-divider: rgba(var(--v-theme-on-surface), .12); display: grid; gap: 28px; padding-top: 8px; }
.account-details__access { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 32px; padding: 28px; border: 1px dashed var(--detail-divider); border-radius: 24px }
.account-details__access > :last-child { border-left: 1px dashed var(--detail-divider); padding-left: 32px; }
.account-details__history { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; }
.account-details__history > section { padding-top: 28px; border-top: 1px dashed var(--detail-divider); }
.account-details__history--single { grid-template-columns: minmax(0, 1fr); }
.factor-status { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
.factor-status__icon { display: flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; border-radius: 50%; font-size: 18px; }
.factor-status h3, .account-details__empty h3 { margin: 0; font-size: 13px; font-weight: 500; }
.factor-status p { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: rgba(var(--v-theme-on-surface), .6); }
.factor-explanation { margin: 12px 0 0 0; max-width: 44ch; font-size: 12px; line-height: 1.8; color: rgba(var(--v-theme-on-surface), .55); }
.recovery-summary { margin: 18px 0 0; padding-top: 14px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); font-size: 12px; }
.account-details__note { margin: 12px 0 0; font-size: 12px; line-height: 1.7; }
.account-details__empty { padding: 20px 0; }
.account-details__empty > .iconify { margin-bottom: 12px; font-size: 28px; color: rgba(var(--v-theme-on-surface), .35); }
.account-details__empty p { margin: 7px 0 0; color: rgba(var(--v-theme-on-surface), .6); font-size: 12px; line-height: 1.8; }
@media (max-width: 1000px) {
  .account-details__access, .account-details__history { grid-template-columns: minmax(0, 1fr); }
  .account-details__access > :last-child { border-left: 0; border-top: 1px dashed var(--detail-divider); padding: 24px 0 0; }
}
/* Outranks the nav list's own ink, three classes deep in theme.css. The scoped attribute
   survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.user-detail__danger,
.v-list--nav .v-list-item.user-detail__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
