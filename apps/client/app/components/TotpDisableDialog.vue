<script setup lang="ts">
/**
 * Confirms turning authenticator apps off, which is the one control on that screen that
 * changes how somebody else's account is defended.
 *
 * The order is the decision's own, and it is the note's: how many accounts hold an
 * authenticator, what a sign-in on one of them does afterwards, what is left protecting
 * it, then the named action. The count is the point. A project where nobody has enrolled
 * loses nothing; a project where six hundred accounts are asked for a code today is
 * being told to stop asking, and the switch alone cannot tell the difference.
 *
 * Nothing is deleted, so this is reversible: the secrets, the labels and the recovery
 * sheets stay, and turning it back on demands the same codes again. The acknowledgement
 * is asked for only where an account would actually stop being challenged.
 */
import type { AuthenticatorCoverage } from "~/utils/mfa";

const props = defineProps<{
  project: string;
  coverage: AuthenticatorCoverage;
  /** Passkey sign-in on this project, which is the one other way to prove two factors. */
  passkeys: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{ confirm: [] }>();

const titleId = `${useId()}-title`;

const acknowledged = ref(false);

watch(open, (value) => {
  if (value) acknowledged.value = false;
});

const affects = computed(() => props.coverage.enrolled > 0);
const ready = computed(() => !props.busy && (!affects.value || acknowledged.value));
const count = computed(() => props.coverage.enrolled.toLocaleString("en"));
const people = computed(() => (props.coverage.enrolled === 1 ? "account" : "accounts"));
</script>

<template>
  <!-- `aria-labelledby` on the dialog itself, not only a visible heading: the overlay
       carries role="dialog" and a title it is not connected to does not name it
       (notes/dialogs.md). -->
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="520">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="ready && emit('confirm')">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            Turn off authenticator apps
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ project }}</span
            >. Enrolment answers as if the method did not exist, and nothing already
            enrolled is deleted.
          </p>
        </header>

        <SamplePanel
          :meta="affects ? 'Stops being asked' : 'Nobody affected'"
          note="Accounts holding a confirmed authenticator, which are the accounts asked for a code today."
          title="Who this affects"
        >
          <p class="m-0 flex items-baseline gap-2">
            <span
              class="font-mono text-2xl leading-none font-medium tracking-tight text-ink tabular-nums"
            >
              {{ count }}
            </span>
            <span class="text-xs text-ink/60">{{ people }}</span>
          </p>
          <!-- The effect, then what is left: a reader deciding this needs both, and the
               second one is the half a warning normally leaves out. -->
          <p class="m-0 mt-2 text-[11px] leading-4 text-ink/60">
            <template v-if="affects">
              Each signs in with its first factor alone from the moment this is saved. The
              secrets, the labels and the recovery sheets are kept, so turning it back on
              asks for the same codes again.
            </template>
            <template v-else>
              No account holds one, so no sign-in changes. What stops is enrolment.
            </template>
          </p>
          <p class="m-0 mt-1.5 text-[11px] leading-4 text-ink/60">
            <template v-if="passkeys">
              Passkey sign-in stays on, and a passkey is two factors on its own, so an
              account holding one is still defended against a stolen password.
            </template>
            <template v-else>
              This project has no passkeys either, so nothing on it will demand a second
              factor: a password or a one-time code is the whole of a sign-in.
            </template>
          </p>
        </SamplePanel>

        <label v-if="affects" class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="error"
            density="compact"
          />
          <span class="pt-px">
            I understand {{ count }} {{ people }} will stop being asked for a code until this
            is turned back on.
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
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Turn off authenticator apps
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* The selection control is a grid item with a name of its own and grows in a flex row;
   `flex-none` on it and the size stated here are what keep the row one line high. */
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
