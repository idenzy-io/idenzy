<script setup lang="ts">
/**
 * The project's hook signing secret, the one time it is shown: when the first endpoint is saved,
 * and after a rotation (notes/hooks.md P1, notes/dialogs.md P1).
 *
 * It says which credential it is before anything else, because that was the finding: one secret
 * for all five hooks, and not a webhook secret. Persistent, so a stray click cannot lose it, with
 * an honest way out for somebody who could not copy it. After a rotation it states the deadline.
 * Below `lg` it is a full-height sheet.
 */
import { HOOK_CALLS, HOOK_SIGNATURE_HEADER, HOOK_TIMESTAMP_HEADER } from "~/utils/hooks";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  secret: string;
  projectName: string;
  /** When the previous secret stops signing, after a rotation. Null for a new one. */
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
const running = HOOK_CALLS.running;

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
            {{ until ? "New hook signing secret" : "Hook signing secret" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            For every hook on <span class="font-medium text-ink">{{ projectName }}</span>. Copy it
            now: this is the one time it is shown.
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
            Each call carries <span class="font-mono text-ink">{{ HOOK_TIMESTAMP_HEADER }}</span>
            and <span class="font-mono text-ink">{{ HOOK_SIGNATURE_HEADER }}</span>, signed over
            the timestamp and the raw body exactly as a webhook delivery is, so the verifier on
            the Webhooks page checks it with this secret. No webhook secret verifies a hook.
          </p>

          <p
            v-if="until"
            class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 p-3 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
          >
            Until <span class="font-medium text-ink">{{ formatDateTime(until) }}</span>, each call
            carries a signature from both secrets, so an endpoint holding either one verifies it.
            Deploy this one before then: after it, a call your endpoint cannot verify fails its
            request.
          </p>

          <p v-if="!running" class="m-0 text-[11px] leading-4 text-ink/50">
            Nothing calls a hook on this deployment yet, so nothing is signed with it today.
          </p>
        </div>

        <footer class="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-t border-line p-4">
          <p class="m-0 min-w-0 flex-1 basis-60 text-[11px] leading-4 text-ink/55">
            <template v-if="copiedOnce">It will not be shown again.</template>
            <template v-else>
              Closed without copying, nobody holds this secret. Rotate it to get one you can keep.
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
            <v-btn class="text-xs font-medium" color="primary" size="small" variant="flat" @click="finish">
              Done
            </v-btn>
          </div>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
