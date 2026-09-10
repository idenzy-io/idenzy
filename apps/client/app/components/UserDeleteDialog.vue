<script setup lang="ts">
/**
 * Confirms an erasure, and says what one is. Deleting a user here is the erasure of
 * PROJECT.md 4.13.6: the personal columns are cleared, every session is revoked, and
 * the row survives as a tombstone that carries the id and nothing else, so audit
 * entries keep their pseudonymous subject. That is the reconciliation of the right to
 * erasure with the duty to keep records, and an operator should read it before they
 * click, which is why it is written here and not in a tooltip.
 *
 * The acknowledgement is a checkbox rather than a typed phrase: the action is one click
 * to reach and one to confirm, and typing the email of somebody you are erasing is
 * theatre that does not make anyone read the sentence above it.
 */
import { nameOf, type ProjectUser } from "~/utils/users";

const props = defineProps<{
  users: readonly ProjectUser[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const acknowledged = ref(false);

watch(open, (value) => {
  if (value) acknowledged.value = false;
});

const subject = computed(() => {
  const [first] = props.users;
  if (props.users.length === 1 && first) return nameOf(first);
  return `${props.users.length} users`;
});

const sessions = computed(() => props.users.reduce((sum, user) => sum + user.activeSessions, 0));

function confirm() {
  if (!acknowledged.value) return;
  emit("confirm");
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card border flat>
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Delete {{ subject }}</h2>
          <p class="m-0 text-xs text-ink/60">
            <template v-if="users.length === 1 && users[0]">
              <span class="font-mono text-[11px] text-ink/70">{{ users[0].id }}</span>
              ·
            </template>
            This is an erasure, and it cannot be undone.
          </p>
        </header>

        <UserTargetList v-if="users.length > 1" :users="users" />

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs text-ink/80">
          <li class="flex gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:person-off-outline" />
            <span>
              Name, email, phone, picture and metadata are erased. Linked sign-ins,
              passkeys and authenticators go with them.
            </span>
          </li>
          <li class="flex gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:logout" />
            <span>
              <template v-if="sessions > 0">
                <span class="font-mono tabular-nums">{{ sessions }}</span>
                open {{ sessions === 1 ? "session is" : "sessions are" }} revoked.
              </template>
              <template v-else>Any session is revoked.</template>
              A token already issued stops working at its next rotation.
            </span>
          </li>
          <li class="flex gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:fingerprint" />
            <span>
              The user ID survives as a tombstone, so the audit trail keeps a subject it
              can no longer name. That is what GDPR Art. 17(3)(b) asks for, and it is
              why the row stays listed as deleted.
            </span>
          </li>
        </ul>

        <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn v-model="acknowledged" class="-mt-1.5 -ml-1.5" color="error" density="compact" />
          <span class="pt-px">I understand this erases their personal data for good.</span>
        </label>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn
            :disabled="!acknowledged"
            class="text-xs font-medium"
            color="error"
            prepend-icon="material-symbols:delete-outline"
            size="small"
            variant="flat"
            @click="confirm"
          >
            Delete {{ users.length === 1 ? "user" : `${users.length} users` }}
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
