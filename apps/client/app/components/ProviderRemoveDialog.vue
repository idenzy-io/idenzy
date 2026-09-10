<script setup lang="ts">
/**
 * Takes a provider off the project, which is a different thing from switching it off and
 * the dialog's job is to say which.
 *
 * What goes is the credentials. The identities stay, because a link between a user and a
 * provider account is part of that user rather than part of the configuration, and
 * deleting them would turn a reversible change into an unrecoverable one: set the same
 * provider up again and everybody who used it is recognised. What does not survive is the
 * ability to sign in with it, and for an account with no other method that is the whole
 * account, so the number is stated and acknowledged rather than mentioned.
 */
import type { ProviderInfo } from "~/utils/providers";

const props = defineProps<{
  info: ProviderInfo | null;
  /** Accounts whose only way in is this provider. */
  stranded: number;
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

const ready = computed(() => props.stranded === 0 || acknowledged.value);
const count = computed(() => props.stranded.toLocaleString("en"));

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
    <v-card v-if="info" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex items-start gap-3">
          <span class="flex size-9 flex-none items-center justify-center text-ink">
            <Icon
              :class="[info.monochrome ? '[.v-theme--dark_&]:invert' : '', info.tint ?? '']"
              :name="info.icon"
              aria-hidden="true"
              class="text-[26px]"
            />
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="m-0 text-sm font-medium text-ink">Remove {{ info.label }}</h2>
            <p class="m-0 text-xs leading-5 text-ink/60">
              The client id and the secret come off this project. Nothing is deleted from the
              provider's side, and nothing is deleted here.
            </p>
          </div>
        </header>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-success"
              name="material-symbols:check-circle-outline"
            />
            <span>
              The accounts keep their {{ info.label }} link. Set the provider up again and
              everybody who used it is recognised as themselves.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-warning"
              name="material-symbols:link-off"
            />
            <span>
              Until then the endpoints answer as though {{ info.label }} were never
              configured, which is the same answer a provider nobody has set up gives.
            </span>
          </li>
        </ul>

        <p v-if="stranded > 0" class="m-0 text-xs leading-5 text-ink/80">
          <span class="font-mono tabular-nums">{{ count }}</span>
          {{ stranded === 1 ? "account signs in" : "accounts sign in" }} this way and no other.
          {{ stranded === 1 ? "It has" : "They have" }} nothing else to use until the provider
          is back or they set up another method, and neither is something they can do from a
          sign-in screen they cannot get past.
        </p>

        <label
          v-if="stranded > 0"
          class="flex cursor-pointer items-start gap-2 text-xs text-ink"
        >
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="error"
            density="compact"
          />
          <span class="pt-px">
            I understand {{ count }} {{ stranded === 1 ? "person" : "people" }} cannot sign in
            until this is settled.
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
            Keep {{ info.label }}
          </v-btn>
          <v-btn
            :color="stranded > 0 ? 'error' : 'primary'"
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            size="small"
            type="submit"
            variant="flat"
          >
            Remove {{ info.label }}
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
