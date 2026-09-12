<script setup lang="ts">
/**
 * Who is on the organisation's team, what each of them may do, and how somebody joins or
 * leaves (PROJECT.md 3.3, 4.13.7, notes/settings-members.md).
 *
 * It is a list screen, which is what the note's own desktop arrangement drew
 * (`[Name + email | Role | MFA readiness | Last active | Actions]`) and what the
 * implementation had turned into an avatar list under four cards of prose. So it is the
 * `/users` shape: the strip of figures, then a card with a toolbar and a table, and the
 * two screens are read the same way because they are the same task. What is left of the
 * settings is one policy row and one folded matrix.
 *
 * The team belongs to the organisation and not to a project, and the screen says so in the
 * header and in every dialog that changes anything. That is the note's first scope
 * finding: a person is invited to an organisation and reaches every project under it, so
 * "remove from this project" would be a lie on an organisation holding three, and somebody
 * would keep access they were told they had lost.
 *
 * The rules are the interesting part rather than the list. There is exactly one owner and
 * there always will be: ownership is not a role anybody can be assigned, it moves by
 * transfer, which promotes and demotes in one act. The owner cannot be removed. Both are
 * enforced in `~/utils/members` rather than by hiding a button, because a rule a template
 * merely hides is a rule an API call gets past, and both are refused with the reason.
 *
 * Ownership has no card of its own any more. Who holds it is a fact in the strip, and
 * handing it on is an act performed on the person receiving it, which is where the ordinary
 * reader looks for it: a section whose only control opened a dialog asking "to whom?" made
 * two routes to one act.
 *
 * The capability matrix says one uncomfortable thing on purpose. Anybody who can mint an
 * API key has whatever the management API allows, so the line under that row is where the
 * dashboard's roles stop being a security boundary. A permission model that implied
 * otherwise would be worse than one that admits it.
 */

import type { Fact } from "~/components/FactGrid.vue";
import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { ColumnState, DataTableColumn } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  type CapabilityInfo,
  canRole,
  INVITE_TTL_DAYS,
  type Invitation,
  isInviteExpired,
  MEMBER_ROLES,
  type Member,
  type MemberRole,
  membersWithoutMfa,
  ownerOf,
  REFUSAL_LABELS,
  refusalFor,
  roleInfo,
  SEATS_ARE_FREE,
} from "~/utils/members";
import { ORG_KIND_LABELS, ORG_KIND_NOTES, orgKindOf } from "~/utils/organisation";
import { formatDate, relativeTimeWords } from "~/utils/time";

const route = useRoute();
const router = useRouter();

const projects = useProjectStore();
const store = useMembersStore();

const now = useNow({ interval: 60_000 });

const org = computed(() => projects.currentOrg);
const members = computed(() => store.forOrg(org.value.id));
const invitations = computed(() => store.invitationsFor(org.value.id));
const me = computed(() => store.currentMember(org.value.id));
const owner = computed(() => ownerOf(members.value));
const withoutMfa = computed(() => membersWithoutMfa(members.value));
const mfaRequired = computed(() => store.mfaRequired(org.value.id));
const lastSaved = computed(() => store.lastSavedAt(org.value.id));
const kind = computed(() => orgKindOf(members.value.length));

/** Every project the team reaches, which is what a removal actually takes away. */
const reach = computed(() => projects.projectsOf(org.value.id));

/** Whether the person reading this may change the team at all. */
const canManage = computed(() => (me.value === null ? false : canRole(me.value.role, "members")));

/**
 * Which list is showing, kept in the URL so a screen somebody is asked to look at can be
 * linked to. Replaced rather than pushed: moving between the two is not navigation to step
 * back through.
 */
const view = computed<"members" | "invitations">(() => {
  const asked = route.query["view"];
  const value = Array.isArray(asked) ? asked[0] : asked;
  return value === "invitations" ? "invitations" : "members";
});

const tab = computed<string>({
  get: () => view.value,
  set: (value) => {
    void router.replace({ query: { ...route.query, view: value } });
  },
});

const tabs = computed<SegmentedOption[]>(() => [
  { value: "members", label: `Members ${members.value.length}` },
  { value: "invitations", label: `Invitations ${invitations.value.length}` },
]);

