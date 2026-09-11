<script setup lang="ts">
/**
 * A signing secret, the one time it is shown: when the endpoint is made, and after a rotation
 * (notes/webhooks.md, notes/dialogs.md P1).
 *
 * Persistent, so a stray click cannot lose it, with an honest way out for somebody who could
 * not copy it: Close without copying says what that leaves behind rather than asking anybody
 * to claim they stored it. The value is one line that scrolls sideways, with a labelled Copy
 * beside it. After a rotation it states the deadline: until then both secrets sign each
 * delivery, and after it only the new one does. Below `lg` it is a full-height sheet.
 */

import { formatDateTime } from "~/utils/time";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, WEBHOOK_DELIVERY } from "~/utils/webhooks";

const props = defineProps<{
  secret: string;
  url: string;
  /** When the previous secret stops signing, after a rotation. Null for a new endpoint. */
  until: string | null;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  done: [];
}>();

const { lgAndUp } = useDisplay();
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true });

const titleId = `${useId()}-title`;
const valueId = `${useId()}-value`;
const copiedOnce = ref(false);

function copySecret() {
  void copy(props.secret);
  copiedOnce.value = true;
}

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
    :max-width="lgAndUp ? 560 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    persistent
    scrollable
    width="100%"
  >
    <v-card border flat>
      <div :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'" class="flex flex-col">
        <header class="flex flex-none flex-col gap-1 border-b border-line p-5">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">
            {{ until ? "New signing secret" : "Signing secret" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            For <span class="font-mono break-all text-ink/80">{{ url }}</span>. Copy it now:
            this is the one time it is shown.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div class="flex flex-col gap-2">
            <span :id="valueId" class="text-xs font-medium text-ink">Secret</span>
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
                variant="outlined"
                @click="copySecret"
              >
                {{ copied ? "Copied" : "Copy secret" }}
              </v-btn>
            </div>
          </div>

          <p class="m-0 text-xs leading-5 text-ink/70">
            Every delivery carries <span class="font-mono text-ink">{{ TIMESTAMP_HEADER }}</span>
            and <span class="font-mono text-ink">{{ SIGNATURE_HEADER }}</span>. Verify the
            signature over the timestamp and the raw body before you parse anything; the page's
            verifier sample does exactly that.
          </p>

          <p
            v-if="until"
            class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 p-3 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
          >
            Until <span class="font-medium text-ink">{{ formatDateTime(until) }}</span>, each
            delivery carries a signature from both secrets, so a receiver holding either one
            verifies it. Deploy this secret before then: after it, only this one signs.
          </p>

          <p v-if="!WEBHOOK_DELIVERY.running" class="m-0 text-[11px] leading-4 text-ink/50">
            Nothing is signed on this deployment yet, because delivery is not running.
          </p>
        </div>

        <footer class="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-t border-line p-4">
          <p class="m-0 min-w-0 flex-1 basis-60 text-[11px] leading-4 text-ink/55">
            <template v-if="copiedOnce">It will not be shown again.</template>
            <template v-else>
              Closed without copying, nobody holds this secret. Rotate it again to get one you
              can keep.
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
