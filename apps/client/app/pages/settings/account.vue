<script setup lang="ts">
/**
 * The signed-in person's own account: their address, their password, the factors they hold
 * and the sessions they hold them in (notes/account.md).
 *
 * The first job of this screen is to say whose account it is, because every other
 * credential screen in the drawer is about somebody else's. Sign-in methods and
 * multi-factor configure what a customer's *users* must do; this is what the person
 * reading it does. So the person is the title, with their own picture before it, which is
 * the one case `PageHeader` carries a mark at all.
 *
 * It is the reader's own detail page rather than a stack of settings cards: who you are in
 * a band of facts, then the two things that are actually credentials, then the devices
 * holding them. What each of those facts means used to be a paragraph under it; the
 * sentences are all still here, behind the glyph on each label, out of the way of somebody
 * who came to change a password (notes/shared-experience.md: state, then controls, then
 * rationale).
 *
 * What is not here are the essays: how avatars would work, which Argon2 parameters are
 * used, and a second article listing what the page never does. Those are documentation, and
 * on a screen where somebody has come to change a password they sat between the reader and
 * the control. The security checklist went too, because the factor panel below it was
 * already saying the same four things with the buttons attached.
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
import type { Fact } from "~/components/FactGrid.vue";
import type { RecordColumn } from "~/components/RecordTable.vue";
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

/**
 * How many slots the last row of the factor mosaic leaves empty, in its two tracks.
 *
 * The mosaic draws each cell's top and left hairline and lets the neighbour below and to
 * the right close it, so a slot with nothing in it leaves the passkey with no bottom rule
 * and the recovery code with no right one. A filler cell in that slot draws the two lines
 * a real cell would have. Zero when the row is full, so nothing renders.
 */
const FACTOR_TRACKS = 2;
const factorFillers = computed(
  () => (FACTOR_TRACKS - (factors.value.length % FACTOR_TRACKS)) % FACTOR_TRACKS,
);

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
 * Who you are, as against what you can change.
 *
 * The address is not in here and that is the rule rather than an oversight: it is the one
 * identity field somebody edits, so it belongs with the password under Sign-in. A fact
 * grid is for what is true; a control that lived in it would have nowhere to put its
 * button and no way to show a change already under way.
 */
