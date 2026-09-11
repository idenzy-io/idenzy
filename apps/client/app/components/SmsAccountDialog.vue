<script setup lang="ts">
/**
 * The credentials for a customer's own SMS vendor, checked before anything is switched.
 *
 * One dialog rather than two fields on a row, for the reason the social providers screen
 * uses one: a vendor half saved fails at the carrier on somebody's sign-in rather than
 * here, and by then the message has already cost the customer money.
 *
 * It is two acts and not one, which is the note's first finding about this screen. The
 * old dialog collected the pair and switched carriage in the same click, so a mistyped
 * token moved a project onto a vendor that would refuse every message and said nothing
 * about it. Now the footer's action is `Verify account` until the vendor has answered,
 * and only then does it become `Use this account`. Editing either credential afterwards
 * takes the answer away again, because a check is about the pair that was checked.
 *
 * The key is still refused on its shape before the vendor is asked at all. A Twilio SID
 * that is not one is a mistake we can see, and seeing it here is the difference between
 * a corrected paste and a support ticket about codes that never arrive.
 *
 * A refused check keeps everything typed but the secret. The secret is the half that is
 * usually wrong and the half nobody can read back, so clearing it is the recovery path
 * rather than leaving a field that looks filled and is not.
 */
import type { AccountCheck } from "~/stores/sms-providers";
import {
  BYO_ISSUE_LABELS,
  BYO_VENDORS,
  type ByoAccount,
  type ByoDraft,
  type ByoVendor,
  byoVendorInfo,
  SENDER_NOTES,
  validateByo,
} from "~/utils/sms-providers";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  /** What is stored now, so the dialog knows whether a blank secret is allowed. */
  account: ByoAccount | null;
  /** What the vendor last answered, or null while nothing has been asked. */
  check: AccountCheck | null;
  /** The check is in flight. */
  checking: boolean;
  /** The activation is in flight. */
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  verify: [draft: ByoDraft];
  confirm: [draft: ByoDraft];
}>();

const now = useNow({ interval: 60_000 });

const vendor = ref<ByoVendor>("twilio");
const key = ref("");
const secret = ref("");
const titleId = `${useId()}-title`;

/**
 * Whether the answer on screen is about what is on screen.
 *
 * A check is about a credential pair, so touching either half makes it stale and the
 * footer goes back to `Verify account`. Without that the dialog would offer `Use this
 * account` over a verification of a set that is no longer in the fields, which is the
 * failure the two-stage footer exists to stop.
 */
const stale = ref(true);
const asked = ref(false);

/* The one edit that is ours rather than the reader's: clearing the secret after a
   refusal must not read as them changing their mind about it. */
const clearing = ref(false);

watch([vendor, key, secret], () => {
  if (clearing.value) {
    clearing.value = false;
    return;
  }
  stale.value = true;
});

/** The answer, while it is still about what is in the fields. */
const answer = computed(() => (asked.value && !stale.value ? props.check : null));

const verified = computed(() => answer.value?.ok === true);

/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const keyField = useTemplateRef<{ focus: () => void }>("keyField");

