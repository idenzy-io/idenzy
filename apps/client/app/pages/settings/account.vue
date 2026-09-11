<script setup lang="ts">
/**
 * The signed-in person's own account: their address, their password, the factors they hold
 * and the sessions they hold them in (notes/account.md).
 *
 * The first job of this screen is to say whose account it is, because every other
 * credential screen in the drawer is about somebody else's. Sign-in methods and
 * multi-factor configure what a customer's *users* must do; this is what the person
 * reading it does. That sentence is in the header and repeated on the devices card, which
 * is the one place the two lists could genuinely be confused.
 *
 * It is a tab of the settings screen and still global: the project in the corner changes
 * nothing here, and the memberships section is where the organisation appears, named,
 * because leaving one is the only thing on this page with a scope at all.
 *
 * Four sections in the note's order, and nothing else. What was here before and is not now
 * are the essays: how avatars would work, which Argon2 parameters are used, and a second
 * article listing what the page never does. Those are documentation, and on a screen where
 * somebody has come to change a password they sat between the reader and the control.
 *
 * Three rules are worth the room they take. Changing an address confirms on *both*
 * addresses, so somebody at an unlocked screen cannot move an account somewhere its owner
 * cannot reach, and until both have answered the live address is unchanged. Changing a
 * password asks for the current one even from inside a session, because a session proves
 * somebody signed in once rather than that this is still them. And an authenticator is the
 * only factor that turns two-factor on: a passkey and a recovery set answer a challenge
 * something else demanded, so enrolling a passkey does not start challenging password
 * sign-ins.
 */
import {
  ACCOUNT_WRITES,
  type AccountFactorKind,
  CURRENT_SESSION_NOTE,
  emailChangeWords,
  FACTOR_DEMANDS,
  FACTOR_NOTES,
  factorRoleOf,
  isEmailChangeExpired,
  leaveRefusalFor,
  OWN_SESSIONS_NOTE,
  RECOVERY_FOLLOWS_NOTE,
  twoFactorOn,
} from "~/utils/account";
import { ownerOf, roleInfo } from "~/utils/members";
import { ORG_KIND_LABELS, orgKindOf } from "~/utils/organisation";
import { countryFlag, countryName } from "~/utils/sessions";
import { formatDate, relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useAccountStore();
const members = useMembersStore();

const now = useNow({ interval: 30_000 });

const profile = computed(() => store.profile);
const factors = computed(() => store.factors);
const twoFactor = computed(() => twoFactorOn(factors.value));
const pendingEmail = computed(() => store.emailChange);

/** Who I am on this organisation, and who owns it. Read from the members screen's store. */
const org = computed(() => projects.currentOrg);
const team = computed(() => members.forOrg(org.value.id));
const me = computed(() => members.currentMember(org.value.id));
const owner = computed(() => ownerOf(team.value));
const mfaRequired = computed(() => members.mfaRequired(org.value.id));
const isOwner = computed(() => me.value?.role === "owner");
const leaveRefusal = computed(() => leaveRefusalFor(isOwner.value, team.value.length));
const kind = computed(() => orgKindOf(team.value.length));
const reach = computed(() => projects.projectsOf(org.value.id));

/**
 * The short list of things worth doing something about, and it is deliberately short. A
 * checklist that scored everything would be a checklist nobody finishes. Inline in the
 * section it is about rather than in a rail of its own, so it sits beside the controls that
 * answer it.
 */
const checks = computed(() => {
  const recovery = factors.value.find((factor) => factor.kind === "recovery");
  const age = profile.value.passwordChangedAt
    ? Math.floor(
        (now.value.getTime() - new Date(profile.value.passwordChangedAt).getTime()) / 86_400_000,
      )
    : null;
  return [
    {
      id: "mfa",
      label: "Second factor",
      ok: twoFactor.value,
      detail: twoFactor.value ? "An authenticator is enrolled" : "Nothing challenges a sign-in",
    },
    {
      id: "recovery",
      label: "Recovery codes",
      ok: (recovery?.count ?? 0) > 0,
      detail: recovery?.enrolled ? `${recovery.count} unspent` : "None to fall back on",
    },
    {
      id: "passkey",
      label: "Passkey",
      ok: factors.value.some((factor) => factor.kind === "passkey" && factor.enrolled),
      detail: "A way in that no phishing page can take",
    },
    {
      id: "password",
      label: "Password age",
      ok: age === null || age < 365,
      detail:
        profile.value.passwordChangedAt === null
          ? "No password set"
          : `Changed ${relativeTimeWords(profile.value.passwordChangedAt, now.value)}`,
    },
  ];
});

/*
 * Saving.
 */
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

const emailOpen = ref(false);
const passwordOpen = ref(false);
const leaveOpen = ref(false);
const nameDraft = ref("");
const editingName = ref(false);

function startRename() {
  nameDraft.value = profile.value.name;
  editingName.value = true;
}

function commitName() {
  const value = nameDraft.value.trim();
  editingName.value = false;
  if (value === "" || value === profile.value.name) return;
  void whileBusy("name", () => store.patch({ name: value }));
}

/**
 * Starts the change and moves nothing.
 *
 * The address on the account stays the live one until both sides confirm, so this writes a
 * pending record beside the profile rather than over it. Writing the new address in with
 * `emailVerified: false` is what the note calls out: it reads as a move that happened, on
 * an account whose owner can still only reach the old mailbox.
 */
function confirmEmail(email: string) {
  void whileBusy("email", () => store.startEmailChange(email));
}

function cancelEmail() {
  void whileBusy("email", () => store.cancelEmailChange());
}

function confirmPassword(signOutOthers: boolean) {
  void whileBusy("password", () => store.changePassword(signOutOthers));
}

function removeFactor(kind: AccountFactorKind) {
  void whileBusy(kind, () => store.removeFactor(kind));
}

function revokeSession(id: string) {
  void whileBusy(id, () => store.revokeSession(id));
}

function signOutOthers() {
  void whileBusy("others", () => store.signOutOthers());
}

function confirmLeave() {
  void whileBusy("leave", async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await navigateTo("/auth/login");
  });
}

