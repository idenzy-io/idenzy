<script setup lang="ts">
/**
 * Confirms turning password sign-in off, which is the one switch on that screen somebody
 * can lose access to.
 *
 * The order is the decision's own: the project it applies to, how many accounts have no
 * other way in, what those accounts would have left, then the named action. The count is
 * the point. A project where every account also holds a passkey loses nothing by turning
 * passwords off; a project where a thousand accounts hold only a password is being asked
 * to lock a thousand people out, and the switch alone cannot tell the difference.
 *
 * Hashes are kept either way, so this is reversible: the acknowledgement is asked for
 * only where somebody would actually be locked out.
 */
const props = defineProps<{
  project: string;
  /** Accounts holding a password and nothing else. */
  passwordOnly: number;
  /** What the project still offers, already in the reader's words. */
  otherMethods: readonly string[];
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{ confirm: [] }>();

const acknowledged = ref(false);

watch(open, (value) => {
  if (value) acknowledged.value = false;
});

const strands = computed(() => props.passwordOnly > 0);
const ready = computed(() => !props.busy && (!strands.value || acknowledged.value));
const count = computed(() => props.passwordOnly.toLocaleString("en"));

function confirm() {
  if (!ready.value) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" max-width="520">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Disable password sign-in</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ project }}</span
            >. The endpoints answer as if the method did not exist; every stored hash is
            kept, so turning it back on restores what was there.
          </p>
        </header>

        <SamplePanel
          :meta="strands ? 'Locked out' : 'Nobody stranded'"
          note="Accounts holding a password and no other way to sign in."
          title="Who this affects"
        >
          <p class="m-0 flex items-baseline gap-2">
            <span
              class="font-mono text-2xl leading-none font-medium tracking-tight text-ink tabular-nums"
            >
              {{ count }}
            </span>
            <span class="text-xs text-ink/60">
              {{ passwordOnly === 1 ? "account" : "accounts" }}
            </span>
          </p>
          <p class="m-0 mt-2 text-[11px] leading-4 text-ink/60">
            <template v-if="otherMethods.length > 0">
              Everybody else can still use
              {{ otherMethods.join(", ") }}.
            </template>
            <template v-else>
              This project has no other sign-in method configured, so nobody would be able
              to sign in at all.
            </template>
          </p>
        </SamplePanel>

        <label v-if="strands" class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn v-model="acknowledged" class="-mt-1.5 -ml-1.5" color="error" density="compact" />
          <span class="pt-px">
            I understand {{ count }} {{ passwordOnly === 1 ? "person" : "people" }} will not be
            able to sign in until this is turned back on.
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
            Disable password sign-in
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