/**
 * The four answers somebody arrives for: how many of us, what a seat costs, how many hold
 * a second factor, and who can hand the organisation on.
 */
const facts = computed<Fact[]>(() => [
  {
    key: "members",
    label: "Members",
    value: `${members.value.length}`,
    mono: true,
    note: `${ORG_KIND_LABELS[kind.value]} · reaches ${reach.value.length === 1 ? "one project" : `${reach.value.length} projects`}`,
    info: ORG_KIND_NOTES[kind.value],
  },
  {
    key: "seats",
    label: "Seat price",
    value: SEATS_ARE_FREE ? "Free" : "Per seat",
    note: SEATS_ARE_FREE ? "No per-seat charge" : "",
    info: "There is no per-seat price and there is not going to be one, so the size of the team is not a decision about money. Inviting somebody changes nothing on the bill.",
  },
  {
    key: "mfa",
    label: "Second factor",
    value: `${members.value.length - withoutMfa.value.length} of ${members.value.length}`,
    mono: true,
    note: mfaRequired.value ? "Required of the team" : "Not required",
    info: "How many of the team hold a second factor for this dashboard. Their own factors live on their account screen, and nobody else can enrol one for them.",
  },
  {
    key: "owner",
    label: "Owner",
    value: owner.value?.name ?? "Nobody",
    note: owner.value?.id === store.currentId ? "That is you" : (owner.value?.email ?? ""),
    info: "Exactly one, always. The only seat that can hand the organisation on or delete a project, and it cannot be removed or demoted. It moves by transfer, which promotes and demotes in one act.",
  },
]);

const expanded = reactive({ roles: false });

const busy = ref<Set<string>>(new Set());
const saving = computed(() => busy.value.size > 0);

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

