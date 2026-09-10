<script setup lang="ts">
/**
 * Takes a key out of service, and is exactly as loud as the key deserves.
 *
 * `resolve_project_by_key_hash` filters on `revoked_at` with nothing cached in front of it,
 * so a revocation lands on the next request rather than at the end of some window. There is
 * no grace period to offer and the dialog does not pretend there is one: what it offers
 * instead is the evidence for whether this key is still carrying traffic.
 *
 * Which is why there are two versions of this dialog and the data picks between them. A key
 * that has been silent for a day is the tail of a rotation somebody has already finished in
 * practice, and asking them to tick a box about it teaches them to tick boxes. A key that
 * answered a request four minutes ago is production, and that one gets the box and the
 * amber. The rule lives in `isQuiet`, so the list and this dialog cannot disagree about
 * which case a key is in.
 *
 * The sharpest case is neither: the last live key of its kind. Revoking that does not break
 * one deployment, it stops that whole way of reaching the project, and the dialog says which
 * one in the words a customer would use rather than in the name of a header.
 */
import { isQuiet, KEY_KIND_LABELS, maskedKey, type ProjectApiKey, QUIET_HOURS } from "~/utils/keys";
import { formatDateTime, relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  keyRow: ProjectApiKey | null;
  /** Nothing else of this kind would be live afterwards. */
  lastOfKind: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const now = useNow({ interval: 30_000 });

const acknowledged = ref(false);

watch(open, (showing) => {
  if (showing) acknowledged.value = false;
});

/* Built here rather than assembled in the template, where the space between a label and a
   value ends up on either side of the full stop that follows them. */
const subject = computed(() =>
  props.keyRow === null ? "" : `${KEY_KIND_LABELS[props.keyRow.kind]} ${maskedKey(props.keyRow)}`,
);

/** Silent long enough that revoking should break nothing anybody is running. */
const quiet = computed(() => props.keyRow !== null && isQuiet(props.keyRow, now.value));

const lastUsed = computed(() => {
  const at = props.keyRow?.lastUsedAt;
  return at === undefined || at === null ? null : relativeTimeWords(at, now.value);
});

/* An acknowledgement is asked for where it means something: a key still answering, or the
   last way in of its kind. Everywhere else it would be a box to tick past. */
const needsAcknowledgement = computed(() => !quiet.value || props.lastOfKind);
const ready = computed(() => !needsAcknowledgement.value || acknowledged.value);

/** What stops working, said the way a customer would say it. */
const stops = computed(() =>
  props.keyRow?.kind === "publishable"
    ? "your application's sign-in calls from the browser"
    : "every server call your backend makes",
);

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
  <v-dialog v-model="open" max-width="480">
    <v-card v-if="keyRow" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Revoke this key</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <span class="font-medium text-ink">{{ subject }}</span>. It stops working on the
            very next request: there is no grace window here, because the check that reads it
            has no cache in front of it.
          </p>
        </header>

        <div
          :class="
            quiet && !lastOfKind
              ? 'border-line bg-canvas'
              : 'border-warning/30 bg-warning/6'
          "
          class="flex items-start gap-2.5 rounded-(--idenzy-radius-small) border px-3 py-2.5"
        >
          <Icon
            :class="quiet && !lastOfKind ? 'text-ink/40' : 'text-warning'"
            aria-hidden="true"
            class="mt-0.5 flex-none text-base"
            :name="
              quiet && !lastOfKind
                ? 'material-symbols:check-circle-outline'
                : 'material-symbols:warning-outline'
            "
          />
          <div class="flex min-w-0 flex-col gap-0.5 text-[11px] leading-4">
            <p v-if="lastUsed === null" class="m-0 font-medium text-ink">
              Nothing has ever called with this key.
            </p>
            <p v-else class="m-0 font-medium text-ink">
              Last used
              <v-tooltip
                v-if="keyRow.lastUsedAt"
                :text="formatDateTime(keyRow.lastUsedAt)"
                location="top"
              >
                <template #activator="{ props: tip }">
                  <span v-bind="tip" class="underline decoration-dotted decoration-ink/30">
                    {{ lastUsed }}
                  </span>
                </template>
              </v-tooltip>
              <span v-else>{{ lastUsed }}</span>
            </p>
            <p class="m-0 text-ink/65">
              <template v-if="lastUsed === null">
                Either it was never deployed, or it was deployed somewhere that has not been
                called yet. The first is safe to revoke; the second is worth checking.
              </template>
              <template v-else-if="quiet">
                Silent for more than {{ QUIET_HOURS }} hours, which is what this panel treats
                as finished. Revoking should break nothing anybody is running.
              </template>
              <template v-else>
                Still carrying traffic. Whatever holds it will start failing the moment this
                is done, and the fix is a deployment rather than an undo.
              </template>
            </p>
          </div>
        </div>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li v-if="lastOfKind" class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-error"
              name="material-symbols:block"
            />
            <span>
              This is the last live {{ KEY_KIND_LABELS[keyRow.kind].toLowerCase() }} on the
              project. Revoking it stops {{ stops }} until a new one is made and deployed.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:undo"
            />
            <span>
              There is no undo. The value was never stored, so a revoked key cannot be put
              back; what replaces it is a new key and a deployment.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:history"
            />
            <span>
              The row stays, revoked, so a log line naming
              <span class="font-mono text-ink">{{ keyRow.prefix }}</span> next year still has
              something to point at. Recorded in the audit log against your name.
            </span>
          </li>
        </ul>

        <label
          v-if="needsAcknowledgement"
          class="flex cursor-pointer items-start gap-2 text-xs text-ink"
        >
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="error"
            density="compact"
          />
          <span class="pt-px">
            <template v-if="lastOfKind">
              I understand {{ stops }} will stop until a new key is deployed.
            </template>
            <template v-else>
              I understand whatever is using this key will start failing now.
            </template>
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
            Keep it
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
            Revoke the key
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
