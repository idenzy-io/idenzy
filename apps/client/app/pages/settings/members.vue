<script setup lang="ts">
/**
 * Who is on the team, what each of them may do, and how somebody joins or leaves
 * (PROJECT.md 3.3, 4.13.7).
 *
 * The rules are the interesting part of this screen rather than the list. There is exactly
 * one owner and there always will be: ownership is not a role anybody can be assigned, it
 * moves by transfer, which promotes and demotes in one act. The owner cannot be removed.
 * Both are enforced in `~/utils/members` rather than by hiding a button, because a rule a
 * template merely hides is a rule an API call gets past, and both are refused with the
 * reason rather than silently.
 *
 * The capability matrix says one uncomfortable thing on purpose. Anybody who can mint an
 * API key has whatever the management API allows, so the line under that row is where the
 * dashboard's roles stop being a security boundary. A permission model that implied
 * otherwise would be worse than one that admits it.
 */
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
import { formatDate, relativeTimeWords } from "~/utils/time";

const projects = useProjectStore();
const store = useMembersStore();

const now = useNow({ interval: 60_000 });

const members = computed(() => store.forProject(projects.current.id));
const invitations = computed(() => store.invitationsFor(projects.current.id));
const me = computed(() => store.currentMember(projects.current.id));
const owner = computed(() => ownerOf(members.value));
const withoutMfa = computed(() => membersWithoutMfa(members.value));
const mfaRequired = computed(() => store.mfaRequired(projects.current.id));
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/** Whether the person reading this may change the team at all. */
const canManage = computed(() => (me.value === null ? false : canRole(me.value.role, "members")));

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
const acting = ref<Member | null>(null);

/** Why an action is refused, or empty when it is not. Shown rather than hidden. */
function refusal(action: "change_role" | "remove", member: Member): string {
  if (me.value === null) return "";
  const found = refusalFor(action, me.value, member);
  return found === null ? "" : REFUSAL_LABELS[found];
}

function setRole(member: Member, role: MemberRole) {
  if (refusal("change_role", member) !== "") return;
  void whileBusy(member.id, () => store.setRole(projects.current.id, member.id, role));
}

function askRemoval(member: Member) {
  acting.value = member;
  removeOpen.value = true;
}

async function confirmRemoval() {
  const target = acting.value;
  if (target === null) return;
  await whileBusy(target.id, () => store.remove(projects.current.id, target.id));
  removeOpen.value = false;
}

async function confirmTransfer(toId: string) {
  await whileBusy("transfer", () => store.transfer(projects.current.id, toId));
  transferOpen.value = false;
}

async function confirmInvite(draft: { email: string; role: MemberRole }) {
  await whileBusy("invite", () => store.invite(projects.current.id, draft.email, draft.role));
  inviteOpen.value = false;
}

function resend(id: string) {
  void whileBusy(id, () => store.resend(projects.current.id, id));
}

function revoke(id: string) {
  void whileBusy(id, () => store.revoke(projects.current.id, id));
}

function setMfaRequired(required: boolean) {
  void whileBusy("mfa", () => store.setMfaRequired(projects.current.id, required));
}

const candidates = computed(() => members.value.filter((member) => member.role !== "owner"));

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
    <PageHeader icon="material-symbols:group-outline" title="Members">
      <template #description>
        Who can reach
        <span class="font-medium text-ink">{{ projects.current.name }}</span> and what each
        of them may do. Seats are free: there is no per-seat price and there is not going to
        be one.
      </template>
      <template #actions>
        <FancyButton :disabled="!canManage" @click="inviteOpen = true">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:person-add-outline" />
          Invite
        </FancyButton>
      </template>
    </PageHeader>

    <LayerCard
      :padded="false"
      description="A role is changed on the row and takes effect on their next request."
      title="The team"
    >
      <template #badge>
        <StatusBadge
          :label="`${members.length} ${members.length === 1 ? 'member' : 'members'}`"
          tone="neutral"
        />
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
                : 'border-line bg-canvas text-ink/70'
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
                :tone="mfaRequired ? 'error' : 'warning'"
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

            <v-menu v-if="canManage || member.id === store.currentId" :offset="4" location="bottom end">
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
                  :title="member.id === store.currentId ? 'Leave the project' : 'Remove from team'"
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
      v-if="invitations.length > 0"
      :padded="false"
      :description="`A link that stands for ${INVITE_TTL_DAYS} days. Nothing about the project changes until somebody accepts one.`"
      title="Invitations"
    >
      <template #badge>
        <StatusBadge :label="`${invitations.length} waiting`" tone="neutral" />
      </template>

      <ul class="m-0 list-none divide-y divide-line p-0">
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
    </LayerCard>

    <LayerCard
      description="What the dashboard demands of everybody on this team, whatever their role."
      title="Getting in"
    >
      <div class="divide-y divide-line">
        <SettingRow
          control-id="require-mfa"
          description="A dashboard account holds the keys to everybody else's. Turning this on does not lock anybody out: somebody without a factor is asked to enrol before they can do anything, on their next sign-in."
          label="Require a second factor"
        >
          <v-switch
            id="require-mfa"
            :disabled="!canManage || isBusy('mfa')"
            :loading="isBusy('mfa')"
            :model-value="mfaRequired"
            color="primary"
            density="compact"
            hide-details
            inset
            @update:model-value="setMfaRequired($event === true)"
          />
        </SettingRow>

        <SettingRow
          v-if="withoutMfa.length > 0"
          :description="`${withoutMfa.map((member) => member.name).join(', ')} ${withoutMfa.length === 1 ? 'has' : 'have'} no second factor yet. ${mfaRequired ? 'They will be asked to enrol before they can do anything else.' : 'Nothing stops them signing in while the requirement is off.'}`"
          :fixed="`${withoutMfa.length} of ${members.length}`"
          label="Who has not enrolled"
        />

        <SettingRow
          description="Ownership is not a role anybody is given: it moves by transfer, which promotes one person and demotes the other in a single change. That is what keeps exactly one owner on the project at every moment, including the moment in the middle."
          fixed="By transfer"
          label="How ownership moves"
        />
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
      v-model="inviteOpen"
      :busy="isBusy('invite')"
      :invitations="invitations"
      :members="members"
      @confirm="confirmInvite"
    />
    <MemberRemoveDialog
      v-model="removeOpen"
      :busy="acting !== null && isBusy(acting.id)"
      :member="acting"
      :self="acting?.id === store.currentId"
      @confirm="confirmRemoval"
    />
    <MemberTransferDialog
      v-model="transferOpen"
      :busy="isBusy('transfer')"
      :candidates="candidates"
      :owner="owner"
      @confirm="confirmTransfer"
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
