<script setup lang="ts">
/**
 * Who is on the organisation's team, what each of them may do, and how somebody joins or
 * leaves (PROJECT.md 3.3, 4.13.7, notes/settings-members.md).
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
 * The capability matrix says one uncomfortable thing on purpose. Anybody who can mint an
 * API key has whatever the management API allows, so the line under that row is where the
 * dashboard's roles stop being a security boundary. A permission model that implied
 * otherwise would be worse than one that admits it.
 */

import type { SegmentedOption } from "~/components/SegmentedControl.vue";
import type { ColumnState, DataTableColumn } from "~/utils/data-table";
import { defaultColumnState, reconcileColumnState } from "~/utils/data-table";
import {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  type CapabilityInfo,
  canRole,
  INVITE_TTL_DAYS,
  isInviteExpired,
  MEMBER_ROLES,
  type Member,
  type MemberRole,
  membersWithoutMfa,
  ownerOf,
  REFUSAL_LABELS,
  refusalFor,
  roleInfo,
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
  { value: "invitations", label: `Pending invitations ${invitations.value.length}` },
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
        Who can reach <span class="font-medium text-ink">{{ org.name }}</span> and what each
        of them may do. A member reaches
        {{ reach.length === 1 ? "its one project" : `all ${reach.length} of its projects` }},
        not one of them. Seats are free: there is no per-seat price and there is not going to
        be one.
      </template>
      <template #actions>
        <FancyButton :disabled="!canManage" @click="inviteOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:person-add-outline" />
          Invite
        </FancyButton>
      </template>
    </PageHeader>

    <SegmentedControl v-model="tab" :options="tabs" label="Team list" />

    <LayerCard
      v-if="view === 'members'"
      :padded="false"
      description="A role is changed on the row and takes effect on their next request."
      title="The team"
    >
      <template #badge>
        <StatusBadge :label="ORG_KIND_NOTES[kind].split('.')[0] ?? ''" tone="neutral" />
      </template>

      <div v-if="store.loading" class="divide-y divide-line">
        <div v-for="row in 3" :key="row" class="flex items-center gap-4 px-4 py-4">
          <span class="size-9 flex-none animate-pulse rounded-full bg-ink/8" />
          <span class="flex min-w-0 flex-1 flex-col gap-2">
            <span class="h-3 w-40 animate-pulse rounded-full bg-ink/8" />
            <span class="h-2.5 w-56 animate-pulse rounded-full bg-ink/6" />
          </span>
          <span class="h-7 w-28 flex-none animate-pulse rounded-full bg-ink/8" />
        </div>
      </div>

      <ul v-else class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="member in members"
          :key="member.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
        >
          <span
            :class="
              member.role === 'owner'
                ? 'border-primary/40 bg-primary/8 text-primary'
                : 'border-line bg-ink/4 text-ink/70'
            "
            aria-hidden="true"
            class="flex size-9 flex-none items-center justify-center rounded-full border text-[11px] font-medium"
          >
            {{ initials(member.name) }}
          </span>

          <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="truncate text-sm font-medium text-ink">{{ member.name }}</span>
              <span
                v-if="member.id === store.currentId"
                class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55"
              >
                You
              </span>
              <StatusBadge
                v-if="!member.mfaEnrolled"
                label="No second factor"
                :tone="mfaRequired ? 'warning' : 'neutral'"
              />
            </div>
            <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
              <span class="truncate font-mono">{{ member.email }}</span>
              <span class="flex items-center gap-1.5">
                <Icon
                  aria-hidden="true"
                  class="flex-none text-xs"
                  name="material-symbols:schedule-outline"
                />
                <template v-if="member.lastActiveAt">
                  Last here {{ ago(member.lastActiveAt) }}
                </template>
                <template v-else>Has never signed in</template>
              </span>
            </div>
          </div>

          <div class="ml-auto flex flex-none items-center gap-2">
            <!-- The owner's role is not a select at all. A control that opened and then
                 refused would be a control that looked like a choice. -->
            <v-tooltip
              v-if="member.role === 'owner'"
              location="top"
              max-width="300"
              :text="REFUSAL_LABELS.owner_is_fixed"
            >
              <template #activator="{ props: tip }">
                <span
                  v-bind="tip"
                  class="flex items-center gap-1.5 rounded-(--idenzy-radius-x-small) border border-line px-2 py-1 text-xs text-ink/70"
                >
                  <Icon
                    :name="roleInfo('owner').icon"
                    aria-hidden="true"
                    class="flex-none text-sm"
                  />
                  Owner
                </span>
              </template>
            </v-tooltip>

            <v-menu v-else-if="canManage" :offset="4" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  :loading="isBusy(member.id)"
                  append-icon="material-symbols:unfold-more"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="outlined"
                >
                  {{ roleInfo(member.role).label }}
                </v-btn>
              </template>
              <v-list density="compact" min-width="300" nav>
                <v-list-item
                  v-for="option in ASSIGNABLE_ROLES"
                  :key="option"
                  :active="member.role === option"
                  :prepend-icon="roleInfo(option).icon"
                  :subtitle="roleInfo(option).note"
                  :title="roleInfo(option).label"
                  @click="setRole(member, option)"
                />
              </v-list>
            </v-menu>

            <span v-else class="text-xs text-ink/55">{{ roleInfo(member.role).label }}</span>

            <v-menu
              v-if="canManage || member.id === store.currentId"
              :offset="4"
              location="bottom end"
            >
              <template #activator="{ props: activator }">
                <button
                  v-bind="activator"
                  :aria-label="`Actions for ${member.name}`"
                  class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                >
                  <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
                </button>
              </template>
              <v-list density="compact" min-width="260" nav>
                <v-list-item
                  v-if="me?.role === 'owner' && member.role !== 'owner'"
                  prepend-icon="material-symbols:workspace-premium-outline"
                  title="Make them the owner"
                  @click="transferOpen = true"
                />
                <v-list-item
                  v-if="refusal('remove', member) === ''"
                  class="members__danger"
                  :prepend-icon="
                    member.id === store.currentId
                      ? 'material-symbols:logout'
                      : 'material-symbols:person-remove-outline'
                  "
                  :title="
                    member.id === store.currentId ? 'Leave the organisation' : 'Remove from team'
                  "
                  @click="askRemoval(member)"
                />
                <v-list-item
                  v-else
                  :subtitle="refusal('remove', member)"
                  disabled
                  prepend-icon="material-symbols:lock-outline"
                  title="Cannot be removed"
                />
              </v-list>
            </v-menu>
          </div>
        </li>
      </ul>
    </LayerCard>

    <LayerCard
      v-else
      :padded="false"
      :description="`A link that stands for ${INVITE_TTL_DAYS} days. Nothing about the organisation changes until somebody accepts one.`"
      title="Pending invitations"
    >
      <ul v-if="invitations.length > 0" class="m-0 list-none divide-y divide-line p-0">
        <li
          v-for="invitation in invitations"
          :key="invitation.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5"
        >
          <span
            class="flex size-9 flex-none items-center justify-center rounded-full border border-dashed border-line text-ink/45"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:mail-outline" />
          </span>

          <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="truncate font-mono text-sm text-ink">{{ invitation.email }}</span>
              <StatusBadge
                v-if="isInviteExpired(invitation, now)"
                label="Expired"
                tone="warning"
              />
            </div>
            <span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
              <span>As {{ roleInfo(invitation.role).label.toLowerCase() }}</span>
              <span>Invited by {{ invitation.invitedBy }}</span>
              <span>
                <template v-if="isInviteExpired(invitation, now)">
                  Expired {{ ago(invitation.expiresAt) }}
                </template>
                <template v-else>Expires {{ formatDate(invitation.expiresAt) }}</template>
              </span>
            </span>
          </div>

          <div v-if="canManage" class="ml-auto flex flex-none items-center gap-2">
            <v-btn
              :loading="isBusy(invitation.id)"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="outlined"
              @click="resend(invitation.id)"
            >
              Resend
            </v-btn>
            <v-btn
              :loading="isBusy(invitation.id)"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="revoke(invitation.id)"
            >
              Revoke
            </v-btn>
          </div>
        </li>
      </ul>

      <EmptyState
        v-else
        description="An invitation is a link that stands for a week. Nothing about the organisation changes until somebody accepts one, and revoking it takes the link out of use."
        icon="material-symbols:mail-outline"
        title="Nobody is waiting"
      >
        <template #actions>
          <v-btn
            :disabled="!canManage"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="inviteOpen = true"
          >
            Invite somebody
          </v-btn>
        </template>
      </EmptyState>
    </LayerCard>

    <LayerCard
      description="What the dashboard demands of everybody on this team, whatever their role."
      title="Team sign-in policy"
    >
      <div class="divide-y divide-line">
        <SettingRow
          :description="
            mfaRequired
              ? 'Recorded for everybody on the team. Nothing enforces it yet, because the enrolment step inside sign-in is not built, so a member without a factor can still sign in.'
              : 'A dashboard account holds the keys to every project underneath it. Turning this on locks nobody out: it records the requirement and names who has not enrolled.'
          "
          label="Require a second factor"
        >
          <div class="flex items-center gap-2">
            <StatusBadge
              v-if="mfaRequired"
              :label="MFA_ENFORCED ? 'Enforced' : 'Recorded, not enforced'"
              :tone="MFA_ENFORCED ? 'success' : 'warning'"
            />
            <StatusBadge v-else label="Off" tone="neutral" />
            <v-btn
              :disabled="!canManage || isBusy('mfa')"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="outlined"
              @click="mfaOpen = true"
            >
              Review change
            </v-btn>
          </div>
        </SettingRow>

        <SettingRow
          v-if="withoutMfa.length > 0"
          :description="`${withoutMfa.map((member) => member.name).join(', ')} ${withoutMfa.length === 1 ? 'holds' : 'hold'} no second factor. Their own factors are on their account screen and nobody else can enrol one for them.`"
          :fixed="`${withoutMfa.length} of ${members.length}`"
          label="Who has not enrolled"
        />
      </div>
    </LayerCard>

    <!-- Ownership sits below the routine membership and apart from any role control: the
         note asks for it separately because it is the one change that cannot be undone by
         the person making it. -->
    <LayerCard
      description="One owner, always. It moves by transfer rather than by being assigned, which is what keeps exactly one at every moment including the moment in the middle."
      title="Ownership"
    >
      <div class="divide-y divide-line">
        <SettingRow
          v-if="owner"
          :description="`The only seat that can hand the organisation on or delete a project, and it cannot be removed or demoted. ${me?.role === 'owner' ? 'That is you.' : `Ask ${owner.name} if you need something only an owner can do.`}`"
          :fixed="me?.role === 'owner' ? 'You' : owner.name"
          label="Current owner"
        >
          <template #actions>
            <v-btn
              :disabled="me?.role !== 'owner' || candidates.length === 0"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="outlined"
              @click="transferOpen = true"
            >
              Transfer ownership
            </v-btn>
          </template>
        </SettingRow>
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="expanded.roles"
      :padded="false"
      description="Every role, and the one row where the dashboard's boundary stops being a security boundary."
      expandable
      title="What each role may do"
    >
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

      <p class="m-0 border-t border-line px-4 py-3 text-[11px] leading-4 text-ink/55">
        A role is a boundary in this dashboard. Anybody who can create an API key has
        whatever the management API allows, whatever their role says afterwards, so the key
        row above is where that boundary actually sits. Say it that way when somebody asks
        whether a developer can be stopped from deleting a user.
      </p>
    </LayerCard>

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
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.members__danger,
.v-list--nav .v-list-item.members__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
