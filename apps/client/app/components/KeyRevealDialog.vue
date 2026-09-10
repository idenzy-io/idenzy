<script setup lang="ts">
/**
 * The one time a key is ever visible.
 *
 * Everything about this dialog follows from the storage: the server keeps
 * `sha256(key)` under a unique index, so there is no decrypt path and no second showing to
 * fall back on. That makes a stray click expensive in a way almost nothing else in the panel
 * is, so the dialog is `persistent`: it does not close on the scrim, on Escape, or on
 * anything but the button that says the reader is finished.
 *
 * The value is shown whole rather than behind a reveal toggle. A masked field with an eye on
 * it is the right shape for a secret being displayed *again*, where hiding it protects
 * against a shoulder; here the reader opened this dialog for exactly one reason and hiding
 * the answer behind a second click only adds a way to miss it.
 *
 * Under the key is the line they are actually going to paste, because a key on its own still
 * leaves somebody guessing at a variable name, and the name differs per framework in a way
 * only the prefix does.
 *
 * The acknowledgement is on the secret key and not the publishable one. Losing a publishable
 * key costs a rotation of a value that was public by construction; losing a secret key at the
 * wrong moment costs a deployment. Asking for a tick on both would teach the reader to tick.
 */
import { ENV_NAMES, KEY_FORMAT, KEY_KIND_LABELS, type ProjectApiKey } from "~/utils/keys";

const props = defineProps<{
  /** The row that was written. Null closes the dialog down to nothing. */
  keyRow: ProjectApiKey | null;
  /** The only copy of the value. Held by the page, dropped when this closes. */
  secret: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  done: [];
}>();

const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true });

const acknowledged = ref(false);

watch(open, (showing) => {
  if (showing) acknowledged.value = false;
});

const isSecret = computed(() => props.keyRow?.kind === "secret");

/**
 * The line to paste. The publishable one carries a framework prefix and this shows it
 * without one, because the prefix is the framework's and the docs name it; what is worth
 * showing here is which variable, and that a secret key has no public spelling at all.
 */
const envLine = computed(() =>
  isSecret.value
    ? `${ENV_NAMES.secret}=${props.secret}`
    : `${ENV_NAMES.publishable}=${props.secret}`,
);

const ready = computed(() => !isSecret.value || acknowledged.value);

function done() {
  if (!ready.value) return;
  emit("done");
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" persistent>
    <v-card v-if="keyRow" border flat>
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 flex items-center gap-2 text-sm font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-base text-success"
              name="material-symbols:check-circle-outline"
            />
            {{ KEY_KIND_LABELS[keyRow.kind] }} created
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Copy it now. We keep only its {{ KEY_FORMAT.digest }} digest, so this screen is
            the one place the value has ever existed outside your clipboard and it will not
            be shown again.
          </p>
        </header>

        <div class="flex flex-col gap-2">
          <div
            class="flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3"
          >
            <code class="min-w-0 flex-1 font-mono text-[13px] leading-5 break-all text-ink">
              {{ secret }}
            </code>
            <v-tooltip :text="copied ? 'Copied' : 'Copy the key'" location="top">
              <template #activator="{ props: tip }">
                <button
                  v-bind="tip"
                  aria-label="Copy the key"
                  class="inline-flex size-7 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                  @click="copy(secret)"
                >
                  <Icon
                    :class="copied ? 'text-success' : ''"
                    :name="
                      copied ? 'material-symbols:check' : 'material-symbols:content-copy-outline'
                    "
                    aria-hidden="true"
                    class="text-base"
                  />
                </button>
              </template>
            </v-tooltip>
          </div>

          <CopyField
            :label="`Copy the ${isSecret ? 'server' : 'environment'} variable line`"
            :value="envLine"
            dense
          />
        </div>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li v-if="isSecret" class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-warning"
              name="material-symbols:warning-outline"
            />
            <span>
              Server-side only. There is no public spelling of this variable on purpose: a
              browser bundle is a published artefact, and a key that reaches one is spent.
            </span>
          </li>
          <li v-else class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-success"
              name="material-symbols:check-circle-outline"
            />
            <span>
              Safe in a browser bundle. That is what it is for: it names your project and can
              do nothing else, so shipping it is the intended use rather than a leak.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:key-outline"
            />
            <span>
              Afterwards this key is
              <span class="font-mono text-ink">{{ keyRow.prefix }}</span> in the list, in your
              logs and in the audit trail. That is what to match it by.
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

        <label v-if="isSecret" class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="primary"
            density="compact"
          />
          <span class="pt-px">
            I have stored this key somewhere my servers can read it.
          </span>
        </label>

        <footer class="flex items-center justify-end">
          <v-btn
            :disabled="!ready"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="done"
          >
            Done
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Vuetify grows a selection control to fill its flex row, which would push the label to
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
