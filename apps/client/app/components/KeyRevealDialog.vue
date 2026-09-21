<script setup lang="ts">
/**
 * The one time a key is ever visible (notes/keys.md, notes/dialogs.md P1).
 *
 * Persistent: not the scrim and not Escape. The way out is Done, or Close without copying for
 * somebody who could not copy it, and that exit says what it leaves behind rather than asking
 * anybody to claim they stored the value. The value is one line that scrolls sideways instead
 * of wrapping, so what is read is what is pasted, with a labelled Copy beside it. Below `lg`
 * it is a full-height sheet.
 *
 * The value is shown alone, without configuration lines around it: it is the one thing this
 * dialog is for. A secret key gets one line saying where it may never go.
 */
import {
  type ApiKeyKind,
  KEY_FORMAT,
  KEY_KIND_LABELS,
  type ProjectApiKey,
  PUBLIC_PREFIXES,
} from "~/utils/keys";

const props = defineProps<{
  keyRow: ProjectApiKey;
  /** The only copy of the value. Held by the page, dropped when this closes. */
  secret: string;
  /** The key this one replaces, when it was made by Rotate. */
  replacing: ProjectApiKey | null;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  done: [];
}>();

const { lgAndUp } = useDisplay();
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true });

const titleId = `${useId()}-title`;
const valueId = `${useId()}-value`;

/** Set by the Copy beside the value, which is what the second exit is about. */
const copiedOnce = ref(false);

function copyKey() {
  void copy(props.secret);
  copiedOnce.value = true;
}

const kind = computed<ApiKeyKind>(() => props.keyRow.kind);

function finish() {
  emit("done");
  open.value = false;
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 600 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    persistent
    scrollable
    width="100%"
  >
    <v-card border flat>
      <div :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'" class="flex flex-col">
        <header class="flex flex-none flex-col gap-1 border-b border-line p-5">
          <h2 :id="titleId" class="m-0 flex items-center gap-2 text-base font-medium text-ink">
            <Icon
              aria-hidden="true"
              class="text-lg text-success"
              name="material-symbols:check-circle-outline"
            />
            {{ KEY_KIND_LABELS[kind] }} created
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Copy it now. Only its {{ KEY_FORMAT.digest }} digest is kept, so this is the one
            time the value is shown.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div class="flex flex-col gap-2">
            <span :id="valueId" class="text-xs font-medium text-ink">Key value</span>
            <div class="flex items-stretch gap-2">
              <div
                :aria-labelledby="valueId"
                class="min-w-0 flex-1 overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset"
                role="group"
                tabindex="0"
              >
                <code class="block px-3 py-2.5 font-mono text-[13px] leading-5 whitespace-nowrap text-ink">
                  {{ secret }}
                </code>
              </div>
              <v-btn
                :prepend-icon="copied ? 'material-symbols:check' : 'material-symbols:content-copy-outline'"
                class="h-auto! flex-none text-xs font-medium"
                color="neutral"
                variant="text"
                @click="copyKey"
              >
                {{ copied ? "Copied" : "Copy key" }}
              </v-btn>
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              Afterwards it is <span class="font-mono text-ink">{{ keyRow.prefix }}…</span> in the
              list, in your logs and in the audit trail.
            </p>
          </div>

          <p
            v-if="replacing"
            class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 p-3 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
          >
            It replaces <span class="font-mono text-ink">{{ replacing.prefix }}…</span>, which
            keeps working. Deploy this one everywhere the old one is set; the rotation stays open
            on the keys screen, with what has been observed of both, until you revoke the old key.
          </p>

          <p v-if="kind === 'secret'" class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/65">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-warning"
              name="material-symbols:warning-outline"
            />
            <span>
              Server-side only, and never under {{ PUBLIC_PREFIXES.join(", ") }}. A browser
              bundle is a published artefact, and a key that reaches one is spent.
            </span>
          </p>
        </div>

        <!-- The sentence takes the left and grows; the buttons keep the right edge, and stay
             on it when a narrow sheet wraps them under the sentence. -->
        <footer
          class="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-t border-line p-4"
        >
          <p class="m-0 min-w-0 flex-1 basis-60 text-[11px] leading-4 text-ink/55">
            <template v-if="copiedOnce">It will not be shown again.</template>
            <template v-else>
              Closed without copying, the key stays live and nobody holds its value. Revoke it
              from its menu and make another.
            </template>
          </p>
          <div class="ml-auto flex flex-none items-center gap-2">
            <v-btn
              v-if="!copiedOnce"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="finish"
            >
              Close without copying
            </v-btn>
            <v-btn
              class="text-xs font-medium"
              color="primary"
              size="small"
              variant="flat"
              @click="finish"
            >
              Done
            </v-btn>
          </div>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
