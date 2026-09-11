<script setup lang="ts">
/**
 * Invites somebody. An address and a role, and the role is a decision the dialog makes
 * somebody look at rather than a default they scroll past: developer is preselected
 * because it is the honest common case, and each option says what it can reach.
 *
 * Ownership is not on the list. It moves by transfer, in one act, so there is never a
 * moment with two owners or none.
 */
import {
  ASSIGNABLE_ROLES,
  INVITE_ISSUE_LABELS,
  INVITE_TTL_DAYS,
  type Invitation,
  type Member,
  type MemberRole,
  roleInfo,
  validateInvite,
} from "~/utils/members";

const props = defineProps<{
  members: readonly Member[];
  invitations: readonly Invitation[];
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [draft: { email: string; role: MemberRole }];
}>();

const email = ref("");
const role = ref<MemberRole>("developer");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (!value) return;
  email.value = "";
  role.value = "developer";
});

const issue = computed(() => {
  if (email.value.trim() === "") return "";
  const found = validateInvite(email.value, props.members, props.invitations);
  return found === null ? "" : INVITE_ISSUE_LABELS[found];
});

const ready = computed(() => email.value.trim() !== "" && issue.value === "");

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", { email: email.value.trim().toLowerCase(), role: role.value });
}
</script>

<template>
  <v-dialog v-model="open" max-width="500" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Invite somebody</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            They get a link that stands for {{ INVITE_TTL_DAYS }} days. Nothing changes on
            the project until they accept it, and a seat costs nothing.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="invite-email">Email</label>
          <v-text-field
            id="invite-email"
            ref="field"
            v-model="email"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="colleague@example.com"
            type="email"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ issue || "Where the invitation goes. It is proof of the address as well as a way in." }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">What they may do</span>
          <div class="flex flex-col gap-2">
            <button
              v-for="option in ASSIGNABLE_ROLES"
              :key="option"
              :class="
                role === option
                  ? 'border-primary/50 bg-primary/8'
                  : 'border-line bg-ink/4 hover:border-ink/20'
              "
              class="flex cursor-pointer items-start gap-2.5 rounded-(--idenzy-radius-small) border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              type="button"
              @click="role = option"
            >
              <Icon
                :name="roleInfo(option).icon"
                aria-hidden="true"
                class="mt-0.5 flex-none text-base text-ink/70"
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-xs font-medium text-ink">{{ roleInfo(option).label }}</span>
                <span class="text-[11px] leading-4 text-ink/55">{{ roleInfo(option).note }}</span>
              </span>
            </button>
          </div>
        </div>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Send the invitation
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
