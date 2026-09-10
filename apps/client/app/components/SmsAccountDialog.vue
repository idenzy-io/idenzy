<script setup lang="ts">
/**
 * The credentials for a customer's own SMS vendor, written as one record.
 *
 * One dialog rather than two fields on a row, for the reason the social providers screen
 * uses one: a vendor half saved fails at the carrier on somebody's sign-in rather than
 * here, and by then the message has already cost the customer money.
 *
 * The key is checked on its shape before anything is sent. A Twilio SID that is not one
 * is a mistake we can see, and seeing it here is the difference between a corrected
 * paste and a support ticket about codes that never arrive.
 */
import {
  BYO_ISSUE_LABELS,
  BYO_VENDORS,
  type ByoAccount,
  type ByoDraft,
  type ByoVendor,
  byoVendorInfo,
  validateByo,
} from "~/utils/sms-providers";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  /** What is stored now, so the dialog knows whether a blank secret is allowed. */
  account: ByoAccount | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [draft: ByoDraft];
}>();

const now = useNow({ interval: 60_000 });

const vendor = ref<ByoVendor>("twilio");
const key = ref("");
const secret = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const keyField = useTemplateRef<{ focus: () => void }>("keyField");

watch(open, (value) => {
  if (!value) return;
  vendor.value = props.account?.vendor ?? "twilio";
  key.value = props.account?.key ?? "";
  secret.value = "";
});

const info = computed(() => byoVendorInfo(vendor.value));

/** A stored secret only counts while the vendor it was written for is still chosen. */
const hasSecret = computed(
  () => props.account !== null && props.account.vendor === vendor.value && props.account.secretSet,
);

const draft = computed<ByoDraft>(() => ({
  vendor: vendor.value,
  key: key.value,
  secret: secret.value,
}));

const issue = computed(() => {
  if (key.value.trim() === "" && secret.value.trim() === "") return "";
  const found = validateByo(draft.value, hasSecret.value);
  return found === null ? "" : BYO_ISSUE_LABELS[found];
});

const ready = computed(
  () => key.value.trim() !== "" && validateByo(draft.value, hasSecret.value) === null,
);

const secretAge = computed(() => {
  const at = props.account?.secretUpdatedAt ?? null;
  if (at === null || !hasSecret.value) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm", draft.value);
}
</script>

<template>
  <v-dialog v-model="open" max-width="480" @after-enter="keyField?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Send through your own account</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            We hand every message to your vendor instead of routing it ourselves. You are
            billed by them and by us for nothing, and our per-country routing stops
            applying: everything goes wherever your account sends it.
          </p>
        </header>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">Vendor</span>
          <SegmentedControl
            v-model="vendor"
            :options="BYO_VENDORS.map((entry) => ({ value: entry.id, label: entry.label }))"
            label="Vendor"
            stretch
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="byo-key">
            {{ info?.keyLabel }}
          </label>
          <!-- Named, and the secret below is a new-password field: a text input followed
               by a password input is a sign-in form as far as a browser is concerned, and
               it will offer the operator's own address and panel password for the pair. -->
          <v-text-field
            id="byo-key"
            ref="keyField"
            v-model="key"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="sms-vendor-key"
            :placeholder="vendor === 'twilio' ? 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' : 'a1b2c3d4'"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ issue || info?.keyHint }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="byo-secret">
            {{ info?.secretLabel }}
          </label>
          <v-text-field
            id="byo-secret"
            v-model="secret"
            autocomplete="new-password"
            class="font-mono"
            hide-details
            name="sms-vendor-secret"
            :placeholder="hasSecret ? 'Leave blank to keep the stored one' : ''"
            type="password"
            variant="filled"
          />
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            <template v-if="secretAge">
              Written {{ secretAge }}, and never read back. A blank field keeps it.
            </template>
            <template v-else>
              Stored envelope encrypted under this project's data key and never shown
              again, here or anywhere.
            </template>
          </p>
        </div>

        <p class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/55">
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
            name="material-symbols:info-outline"
          />
          <span>
            The fraud guard, the country allowlist and the daily spend cap still run. They
            are about what your project sends, not about who carries it.
          </span>
        </p>

        <footer class="flex items-center justify-between gap-2">
          <a
            v-if="info"
            :href="info.console.href"
            class="inline-flex items-center gap-1 text-[11px] text-ink/60 no-underline hover:text-ink"
            rel="noopener"
            target="_blank"
          >
            {{ info.console.label }}
            <Icon aria-hidden="true" class="text-xs" name="material-symbols:open-in-new" />
          </a>
          <span class="ml-auto flex items-center gap-2">
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
              {{ account ? "Save credentials" : "Use this account" }}
            </v-btn>
          </span>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