watch(open, (value) => {
  if (!value) return;
  vendor.value = props.account?.vendor ?? "twilio";
  key.value = props.account?.key ?? "";
  secret.value = "";
  /* A check from a previous visit is not an answer about this one. */
  asked.value = false;
  stale.value = true;
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

const fillable = computed(
  () => key.value.trim() !== "" && validateByo(draft.value, hasSecret.value) === null,
);

const secretAge = computed(() => {
  const at = props.account?.secretUpdatedAt ?? null;
  if (at === null || !hasSecret.value) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

function verify() {
  if (!fillable.value || props.checking) return;
  asked.value = true;
  stale.value = false;
  emit("verify", draft.value);
}

function confirm() {
  if (!verified.value || props.busy) return;
  emit("confirm", draft.value);
}

function submit() {
  if (verified.value) confirm();
  else verify();
}

/* A refused check keeps the vendor and the key and clears the secret, which is the half
   that is usually wrong and the half nobody can read back. The clear is ours, so it does
   not make the answer stale and take the refusal off the screen with it. */
watch(
  () => props.check,
  (value) => {
    if (value !== null && !value.ok && secret.value !== "") {
      clearing.value = true;
      secret.value = "";
    }
  },
);
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    max-width="520"
    scrollable
    @after-enter="keyField?.focus()"
  >
    <v-card border flat>
      <form class="flex max-h-[86vh] flex-col" @submit.prevent="submit">
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <header class="flex flex-col gap-1">
            <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
              Send through your own account
            </h2>
            <p class="m-0 text-xs leading-5 text-ink/60">
              We hand every message to your vendor instead of routing it ourselves. Nothing
              switches until the vendor has answered for these credentials.
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
              :placeholder="
                vendor === 'twilio' ? 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' : 'a1b2c3d4'
              "
              autocomplete="off"
              class="font-mono"
              hide-details
              name="sms-vendor-key"
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
              :placeholder="hasSecret ? 'Leave blank to keep the stored one' : ''"
              autocomplete="new-password"
              class="font-mono"
              hide-details
              name="sms-vendor-secret"
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

          <!-- What the account has to be able to do, which is the vendor's business and
               not ours. Said before the check rather than after a refusal. -->
          <div class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">What the account needs</h3>
            <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-[11px] leading-4 text-ink/55">
              <li class="flex items-start gap-2">
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm text-ink/40"
                  name="material-symbols:sms-outline"
                />
                <span>
                  A sender your account may use in every country you send to.
                  {{ SENDER_NOTES.alphanumeric }}
                </span>
              </li>
              <li class="flex items-start gap-2">
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm text-ink/40"
                  name="material-symbols:approval-outline"
                />
                <span>
                  Any registration that country demands, filed on your account rather than
                  ours: 10DLC in the United States, DLT in India, IYS in Turkey.
                </span>
              </li>
              <li class="flex items-start gap-2">
                <Icon
                  aria-hidden="true"
                  class="mt-px flex-none text-sm text-ink/40"
                  name="material-symbols:payments-outline"
                />
                <span>
                  Funds with the vendor. They bill you directly for every message and we
                  charge nothing for carriage, so our own price list stops applying.
                </span>
              </li>
            </ul>
          </div>

          <!-- The answer, and it is the vendor's rather than ours. -->
          <div
            v-if="answer"
            :class="answer.ok ? 'text-success' : 'text-warning'"
            class="flex items-start gap-2.5 rounded-(--idenzy-radius-small) bg-ink/4 p-3.5 ring-1 ring-ink/6 ring-inset"
            role="status"
          >
            <Icon
              :name="
                answer.ok
                  ? 'material-symbols:check-circle-outline'
                  : 'material-symbols:error-outline'
              "
              aria-hidden="true"
              class="mt-px flex-none text-base"
            />
            <div class="flex min-w-0 flex-col gap-0.5">
              <p class="m-0 text-xs font-medium">
                {{ answer.ok ? "Credentials accepted" : "Credentials refused" }}
              </p>
              <p class="m-0 text-[11px] leading-4 text-ink/60">{{ answer.finding }}</p>
              <p v-if="!answer.ok" class="m-0 text-[11px] leading-4 text-ink/60">
                Nothing was switched. The vendor and the key are as you left them and the
                secret is cleared, because it cannot be read back to show you what went in.
              </p>
            </div>
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
        </div>

        <footer
          class="flex flex-none items-center justify-between gap-2 border-t border-line px-5 py-3"
        >
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
              :disabled="checking || busy"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Cancel
            </v-btn>
            <!-- One primary at a time. Verify until the vendor has answered for what is in
                 the fields, then activate. -->
            <v-btn
              v-if="!verified"
              :disabled="!fillable"
              :loading="checking"
              class="text-xs font-medium"
              color="primary"
              size="small"
              type="submit"
              variant="flat"
            >
              Verify account
            </v-btn>
            <v-btn
              v-else
              :loading="busy"
              class="text-xs font-medium"
              color="primary"
              size="small"
              type="submit"
              variant="flat"
            >
              Use this account
            </v-btn>
          </span>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