function ago(stamp: string): string {
  const at = new Date(stamp);
  return relativeTimeWords(stamp, now.value < at ? at : now.value);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

/*
 * Finding somebody.
 *
 * The term is not in the query: an address in a URL is personal data in a browser history,
 * which is the rule the data-requests screen already keeps.
 */
const query = ref("");

const matchedMembers = computed(() => {
  const term = query.value.trim().toLowerCase();
  if (term === "") return members.value;
  return members.value.filter(
    (member) =>
      member.name.toLowerCase().includes(term) || member.email.toLowerCase().includes(term),
  );
});

const matchedInvitations = computed(() => {
  const term = query.value.trim().toLowerCase();
  if (term === "") return invitations.value;
  return invitations.value.filter((invitation) => invitation.email.toLowerCase().includes(term));
});

/*
 * Acting on a member.
 */

const inviteOpen = ref(false);
const removeOpen = ref(false);
const transferOpen = ref(false);
const mfaOpen = ref(false);
const acting = ref<Member | null>(null);

/** Why an action is refused, or empty when it is not. Shown rather than hidden. */
function refusal(action: "change_role" | "remove", member: Member): string {
  if (me.value === null) return "";
  const found = refusalFor(action, me.value, member);
  return found === null ? "" : REFUSAL_LABELS[found];
}

function setRole(member: Member, role: MemberRole) {
  if (refusal("change_role", member) !== "") return;
  void whileBusy(member.id, () => store.setRole(org.value.id, member.id, role));
}

function askRemoval(member: Member) {
  acting.value = member;
  removeOpen.value = true;
}

async function confirmRemoval() {
  const target = acting.value;
  if (target === null) return;
  await whileBusy(target.id, () => store.remove(org.value.id, target.id));
  removeOpen.value = false;
}

async function confirmTransfer(toId: string) {
  await whileBusy("transfer", () => store.transfer(org.value.id, toId));
  transferOpen.value = false;
}

async function confirmInvite(draft: { email: string; role: MemberRole }) {
  await whileBusy("invite", () => store.invite(org.value.id, draft.email, draft.role));
  inviteOpen.value = false;
}

function resend(id: string) {
  void whileBusy(id, () => store.resend(org.value.id, id));
}

function revoke(id: string) {
  void whileBusy(id, () => store.revoke(org.value.id, id));
}

async function confirmMfa(required: boolean) {
  await whileBusy("mfa", () => store.setMfaRequired(org.value.id, required));
  mfaOpen.value = false;
}

const candidates = computed(() => members.value.filter((member) => member.role !== "owner"));

/* A dialog belongs to the organisation it was opened from. */
watch(
  () => org.value.id,
  () => {
    inviteOpen.value = false;
    removeOpen.value = false;
    transferOpen.value = false;
    mfaOpen.value = false;
    acting.value = null;
  },
);

/**
 * Whether anything enforces the second-factor requirement.
 *
 * Nothing does. There is no enrolment step inside the dashboard's own sign-in, so the
 * requirement is recorded and a member without a factor still gets in. Stated here once
 * and read by the row and the dialog, so the two cannot come to disagree about it.
 */
const MFA_ENFORCED = false;

/*
 * The team, as a table.
 */

const MEMBER_COLUMNS: readonly DataTableColumn<Member>[] = [
  {
    key: "member",
    title: "Member",
    fixed: true,
    minWidth: 260,
    skeleton: "identity",
    value: (member) => member.name.toLowerCase(),
  },
  { key: "role", title: "Role", width: 148, value: (member) => roleInfo(member.role).label },
  {
    key: "mfa",
    title: "Second factor",
    width: 148,
    skeleton: "pill",
    value: (member) => (member.mfaEnrolled ? 1 : 0),
  },
  {
    key: "lastActiveAt",
    title: "Last active",
    width: 148,
    value: (member) => member.lastActiveAt ?? "",
  },
  { key: "joinedAt", title: "Joined", width: 128, hidden: true },
];

const INVITE_COLUMNS: readonly DataTableColumn<Invitation>[] = [
  { key: "email", title: "Invited address", fixed: true, minWidth: 260, mono: true },
  { key: "role", title: "Role", width: 148, value: (invite) => roleInfo(invite.role).label },
  { key: "invitedBy", title: "Invited by", width: 176 },
  { key: "invitedAt", title: "Sent", width: 128 },
  { key: "expiresAt", title: "Stands until", width: 176, skeleton: "pill" },
];

const storedMemberColumns = useLocalStorage<ColumnState>(
  "idenzy.members.team-columns",
  defaultColumnState(MEMBER_COLUMNS),
);
const memberColumns = computed<ColumnState>({
  get: () => reconcileColumnState(MEMBER_COLUMNS, storedMemberColumns.value),
  set: (value) => {
    storedMemberColumns.value = value;
  },
});

const storedInviteColumns = useLocalStorage<ColumnState>(
  "idenzy.members.invitation-columns",
  defaultColumnState(INVITE_COLUMNS),
);
const inviteColumns = computed<ColumnState>({
  get: () => reconcileColumnState(INVITE_COLUMNS, storedInviteColumns.value),
  set: (value) => {
    storedInviteColumns.value = value;
  },
});

/*
 * What each role may do. Reference content, so it is a table.
 */

const MATRIX_COLUMNS: readonly DataTableColumn<CapabilityInfo>[] = [
  { key: "label", title: "What", fixed: true, minWidth: 260 },
  ...MEMBER_ROLES.map((role) => ({
    key: role,
    title: roleInfo(role).label,
    width: 120,
    align: "end" as const,
    sortable: false,
    value: (row: CapabilityInfo) => (row.roles.includes(role) ? 1 : 0),
  })),
];

const storedColumns = useLocalStorage<ColumnState>(
  "idenzy.members.matrix-columns",
  defaultColumnState(MATRIX_COLUMNS),
);
const matrixColumns = computed<ColumnState>({
  get: () => reconcileColumnState(MATRIX_COLUMNS, storedColumns.value),
  set: (value) => {
    storedColumns.value = value;
  },
});
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="Members">
      <template #badge>
        <StatusBadge :detail="ORG_KIND_LABELS[kind]" :label="org.name" tone="neutral" />
      </template>
      <template #description>
        Who can reach <span class="font-medium text-ink">{{ org.name }}</span> and what each of
        them may do. A member reaches every project under it, never one of them.
      </template>
      <template #actions>
        <FancyButton :disabled="!canManage" @click="inviteOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:person-add-outline" />
          Invite
        </FancyButton>
      </template>
    </PageHeader>

    <FactGrid :columns="4" :facts="facts" label="Team facts" />

    <!-- The same object as the users list: a heading that states what is in the list, then
         one card holding the toolbar and the table. -->
    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-col gap-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">The team</h2>
        <p class="m-0 text-xs text-ink/55">
          <template v-if="view === 'members'">
            A role is changed on the row and takes effect on their next request.
          </template>
          <template v-else>
            A link that stands for {{ INVITE_TTL_DAYS }} days. Nothing about the organisation
            changes until somebody accepts one.
          </template>
        </p>
      </header>

      <v-card border flat>
        <div
          class="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <SegmentedControl v-model="tab" :options="tabs" label="Team list" />

          <div class="flex flex-wrap items-center gap-2">
            <v-text-field
              v-model="query"
              :placeholder="view === 'members' ? 'Search name or email' : 'Search address'"
              aria-label="Search the team"
              class="members__search w-full sm:w-64"
              clearable
              density="comfortable"
              hide-details
              prepend-inner-icon="material-symbols:search"
              variant="outlined"
            />
            <DataTableColumnsMenu
              v-if="view === 'members'"
              v-model="memberColumns"
              :columns="MEMBER_COLUMNS"
            />
            <DataTableColumnsMenu v-else v-model="inviteColumns" :columns="INVITE_COLUMNS" />
          </div>
        </div>

        <DataTable
          v-if="view === 'members'"
          v-model:column-state="memberColumns"
          :columns="MEMBER_COLUMNS"
          :items="matchedMembers"
          :loading="store.loading"
          :paged="false"
          empty-description="No name or address on this team matches what you typed."
          empty-title="Nobody matches."
          label="Members"
        >
          <template #cell.member="{ item }">
            <span class="flex min-w-0 items-center gap-3">
              <span
                :class="
                  item.role === 'owner'
                    ? 'border-primary/40 bg-primary/8 text-primary'
                    : 'border-line bg-ink/4 text-ink/70'
                "
                aria-hidden="true"
                class="flex size-7 flex-none items-center justify-center rounded-full border text-[10px] font-medium"
              >
                {{ initials(item.name) }}
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate font-medium text-ink">{{ item.name }}</span>
                  <span
                    v-if="item.id === store.currentId"
                    class="flex-none rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
                  >
                    You
                  </span>
                </span>
                <span class="truncate font-mono text-[11px] text-ink/55">{{ item.email }}</span>
              </span>
            </span>
          </template>

          <template #cell.role="{ item }">
            <!-- The owner's role is not a select at all. A control that opened and then
                 refused would be a control that looked like a choice. -->
            <v-tooltip
              v-if="item.role === 'owner'"
              :text="REFUSAL_LABELS.owner_is_fixed"
              location="top"
              max-width="300"
            >
              <template #activator="{ props: tip }">
                <span
                  v-bind="tip"
                  class="inline-flex items-center gap-1.5 rounded-(--idenzy-radius-x-small) border border-line px-2 py-1 text-xs text-ink/70"
                >
                  <Icon :name="roleInfo('owner').icon" aria-hidden="true" class="flex-none text-sm" />
                  Owner
                </span>
              </template>
            </v-tooltip>

            <v-menu v-else-if="canManage" :offset="4" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  :loading="isBusy(item.id)"
                  append-icon="material-symbols:unfold-more"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="outlined"
                >
                  {{ roleInfo(item.role).label }}
                </v-btn>
              </template>
              <v-list density="compact" min-width="300" nav>
                <v-list-item
                  v-for="option in ASSIGNABLE_ROLES"
                  :key="option"
                  :active="item.role === option"
                  :prepend-icon="roleInfo(option).icon"
                  :subtitle="roleInfo(option).note"
                  :title="roleInfo(option).label"
                  @click="setRole(item, option)"
                />
              </v-list>
            </v-menu>

            <span v-else class="text-xs text-ink/55">{{ roleInfo(item.role).label }}</span>
          </template>

          <template #cell.mfa="{ item }">
            <StatusBadge
              v-if="item.mfaEnrolled"
              label="Enrolled"
              tone="success"
            />
            <StatusBadge
              v-else
              :tone="mfaRequired ? 'warning' : 'neutral'"
              label="None"
            />
          </template>

          <template #cell.lastActiveAt="{ item }">
            <span v-if="item.lastActiveAt" class="text-ink/70">{{ ago(item.lastActiveAt) }}</span>
            <span v-else class="text-ink/45">Never signed in</span>
          </template>

          <template #cell.joinedAt="{ item }">
            <span class="text-ink/70">{{ formatDate(item.joinedAt) }}</span>
          </template>

          <template #actions="{ item }">
            <v-menu
              v-if="canManage || item.id === store.currentId"
              :offset="4"
              location="bottom end"
            >
              <template #activator="{ props: activator }">
                <button
                  v-bind="activator"
                  :aria-label="`Actions for ${item.name}`"
                  class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                >
                  <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
                </button>
              </template>
              <v-list density="compact" min-width="260" nav>
                <v-list-item
                  v-if="me?.role === 'owner' && item.role !== 'owner'"
                  prepend-icon="material-symbols:workspace-premium-outline"
                  title="Make them the owner"
                  @click="transferOpen = true"
                />
                <v-list-item
                  v-if="refusal('remove', item) === ''"
                  :prepend-icon="
                    item.id === store.currentId
                      ? 'material-symbols:logout'
                      : 'material-symbols:person-remove-outline'
                  "
                  :title="item.id === store.currentId ? 'Leave the organisation' : 'Remove from team'"
                  class="members__danger"
                  @click="askRemoval(item)"
                />
                <v-list-item
                  v-else
                  :subtitle="refusal('remove', item)"
                  disabled
                  prepend-icon="material-symbols:lock-outline"
                  title="Cannot be removed"
                />
              </v-list>
            </v-menu>
          </template>
        </DataTable>

        <DataTable
          v-else
          v-model:column-state="inviteColumns"
          :columns="INVITE_COLUMNS"
          :items="matchedInvitations"
          :loading="store.loading"
          :paged="false"
          empty-description="An invitation is a link that stands for a week. Nothing about the organisation changes until somebody accepts one, and revoking it takes the link out of use."
          empty-title="Nobody is waiting."
          label="Pending invitations"
        >
          <template #cell.email="{ item }">
            <span class="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                class="flex size-7 flex-none items-center justify-center rounded-full border border-line bg-ink/4 text-ink/55"
              >
                <Icon class="text-sm" name="material-symbols:mail-outline" />
              </span>
              <span class="truncate font-mono text-ink">{{ item.email }}</span>
            </span>
          </template>

          <template #cell.invitedAt="{ item }">
            <span class="text-ink/70">{{ formatDate(item.invitedAt) }}</span>
          </template>

          <template #cell.expiresAt="{ item }">
            <StatusBadge
              v-if="isInviteExpired(item, now)"
              label="Expired"
              tone="warning"
            />
            <span v-else class="text-ink/70">{{ formatDate(item.expiresAt) }}</span>
          </template>

          <template #actions="{ item }">
            <span v-if="canManage" class="flex items-center justify-end gap-1">
              <v-btn
                :loading="isBusy(item.id)"
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="resend(item.id)"
              >
                Resend
              </v-btn>
              <v-btn
                :loading="isBusy(item.id)"
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="revoke(item.id)"
              >
                Revoke
              </v-btn>
            </span>
          </template>
        </DataTable>
      </v-card>
    </section>

    <!-- The one setting left on the screen, and it is a setting rather than a fact because
         it is the only thing here the reader decides about everybody at once. -->
    <PageSection
      description="What the dashboard demands of everybody on this team, whatever their role."
      title="Team sign-in policy"
    >
      <SettingRow
        :description="
          MFA_ENFORCED
            ? 'A dashboard account holds the keys to every project underneath it.'
            : 'Recorded, not enforced: there is no enrolment step inside this dashboard\'s own sign-in yet, so a member without a factor still gets in.'
        "
        label="Require a second factor"
      >
        <template #actions>
          <StatusBadge
            v-if="mfaRequired"
            :detail="MFA_ENFORCED ? '' : 'recorded'"
            label="Required"
            tone="warning"
          />
          <StatusBadge v-else label="Off" tone="neutral" />
          <v-btn
            :disabled="!canManage"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="outlined"
            @click="mfaOpen = true"
          >
            Review change
          </v-btn>
        </template>
        <template v-if="withoutMfa.length > 0" #detail>
          <p class="m-0 text-xs leading-5 text-ink/55">
            {{ withoutMfa.map((member) => member.name).join(", ") }}
            {{ withoutMfa.length === 1 ? "holds" : "hold" }} no second factor. Their own factors
            are on their account screen and nobody else can enrol one for them.
          </p>
        </template>
      </SettingRow>
    </PageSection>

    <PageSection
      v-model:open="expanded.roles"
      description="Every role, and the one row where the dashboard's boundary stops being a security boundary."
      foldable
      :summary="`${MEMBER_ROLES.length} roles · ${CAPABILITIES.length} capabilities`"
      title="What each role may do"
    >
      <v-card border flat>
        <DataTable
          v-model:column-state="matrixColumns"
          :columns="MATRIX_COLUMNS"
          :items="CAPABILITIES"
          :paged="false"
          item-value="id"
          label="What each role may do"
        >
          <template #cell.label="{ item }">
            <v-tooltip :text="item.note" location="top" max-width="340">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="block truncate text-ink">{{ item.label }}</span>
              </template>
            </v-tooltip>
          </template>

          <template v-for="role in MEMBER_ROLES" :key="role" #[`cell.${role}`]="{ item }">
            <span class="flex justify-end">
              <Icon
                v-if="item.roles.includes(role)"
                :aria-label="`${roleInfo(role).label} can`"
                class="text-base text-success"
                name="material-symbols:check-circle-outline"
              />
              <span v-else :aria-label="`${roleInfo(role).label} cannot`" class="text-ink/25">–</span>
            </span>
          </template>
        </DataTable>

        <!-- The one uncomfortable line, kept with the table it qualifies. A matrix that
             implied the roles were a security boundary would be worse than none. -->
        <p class="m-0 border-t border-line px-4 py-3 text-xs leading-5 text-ink/60">
          A role is a boundary in this dashboard. Anybody who can create an API key has
          whatever the management API allows, whatever their role says afterwards, so the key
          row above is where that boundary actually sits.
        </p>
      </v-card>
    </PageSection>

    <SaveStatus :last-saved="lastSaved" :saving="saving" />

    <MemberInviteDialog
      v-if="inviteOpen"
      v-model="inviteOpen"
      :busy="isBusy('invite')"
      :invitations="invitations"
      :members="members"
      @confirm="confirmInvite"
    />

    <MemberRemoveDialog
      v-if="removeOpen"
      v-model="removeOpen"
      :busy="acting !== null && isBusy(acting.id)"
      :member="acting"
      :self="acting?.id === store.currentId"
      @confirm="confirmRemoval"
    />

    <MemberTransferDialog
      v-if="transferOpen"
      v-model="transferOpen"
      :busy="isBusy('transfer')"
      :candidates="candidates"
      :owner="owner"
      @confirm="confirmTransfer"
    />

    <MemberMfaDialog
      v-if="mfaOpen"
      v-model="mfaOpen"
      :busy="isBusy('mfa')"
      :enforced="MFA_ENFORCED"
      :required="mfaRequired"
      :total="members.length"
      :without-mfa="withoutMfa"
      @confirm="confirmMfa"
    />
  </div>
</template>

<style scoped>
/* A search box at the height of the buttons beside it, in the toolbar's small type and on
   the small radius, so the controls in the row read as one set. The same rule the users
   list carries, because it is the same toolbar. */
.members__search :deep(.v-field) {
  border-radius: var(--idenzy-radius-small);
  font-size: 0.75rem;
}

.members__search :deep(.v-field__input),
.members__search :deep(.v-field__input::placeholder) {
  font-size: 0.75rem;
}

.members__search :deep(.v-field__prepend-inner > .v-icon),
.members__search :deep(.v-field__clearable > .v-icon) {
  font-size: 1rem;
}

/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.members__danger,
.v-list--nav .v-list-item.members__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
