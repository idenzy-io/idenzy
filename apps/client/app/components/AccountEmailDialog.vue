<script setup lang="ts">
/**
 * Changes the address the account signs in with.
 *
 * Nothing here writes the address. The call starts a change: both the old address and the
 * new one have to confirm, and until they both have, the account keeps the address it has.
 * The dialog says so before the field rather than after the submit, because a confirmation
 * screen that arrives as a surprise reads as a failure.
 *
 * The old address confirming is the half people ask about. Confirming only the new one would
 * let anybody who reaches an unlocked screen move the account to an address they own, and
 * the person it belonged to would find out when they could not sign in. The old address is
 * the only party still able to stop that.
 */
import { EMAIL_CHANGE } from "~/utils/account";

const props = defineProps<{
  current: string;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [email: string];
}>();

const text = ref("");
const touched = ref(false);
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (showing) => {
  if (showing) {
    text.value = "";
    touched.value = false;
  }
});

/* Shape only. Whether an address exists and whether it is already taken are the server's
   answers, and it does not tell us the second one for the reason enumeration never is. */
const looksLikeEmail = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.value.trim()));
const sameAsCurrent = computed(
  () => text.value.trim().toLowerCase() === props.current.toLowerCase(),
);

const message = computed(() => {
  if (!touched.value || text.value.trim() === "") return "";
  if (sameAsCurrent.value) return "That is the address you already use.";
  return looksLikeEmail.value ? "" : "A full address, with an @ and a domain.";
});

const ready = computed(() => looksLikeEmail.value && !sameAsCurrent.value);

function confirm() {
  touched.value = true;
  if (!ready.value) return;
  emit("confirm", text.value.trim());
}

/* Closes on the write landing rather than on the click. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);

const id = useId();
</script>

<template>
  <v-dialog v-model="open" max-width="480" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Change your address</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            You sign in with <span class="font-medium text-ink">{{ current }}</span> today.
            Nothing changes until both addresses have confirmed.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label :for="id" class="text-xs font-medium text-ink">New address</label>
          <v-text-field
            :id="id"
            ref="field"
            v-model="text"
            :error="message !== ''"
            autocapitalize="off"
            autocomplete="email"
            density="compact"
            hide-details
            inputmode="email"
            spellcheck="false"
            variant="outlined"
            @blur="touched = true"
          />
          <p v-if="message" class="m-0 text-[11px] leading-4 text-error">{{ message }}</p>
        </div>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:mark-email-unread-outline"
            />
            <span>
              Both addresses get a link. The new one proves you can read it; the old one is
              what can still stop the change.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:shield-lock-outline"
            />
            <span>{{ EMAIL_CHANGE.note }}</span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:history"
            />
            <span>Recorded in the audit log, against both addresses.</span>
          </li>
        </ul>

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
            Send both links
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
