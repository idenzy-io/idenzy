<script setup lang="ts">
/**
 * Takes a key out of service, and makes the operator look at it first (notes/keys.md).
 *
 * The dialog names the exact key, what was last observed of it and over what window, the
 * rotation it belongs to, and what the next request does, then asks about its consumers
 * every time. It used to skip the question for a key silent for a day, and that is the weekly
 * job the note's finding is about: an observation is not a census.
 *
 * `compromised` is the other procedure, revoke first and deploy after, so it asks about the
 * breakage instead of the consumers: the honest answer to "has everything moved" is no.
 *
 * Mounted by the page only while open and closed by it once the write lands, so a failure
 * keeps the dialog up and says the key still works.
 */
import {
  KEY_KIND_LABELS,
  keyName,
  maskedKey,
  OBSERVATION_LIMIT,
  observationWords,
  type ProjectApiKey,
  type Rotation,
} from "~/utils/keys";
import { formatDate, formatDateTime } from "~/utils/time";

const props = defineProps<{
  keyRow: ProjectApiKey;
  reason: "retire" | "compromised";
  /** Which half of an unfinished rotation the key is, if either. */
  role: { role: "old" | "replacement"; rotation: Rotation } | null;
  /** Nothing else of this kind would be live afterwards. */
  lastOfKind: boolean;
  projectName: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const now = useNow({ interval: 30_000 });
const titleId = `${useId()}-title`;
const acknowledged = ref(false);

const urgent = computed(() => props.reason === "compromised");

/** What stops, in the words a customer would use rather than the name of a header. */
const stops = computed(() =>
  props.keyRow.kind === "publishable"
    ? "every call your application makes from a browser"
    : "every call your backend makes to the management API",
);

const created = computed(() => {
  const { createdBy, createdAt } = props.keyRow;
  return createdBy
    ? `Made by ${createdBy} on ${formatDate(createdAt)}`
    : `Made on ${formatDate(createdAt)}, by an entry older than the audit trail keeps`;
});

/** What the rotation it belongs to says about revoking it now. */
const rotation = computed(() => {
  const role = props.role;
  if (role === null) return null;
  const { old, replacement, replacementObserved, oldObservedSince } = role.rotation;
  if (role.role === "replacement") {
    return {
      warn: false,
      words: `This is the replacement in a rotation from ${old.prefix}…, which keeps working. Revoking it abandons the rotation.`,
    };
  }
  if (!replacementObserved) {
    return {
      warn: true,
      words: `Its replacement ${replacement.prefix}… has not been observed, so nothing is known to be deployed with it. Whatever still presents this key has nothing to fall back to.`,
    };
  }
  if (oldObservedSince) {
    return {
      warn: true,
      words: `Its replacement ${replacement.prefix}… has been observed, and so has this key since the replacement was made. Something still holds this one.`,
    };
  }
  return {
    warn: false,
    words: `Its replacement ${replacement.prefix}… has been observed, and this key has not been since the replacement was made.`,
  };
});

const acknowledgement = computed(() =>
  urgent.value
    ? `Everything still using ${props.keyRow.prefix}… fails from the next request until a replacement is deployed.`
    : `Every consumer of ${props.keyRow.prefix}… has moved off it, including jobs that run less often than daily.`,
);

function confirm() {
  if (acknowledged.value) emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="520" scrollable>
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            {{ urgent ? "Revoke a compromised key" : `Revoke ${keyName(keyRow)}` }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            It stops working for <span class="font-medium text-ink">{{ projectName }}</span> on
            the very next request: the check reads the revocation with no cache in front of it,
            so there is no grace period.
          </p>
        </header>

        <div
          class="flex flex-col gap-3 rounded-(--idenzy-radius-small) bg-ink/4 p-3 ring-1 ring-ink/6 ring-inset"
        >
          <div class="flex flex-col gap-0.5">
            <span class="text-[11px] leading-4 text-ink/50">{{ KEY_KIND_LABELS[keyRow.kind] }}</span>
            <span class="truncate font-mono text-xs text-ink">{{ maskedKey(keyRow) }}</span>
            <span class="text-[11px] leading-4 text-ink/50">{{ created }}</span>
          </div>
          <div class="flex flex-col gap-0.5 border-t border-ink/6 pt-3">
            <span class="text-[11px] leading-4 text-ink/50">Last observed use</span>
            <span class="text-xs text-ink">
              {{ observationWords(keyRow, now) }}
              <span v-if="keyRow.lastUsedAt" class="text-ink/50">
                · {{ formatDateTime(keyRow.lastUsedAt) }}
              </span>
            </span>
            <span class="text-[11px] leading-4 text-ink/50">{{ OBSERVATION_LIMIT }}</span>
          </div>
        </div>

        <p
          v-if="rotation"
          class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/75"
        >
          <span
            :class="rotation.warn ? 'bg-warning' : 'bg-ink/30'"
            aria-hidden="true"
            class="mt-2 size-1.5 flex-none rounded-full"
          />
          <span>{{ rotation.words }}</span>
        </p>

        <p
          v-if="urgent"
          class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/75"
        >
          <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-error" name="material-symbols:bolt" />
          <span>
            Revoke first and deploy after. A few minutes of failed requests is a smaller problem
            than a live credential in somebody else's hands.
          </span>
        </p>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/70">
          <li v-if="lastOfKind" class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-error" name="material-symbols:block" />
            <span>
              It is the last live {{ KEY_KIND_LABELS[keyRow.kind].toLowerCase() }} on the
              project: {{ stops }} stops until a new one is made and deployed.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:undo" />
            <span>
              There is no undo. The value was never stored, so a revoked key cannot be put back;
              what replaces it is a new key and a deployment.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:history" />
            <span>
              The row stays, revoked, so a log line naming
              <span class="font-mono text-ink">{{ keyRow.prefix }}…</span> still has something
              to point at. Recorded in the audit log against your name.
            </span>
          </li>
        </ul>

        <label class="flex cursor-pointer items-start gap-2 text-xs leading-5 text-ink">
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1 -ml-1.5 flex-none"
            color="error"
            density="compact"
          />
          <span class="pt-0.5">{{ acknowledgement }}</span>
        </label>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

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
            :disabled="!acknowledged"
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            {{ urgent ? "Revoke key now" : "Revoke key" }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Vuetify grows a selection control to fill its flex row, which would push the sentence to
   the far end of the dialog. Same rule the other acknowledgement dialogs carry. */
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
