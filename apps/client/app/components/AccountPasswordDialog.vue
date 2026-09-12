<script setup lang="ts">
/**
 * Changes the signed-in person's own password.
 *
 * The current password is asked for even though this can only be reached from inside a
 * session, and the sentence under the field says why: a session proves somebody signed in
 * once, not that the person at the keyboard now is the same one. An unlocked laptop is the
 * whole threat, and it is the ordinary case rather than the exotic one.
 *
 * Signing the other sessions out is offered and defaults on, but it is a checkbox rather
 * than an inevitability. If the reason for the change is that somebody may know the old
 * password, it is the half that matters; if it is a routine rotation, forcing it would put
 * somebody through signing back in on three devices for nothing.
 *
 * The strength meter is the one from the sign-up screen, unchanged. The panel's own account
 * is held to the project's password policy because the panel is a customer of the product,
 * and a second meter here with second opinions would be the first crack in that.
 */
import { PASSWORD_CHANGE } from "~/utils/account";
import { PASSWORD_MIN_LENGTH } from "~/utils/password-strength";

const props = defineProps<{
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [signOutOthers: boolean];
}>();

const current = ref("");
const next = ref("");
const revealed = ref(false);
const signOutOthers = ref(PASSWORD_CHANGE.signOutOthersDefault);
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (showing) => {
  if (showing) {
    current.value = "";
    next.value = "";
    revealed.value = false;
    signOutOthers.value = PASSWORD_CHANGE.signOutOthersDefault;
  }
});

/* Enough to stop a submit that cannot succeed. Whether the current password is right is the
   server's answer and the only one that knows. */
const ready = computed(
  () =>
    current.value.length > 0 &&
    next.value.length >= PASSWORD_MIN_LENGTH &&
    next.value !== current.value,
);

const sameAsCurrent = computed(() => next.value.length > 0 && next.value === current.value);

function confirm() {
  if (!ready.value) return;
  emit("confirm", signOutOthers.value);
}

/* Closes on the write landing rather than on the click. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);

const currentId = useId();
const nextId = useId();
</script>

<template>
  <v-dialog v-model="open" max-width="480" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Change your password</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">{{ PASSWORD_CHANGE.note }}</p>
        </header>

        <div class="flex flex-col gap-1">
          <label :for="currentId" class="text-xs font-medium text-ink">Current password</label>
          <v-text-field
            :id="currentId"
            ref="field"
            v-model="current"
            autocomplete="current-password"
            hide-details
            type="password"
            variant="outlined"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label :for="nextId" class="text-xs font-medium text-ink">New password</label>
          <v-text-field
            :id="nextId"
            v-model="next"
            :append-inner-icon="
              revealed ? 'material-symbols:visibility-off-outline' : 'material-symbols:visibility-outline'
            "
            :error="sameAsCurrent"
            :type="revealed ? 'text' : 'password'"
            autocomplete="new-password"
            hide-details
            variant="outlined"
            @click:append-inner="revealed = !revealed"
          />
          <p v-if="sameAsCurrent" class="m-0 text-[11px] leading-4 text-error">
            That is the password you already have.
          </p>
          <PasswordStrengthMeter :password="next" />
        </div>

        <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn
            v-model="signOutOthers"
            class="-mt-1.5 -ml-1.5"
            color="primary"
            density="compact"
          />
          <span class="flex flex-col gap-0.5 pt-px">
            <span>Sign my other sessions out</span>
            <span class="text-[11px] leading-4 text-ink/55">{{ PASSWORD_CHANGE.signOutNote }}</span>
          </span>
        </label>

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
            Change password
          </v-btn>
        </footer>
      </form>
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
