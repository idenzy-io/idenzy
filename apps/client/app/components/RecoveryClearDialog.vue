<script setup lang="ts">
/**
 * Deletes an account's sheet, which is the one thing an operator can safely do to it.
 *
 * The dialog spends most of its room saying what this is not. It is not a regeneration:
 * the codes come back exactly once, so a new sheet made from here would either be shown
 * to staff, which is ten working credentials for somebody else's account, or be
 * generated and shown to nobody, which is the same as this and slower. And it is not
 * turning the second factor off: the authenticator stays and the account still signs in
 * with it. What goes is the way back if that authenticator is lost, which is why the
 * acknowledgement is worded as the owner's problem rather than the operator's.
 *
 * A sheet with nothing unspent left is the one case with nothing to acknowledge. The
 * account was already down to its second factor, so clearing tidies the spent rows away
 * and changes nothing, and asking somebody to tick a box about a loss that already
 * happened teaches them to tick boxes.
 */
import { nameOf, type ProjectUser } from "~/utils/users";

const props = defineProps<{
  user: ProjectUser | null;
  /** Codes the sheet still holds, which is what is being thrown away. */
  remaining: number;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const acknowledged = ref(false);

watch(open, (showing) => {
  if (showing) acknowledged.value = false;
});

const person = computed(() => (props.user ? nameOf(props.user) : ""));

/**
 * A sheet with nothing unspent on it is tidied rather than taken away, so there is
 * nothing to acknowledge: the account was already down to its second factor, which is
 * why it is on the list this dialog was opened from.
 */
const spent = computed(() => props.remaining === 0);
const ready = computed(() => spent.value || acknowledged.value);

function confirm() {
  if (!ready.value) return;
  emit("confirm");
}

/* Closes on the write landing rather than on the click. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card v-if="user" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Clear the recovery sheet</h2>
          <p v-if="spent" class="m-0 text-xs leading-5 text-ink/60">
            Deletes what is left of <span class="font-medium text-ink">{{ person }}</span
            >'s sheet. Every code on it has been spent already, so this takes away nothing
            they could still use.
          </p>
          <p v-else class="m-0 text-xs leading-5 text-ink/60">
            Deletes every code on <span class="font-medium text-ink">{{ person }}</span
            >'s sheet, the
            <span class="font-mono tabular-nums text-ink">{{ remaining }}</span>
            unspent {{ remaining === 1 ? "one" : "ones" }} included.
          </p>
        </header>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-success"
              name="material-symbols:check-circle-outline"
            />
            <span>
              The second factor stays. They keep signing in with their authenticator, and
              nothing about the account changes for them today.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              :class="spent ? 'text-ink/40' : 'text-warning'"
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm"
              name="material-symbols:key-off-outline"
            />
            <span v-if="spent">
              They already have nothing to fall back on, which is why the account is on this
              list. Clearing the spent codes does not change that either way.
            </span>
            <span v-else>
              Until they make a new sheet from your application, the only way past their
              second factor is that factor. Lose it, and the account needs you.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:history"
            />
            <span>Recorded in the audit log against your name, like every action here.</span>
          </li>
        </ul>

        <p class="m-0 rounded-(--idenzy-radius-small) border border-line bg-canvas px-3 py-2.5 text-[11px] leading-4 text-ink/60">
          There is no "generate a new sheet for them" here, and there will not be. Codes are
          shown once and stored as digests, so making a sheet from this screen would mean
          handing an operator ten working credentials for somebody else's account.
        </p>

        <label v-if="!spent" class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="error"
            density="compact"
          />
          <span class="pt-px">
            I understand {{ person }} loses their fallback until they make a new sheet.
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
            Keep the sheet
          </v-btn>
          <v-btn
            :color="spent ? 'primary' : 'error'"
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            size="small"
            type="submit"
            variant="flat"
          >
            Clear the sheet
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
