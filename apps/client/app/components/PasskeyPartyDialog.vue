<script setup lang="ts">
/**
 * Creates the project's relying party: the domain the passkeys belong to, the name an
 * authenticator shows when it asks, and the first page allowed to run a ceremony.
 *
 * One dialog rather than three fields on the page, because the three are checked against
 * each other and written as one record. An origin is only valid on the RP ID's own
 * domain, so it cannot be validated before the id is typed, and a party with no origin
 * refuses every ceremony, so it cannot be created without one.
 */
import {
  isRpId,
  normaliseOrigin,
  type RelyingParty,
  RP_ISSUE_LABELS,
  validateOrigin,
} from "~/utils/passkeys";

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** The party as one record, its origin normalised. */
  confirm: [party: RelyingParty];
}>();

const rpId = ref("");
const rpName = ref("");
const origin = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (!value) return;
  rpId.value = "";
  rpName.value = "";
  origin.value = "";
});

const id = computed(() => rpId.value.trim().toLowerCase());
const idReady = computed(() => isRpId(id.value));

const rpIdIssue = computed(() =>
  id.value === "" || idReady.value ? "" : RP_ISSUE_LABELS.rp_id_invalid,
);

/* Nothing to check an origin against until the id stands, so it says nothing until then. */
const originIssue = computed(() => {
  const text = origin.value.trim();
  if (text === "" || !idReady.value) return "";
  const issue = validateOrigin(text, id.value);
  return issue === null ? "" : RP_ISSUE_LABELS[issue];
});

const ready = computed(
  () =>
    idReady.value &&
    rpName.value.trim() !== "" &&
    origin.value.trim() !== "" &&
    originIssue.value === "",
);

function confirm() {
  if (!ready.value) return;
  emit("confirm", {
    rpId: id.value,
    rpName: rpName.value.trim(),
    origins: [normaliseOrigin(origin.value)],
  });
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Complete passkey setup</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Every ceremony on this project is refused until it exists, and the SDK reports
            that as a configuration error rather than a failed sign-in. It is never taken
            from the request's host: whoever controls a request would otherwise choose
            which credentials it may use.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="rp-create-id">Passkey domain</label>
          <v-text-field
            id="rp-create-id"
            ref="field"
            v-model="rpId"
            :error="rpIdIssue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-passkey-domain"
            placeholder="example.com"
            variant="filled"
          />
          <p class="m-0 text-[11px]" :class="rpIdIssue ? 'text-error' : 'text-ink/50'">
            {{
              rpIdIssue ||
              "The domain your pages share, called the RP ID in WebAuthn. Passkeys are bound to it, so changing it later orphans every one of them."
            }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="rp-create-name">Product name</label>
          <v-text-field
            id="rp-create-name"
            v-model="rpName"
            autocomplete="off"
            hide-details
            name="idenzy-passkey-product-name"
            placeholder="Your product's name"
            variant="filled"
          />
          <p class="m-0 text-[11px] text-ink/50">
            What the authenticator shows when it asks. Your product, not ours, and a
            rename costs nothing.
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="rp-create-origin">First application URL</label>
          <v-text-field
            id="rp-create-origin"
            v-model="origin"
            :error="originIssue !== ''"
            :placeholder="idReady ? `https://app.${id}` : 'https://app.example.com'"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-passkey-url"
            variant="filled"
          />
          <p class="m-0 text-[11px]" :class="originIssue ? 'text-error' : 'text-ink/50'">
            {{
              originIssue ||
              "Scheme, host and port, matched exactly, on the passkey domain or a subdomain of it. More can be added afterwards."
            }}
          </p>
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
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Complete setup
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