const otherSessions = computed(() => store.sessions.filter((session) => !session.current));

const saving = computed(() => busy.value.size > 0);
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Account">
      <template #description>
        Your own sign-in to this dashboard, not your users'. What
        <span class="font-medium text-ink">they</span> must do is on the sign-in method and
        multi-factor screens; nothing here touches it.
      </template>
    </PageHeader>

    <!-- Said once, at the top, because it is true of every control below it. -->
    <p
      v-if="!ACCOUNT_WRITES.running"
      class="m-0 flex items-start gap-2 rounded-(--idenzy-radius) border border-warning/40 bg-warning/8 p-3 text-[11px] leading-4 text-warning"
    >
      <Icon
        aria-hidden="true"
        class="mt-0.5 flex-none text-sm"
        name="material-symbols:warning-outline"
      />
      <span>{{ ACCOUNT_WRITES.reason }}</span>
    </p>

    <LayerCard description="What the member list and the audit trail call you." title="Profile">
      <div class="flex flex-wrap items-center gap-4 pb-5">
        <span
          aria-hidden="true"
          class="flex size-14 flex-none items-center justify-center rounded-full border border-line bg-ink/4 text-sm font-semibold text-primary"
        >
          {{ profile.name.slice(0, 2).toUpperCase() }}
        </span>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-base font-medium text-ink">{{ profile.name }}</span>
          <span class="font-mono text-xs text-ink/55">{{ profile.email }}</span>
        </div>
      </div>

      <div class="divide-y divide-line border-t border-line">
        <SettingRow
          description="What the member list and the audit trail show beside anything you do."
          label="Display name"
        >
          <template #actions>
            <v-btn
              v-if="!editingName"
              :loading="isBusy('name')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="text"
              @click="startRename"
            >
              {{ profile.name }}
            </v-btn>
          </template>
          <v-text-field
            v-if="editingName"
            v-model="nameDraft"
            autofocus
            density="compact"
            hide-details
            style="min-width: 180px"
            variant="outlined"
            @blur="commitName"
            @keyup.enter="commitName"
          />
        </SettingRow>

        <SettingRow
          description="What you sign in with. Changing it starts a confirmation on the old address as well as the new one, and the address here keeps working until both have answered."
          label="Address"
        >
          <template #actions>
            <StatusBadge
              :label="profile.emailVerified ? 'Verified' : 'Not verified'"
              :tone="profile.emailVerified ? 'success' : 'warning'"
            />
            <v-btn
              :disabled="pendingEmail !== null"
              :loading="isBusy('email')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="text"
              @click="emailOpen = true"
            >
              Change
            </v-btn>
          </template>
          <template v-if="pendingEmail" #detail>
            <div
              class="flex flex-wrap items-center justify-between gap-3 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5"
            >
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="flex flex-wrap items-center gap-2 text-[11px] font-medium text-ink">
                  Moving to
                  <span class="font-mono">{{ pendingEmail.email }}</span>
                  <StatusBadge
                    :label="isEmailChangeExpired(pendingEmail, now) ? 'Expired' : 'Pending'"
                    :tone="isEmailChangeExpired(pendingEmail, now) ? 'warning' : 'neutral'"
                  />
                </span>
                <span class="text-[11px] leading-4 text-ink/60">
                  {{ emailChangeWords(pendingEmail, now) }}
                </span>
              </span>
              <v-btn
                :loading="isBusy('email')"
                class="flex-none text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="cancelEmail"
              >
                Cancel the change
              </v-btn>
            </div>
          </template>
        </SettingRow>

        <SettingRow
          description="How the audit trail names you, and how support identifies you without an address. It is pseudonymous and safe to paste into a ticket."
          fixed="Fixed"
          label="User ID"
        >
          <template #detail>
            <CopyField :value="profile.userId" dense label="Copy your user ID" />
          </template>
        </SettingRow>

        <SettingRow
          :description="`Signed in ${profile.lastSignInAt ? relativeTimeWords(profile.lastSignInAt, now) : 'never'}, from the session you are reading this in.`"
          :fixed="formatDate(profile.createdAt)"
          label="Joined"
        />
      </div>
    </LayerCard>

    <LayerCard
      description="Your password and the factors your account holds. The rules are the ones your own projects run on, because this dashboard is a customer of them."
      title="Security"
    >
      <template #badge>
        <StatusBadge
          :label="twoFactor ? 'Two-factor on' : 'Password only'"
          :tone="twoFactor ? 'success' : 'warning'"
        />
      </template>

      <!-- The checklist, compact and in the section it is about. Four things worth having;
           nothing here is enforced by us. -->
      <ul class="m-0 grid list-none gap-2 p-0 pb-5 sm:grid-cols-2">
        <li v-for="check in checks" :key="check.id" class="flex items-start gap-2">
          <Icon
            :class="check.ok ? 'text-success' : 'text-warning'"
            :name="
              check.ok
                ? 'material-symbols:check-circle-outline'
                : 'material-symbols:error-outline'
            "
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[11px] font-medium text-ink">{{ check.label }}</span>
            <span class="text-[11px] leading-4 text-ink/55">{{ check.detail }}</span>
          </span>
        </li>
      </ul>

      <div class="divide-y divide-line border-t border-line">
        <SettingRow
          :description="`Argon2id under a pepper in the key store, the same parameters your users' passwords get. ${profile.passwordChangedAt ? `Last changed ${relativeTimeWords(profile.passwordChangedAt, now)}.` : ''} The current one is asked for even from inside a session.`"
          label="Password"
        >
          <template #actions>
            <v-btn
              :loading="isBusy('password')"
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:edit-outline"
              size="small"
              variant="text"
              @click="passwordOpen = true"
            >
              Change
            </v-btn>
          </template>
        </SettingRow>

        <SettingRow
          v-for="factor in factors"
          :key="factor.kind"
          :description="FACTOR_NOTES[factor.kind]"
          :label="factorRoleOf(factor.kind)?.label ?? factor.kind"
        >
          <template #actions>
            <span
              v-if="FACTOR_DEMANDS[factor.kind]"
              class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Turns it on
            </span>
            <StatusBadge
              :detail="factor.enrolled && factor.count !== null ? String(factor.count) : ''"
              :label="factor.enrolled ? 'Enrolled' : 'Not set up'"
              :tone="factor.enrolled ? 'success' : 'neutral'"
            />
            <v-tooltip
              :disabled="!(factor.kind === 'totp' && mfaRequired && factor.enrolled)"
              location="top"
              max-width="260"
              text="This organisation requires a second factor for the dashboard, so yours cannot be removed while that stands."
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip">
                  <v-btn
                    :disabled="factor.kind === 'totp' && mfaRequired && factor.enrolled"
                    :loading="isBusy(factor.kind)"
                    class="text-xs font-medium"
                    :color="factor.enrolled ? 'neutral' : 'primary'"
                    size="small"
                    variant="text"
                    @click="factor.enrolled ? removeFactor(factor.kind) : undefined"
                  >
                    {{ factor.enrolled ? "Remove" : "Set up" }}
                  </v-btn>
                </span>
              </template>
            </v-tooltip>
          </template>
        </SettingRow>
      </div>

      <p
        class="m-0 mt-5 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5 text-[11px] leading-4 text-ink/65"
      >
        <Icon
          aria-hidden="true"
          class="mt-px flex-none text-sm text-ink/40"
          name="material-symbols:key-vertical-outline"
        />
        <span>{{ RECOVERY_FOLLOWS_NOTE }}</span>
      </p>
    </LayerCard>

    <LayerCard :description="OWN_SESSIONS_NOTE" :padded="false" title="Devices">
      <template #actions>
        <v-btn
          :disabled="otherSessions.length === 0"
          :loading="isBusy('others')"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="signOutOthers"
        >
          Sign out the others
        </v-btn>
      </template>

      <ul class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="session in store.sessions"
          :key="session.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
        >
          <span
            :class="session.current ? 'bg-success/10 text-success' : 'bg-ink/6 text-ink/60'"
            aria-hidden="true"
            class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
          >
            <Icon class="text-lg" name="material-symbols:devices" />
          </span>

          <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
            <span class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-ink">{{ session.deviceName }}</span>
              <StatusBadge v-if="session.current" label="This device" tone="success" />
            </span>
            <span
              class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55"
            >
              <span>{{ session.browser }}</span>
              <span class="font-mono">{{ session.ip }}</span>
              <span v-if="session.country" class="flex items-center gap-1">
                <span aria-hidden="true">{{ countryFlag(session.country) }}</span>
                {{ countryName(session.country) }}
              </span>
              <span>Active {{ relativeTimeWords(session.lastActiveAt, now) }}</span>
            </span>
          </div>

          <v-tooltip
            :disabled="!session.current"
            :text="CURRENT_SESSION_NOTE"
            location="top"
            max-width="260"
          >
            <template #activator="{ props: tip }">
              <span v-bind="tip">
                <v-btn
                  :disabled="session.current"
                  :loading="isBusy(session.id)"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="text"
                  @click="revokeSession(session.id)"
                >
                  Sign out
                </v-btn>
              </span>
            </template>
          </v-tooltip>
        </li>
      </ul>

      <p class="m-0 border-t border-line px-4 py-2.5 text-[10px] leading-4 text-ink/45">
        The same refresh rotation and reuse detection the product sells. A token presented
        twice revokes the whole family, which is as true of this dashboard as of your app.
      </p>
    </LayerCard>

    <LayerCard
      v-if="me"
      description="Which organisation you are in, what you are in it, and who to ask when you need more."
      title="Memberships"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="`You reach ${reach.length === 1 ? 'its one project' : `all ${reach.length} of its projects`} through it. Membership is of the organisation rather than of a project, which is why leaving ends access to every one of them.`"
          :fixed="`${org.name} · ${ORG_KIND_LABELS[kind]}`"
          label="Organisation"
        >
          <template #actions>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:group-outline"
              size="small"
              to="/settings/members"
              variant="text"
            >
              Members
            </v-btn>
          </template>
        </SettingRow>
        <SettingRow
          :description="roleInfo(me.role).note"
          :fixed="roleInfo(me.role).label"
          label="Your role"
        />
        <SettingRow
          v-if="owner"
          :description="`Ownership moves by transfer rather than by being assigned, so there is exactly one and it is ${isOwner ? 'you' : owner.name}.`"
          :fixed="isOwner ? 'You' : owner.name"
          label="Owner"
        />
        <SettingRow
          :description="
            mfaRequired
              ? 'This organisation requires a second factor for the dashboard, so yours cannot be removed while that stands.'
              : 'Members may sign in with a password alone. The requirement is on the members screen and applies to everybody.'
          "
          :fixed="mfaRequired ? 'Required' : 'Optional'"
          label="Second factor for members"
        />
      </div>
    </LayerCard>

    <SaveStatus :last-saved="store.lastSaved" :saving="saving" />

    <!-- Last, and in its own frame: the one block whose weight should differ before
         anything is read. -->
    <section class="rounded-(--idenzy-radius-large) border border-error/25 bg-error/3 p-1">
      <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 flex items-center gap-2 text-sm font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-base text-error"
              name="material-symbols:door-open-outline"
            />
            Leave {{ org.name }}
          </h2>
          <p class="m-0 text-xs text-ink/55">
            Your access ends. Nothing you made stops working.
          </p>
        </div>
      </header>

      <div class="rounded-(--idenzy-radius) border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <p class="m-0 max-w-lg text-xs leading-5 text-ink/70">
            Access to
            {{ reach.length === 1 ? "its project" : `all ${reach.length} of its projects` }}
            ends. Keys, webhooks and hooks belong to the project rather than to you, so they
            keep working after you go, and the audit trail keeps your name. Coming back needs
            a new invitation.
          </p>
          <v-btn
            class="text-xs font-medium"
            color="error"
            size="small"
            variant="flat"
            @click="leaveOpen = true"
          >
            Leave organisation
          </v-btn>
        </div>
      </div>
    </section>

    <AccountEmailDialog
      v-if="emailOpen"
      v-model="emailOpen"
      :busy="isBusy('email')"
      :current="profile.email"
      @confirm="confirmEmail"
    />

    <AccountPasswordDialog
      v-if="passwordOpen"
      v-model="passwordOpen"
      :busy="isBusy('password')"
      @confirm="confirmPassword"
    />

    <AccountLeaveDialog
      v-if="leaveOpen"
      v-model="leaveOpen"
      :busy="isBusy('leave')"
      :org-name="org.name"
      :refusal="leaveRefusal"
      @confirm="confirmLeave"
    />
  </div>
</template>