const facts = computed<Fact[]>(() => {
  const rows: Fact[] = [
    {
      key: "id",
      label: "User ID",
      value: profile.value.userId,
      mono: true,
      copy: profile.value.userId,
      info: "How the audit trail names you, and how support identifies you without an address. It is pseudonymous and safe to paste into a ticket.",
    },
    {
      key: "joined",
      label: "Joined",
      value: formatDate(profile.value.createdAt),
      info: "When this dashboard account was created. It is not when the organisation was, and not when any project under it was.",
    },
    {
      key: "last",
      label: "Last sign-in",
      value: profile.value.lastSignInAt
        ? relativeTimeWords(profile.value.lastSignInAt, now.value)
        : "Never",
      note: "This session",
      info: "The session you are reading this in. Every session on the account, including this one, is listed under Devices.",
    },
  ];

  if (me.value === null) return rows;

  rows.push(
    {
      key: "org",
      label: "Organisation",
      value: org.value.name,
      to: "/settings/members",
      note: `${ORG_KIND_LABELS[kind.value]} · ${reach.value.length === 1 ? "one project" : `${reach.value.length} projects`}`,
      info: "Membership is of the organisation rather than of a project, which is why leaving ends access to every one of them.",
    },
    {
      key: "role",
      label: "Your role",
      value: roleInfo(me.value.role).label,
      info: roleInfo(me.value.role).note,
    },
    {
      key: "owner",
      label: "Owner",
      value: isOwner.value ? "You" : (owner.value?.name ?? "Nobody"),
      info: "Ownership moves by transfer rather than by being assigned, so there is exactly one of it at every moment.",
    },
  );

  return rows;
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
const nameOpen = ref(false);

function confirmName(name: string) {
  void whileBusy("name", () => store.patch({ name }));
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

/** Whether a factor may be given up, and why not when it may not. */
function factorLock(kind: AccountFactorKind, enrolled: boolean): string {
  return kind === "totp" && mfaRequired.value && enrolled
    ? "This organisation requires a second factor for the dashboard, so yours cannot be removed while that stands."
    : "";
}

const DEVICE_COLUMNS: readonly RecordColumn[] = [
  { key: "device", label: "Device", width: "minmax(0, 1.4fr)" },
  { key: "where", label: "Where from", width: "minmax(0, 1.2fr)" },
  { key: "active", label: "Last active", width: "140px" },
  { key: "action", label: "", width: "100px", align: "end" },
];

const saving = computed(() => busy.value.size > 0);
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- The person is the subject, so the person is the title and their picture stands
         before it. The breadcrumb and the rail both still say Account. -->
    <PageHeader :title="profile.name">
      <template #mark>
        <span
          aria-hidden="true"
          class="flex size-11 flex-none items-center justify-center rounded-full border border-line bg-ink/4 text-sm font-semibold text-primary"
        >
          {{ profile.name.slice(0, 2).toUpperCase() }}
        </span>
      </template>
      <template #badge>
        <StatusBadge
          :label="twoFactor ? 'Two-factor on' : 'Password only'"
          :tone="twoFactor ? 'success' : 'warning'"
        />
      </template>
      <template #description>
        Your own sign-in to this dashboard, not your users'. What
        <span class="font-medium text-ink">they</span> must do is on the sign-in method and
        multi-factor screens.
      </template>
      <template #actions>
        <v-btn
          :loading="isBusy('name')"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:edit-outline"
          size="small"
          variant="outlined"
          @click="nameOpen = true"
        >
          Edit name
        </v-btn>
      </template>
    </PageHeader>

    <!-- Said once, at the top, because it is true of every control below it. -->
    <InfoNote
      v-if="!ACCOUNT_WRITES.running"
      :text="ACCOUNT_WRITES.reason"
      icon="material-symbols:warning-outline"
      tone="warning"
    />

    <FactGrid :columns="3" :facts="facts" label="Account facts" />

    <!-- The two things on the page that are credentials rather than state. Both are
         dialogs, because each is one value with a consequence worth reading first. -->
    <PageSection
      :divided="false"
      description="What you sign in with. Both of these ask you to confirm before anything moves."
      title="Sign-in"
    >
      <div class="divide-y divide-line">
        <SettingRow
          description="Changing it starts a confirmation on the old address as well as the new one, and the address here keeps working until both have answered."
          label="Address"
        >
          <template #actions>
            <span class="font-mono text-xs text-ink/70">{{ profile.email }}</span>
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
              class="flex flex-wrap items-center justify-between gap-3 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset"
            >
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="flex flex-wrap items-center gap-2 text-xs font-medium text-ink">
                  Moving to
                  <span class="font-mono">{{ pendingEmail.email }}</span>
                  <StatusBadge
                    :label="isEmailChangeExpired(pendingEmail, now) ? 'Expired' : 'Pending'"
                    :tone="isEmailChangeExpired(pendingEmail, now) ? 'warning' : 'neutral'"
                  />
                </span>
                <span class="text-xs leading-5 text-ink/60">
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
          description="Argon2id under a pepper in the key store, the same parameters your users' passwords get. The current one is asked for even from inside a session."
          label="Password"
        >
          <template #actions>
            <span class="text-xs text-ink/55">
              {{
                profile.passwordChangedAt
                  ? `Changed ${relativeTimeWords(profile.passwordChangedAt, now)}`
                  : "Never set"
              }}
            </span>
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
      </div>
    </PageSection>

    <!--
      The dominant region, and what makes this page not the project's. Four things with a
      state and an action each: a table row would spend the page's width on two short words,
      and four separately bordered cards would be four frames for one question. One frame,
      hairlines inside it, the same mosaic the fact band uses.
    -->
    <PageSection
      description="What answers a challenge, and which one of them starts demanding it. Nothing here is enforced by us: an authenticator is what turns two-factor on, and the other two answer a challenge something else demanded."
      title="Second factors"
    >
      <div
        class="grid overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface sm:grid-cols-2"
      >
        <div
          v-for="factor in factors"
          :key="factor.kind"
          class="-mt-px -ml-px flex min-w-0 flex-col gap-2 border-t border-l border-line p-4"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-medium text-ink">
              {{ factorRoleOf(factor.kind)?.label ?? factor.kind }}
            </span>
            <span
              v-if="FACTOR_DEMANDS[factor.kind]"
              class="flex-none rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
            >
              Turns it on
            </span>
            <button
              :aria-label="`About ${factorRoleOf(factor.kind)?.label ?? factor.kind}`"
              class="ml-auto flex size-4 flex-none items-center justify-center rounded-full text-ink/40 transition-colors duration-150 hover:text-ink/80 focus-visible:text-ink/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              type="button"
            >
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:info-outline" />
              <v-tooltip
                :text="FACTOR_NOTES[factor.kind]"
                activator="parent"
                location="top"
                max-width="280"
                open-delay="200"
              />
            </button>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge
              :detail="factor.enrolled && factor.count !== null ? String(factor.count) : ''"
              :label="factor.enrolled ? 'Enrolled' : 'Not set up'"
              :tone="factor.enrolled ? 'success' : 'neutral'"
            />

            <v-tooltip
              :disabled="factorLock(factor.kind, factor.enrolled) === ''"
              :text="factorLock(factor.kind, factor.enrolled)"
              location="top"
              max-width="260"
            >
              <template #activator="{ props: tip }">
                <span v-bind="tip">
                  <v-btn
                    :color="factor.enrolled ? 'neutral' : 'primary'"
                    :disabled="factorLock(factor.kind, factor.enrolled) !== ''"
                    :loading="isBusy(factor.kind)"
                    class="text-xs font-medium"
                    size="small"
                    variant="text"
                    @click="factor.enrolled ? removeFactor(factor.kind) : undefined"
                  >
                    {{ factor.enrolled ? "Remove" : "Set up" }}
                  </v-btn>
                </span>
              </template>
            </v-tooltip>
          </div>
        </div>

        <!-- The slot an odd count leaves empty, only from `sm` where there are two tracks:
             its top and left hairlines are the bottom rule of the cell above and the right
             rule of the cell beside it, which no real cell draws. -->
        <div
          v-for="slot in factorFillers"
          :key="`filler-${slot}`"
          aria-hidden="true"
          class="-mt-px -ml-px hidden border-t border-l border-line sm:block"
        />
      </div>

      <InfoNote :text="RECOVERY_FOLLOWS_NOTE" icon="material-symbols:key-vertical-outline" />
    </PageSection>

    <PageSection :description="OWN_SESSIONS_NOTE" title="Devices">
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

      <div>
        <RecordTable :columns="DEVICE_COLUMNS" framed label="Your dashboard sessions">
          <li v-for="session in store.sessions" :key="session.id" class="record-row">
            <span class="record-cell record-cell--primary" data-label="Device">
              <span class="flex min-w-0 items-center gap-2.5">
                <span
                  :class="session.current ? 'bg-success/10 text-success' : 'bg-ink/6 text-ink/60'"
                  aria-hidden="true"
                  class="flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
                >
                  <Icon class="text-base" name="material-symbols:devices" />
                </span>
                <span class="flex min-w-0 flex-col">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate font-medium text-ink">{{ session.deviceName }}</span>
                    <StatusBadge v-if="session.current" label="This device" tone="success" />
                  </span>
                  <span class="truncate text-[11px] text-ink/55">{{ session.browser }}</span>
                </span>
              </span>
            </span>

            <span class="record-cell record-cell--half" data-label="Where from">
              <span class="flex min-w-0 flex-col">
                <span v-if="session.country" class="flex items-center gap-1 text-ink/70">
                  <span aria-hidden="true">{{ countryFlag(session.country) }}</span>
                  <span class="truncate">{{ countryName(session.country) }}</span>
                </span>
                <span class="truncate font-mono text-[11px] text-ink/55">{{ session.ip }}</span>
              </span>
            </span>

            <span class="record-cell record-cell--half text-ink/70" data-label="Last active">
              {{ relativeTimeWords(session.lastActiveAt, now) }}
            </span>

            <span class="record-cell record-cell--end record-cell--action">
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
            </span>
          </li>
        </RecordTable>

        <p class="m-0 mt-3 text-xs leading-5 text-ink/50">
          The same refresh rotation and reuse detection the product sells. A token presented
          twice revokes the whole family, which is as true of this dashboard as of your app.
        </p>
      </div>
    </PageSection>

    <SaveStatus :last-saved="store.lastSaved" :saving="saving" />

    <DangerZone
      :title="`Leave ${org.name}`"
      action="Leave organisation"
      description="Your access ends. Nothing you made stops working."
      @confirm="leaveOpen = true"
    >
      <p class="m-0 text-xs leading-5 text-ink/70">
        Access to
        {{ reach.length === 1 ? "its project" : `all ${reach.length} of its projects` }} ends.
        Keys, webhooks and hooks belong to the project rather than to you, so they keep
        working after you go, and the audit trail keeps your name. Coming back needs a new
        invitation.
      </p>
    </DangerZone>

    <AccountNameDialog
      v-if="nameOpen"
      v-model="nameOpen"
      :busy="isBusy('name')"
      :current="profile.name"
      @confirm="confirmName"
    />

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
