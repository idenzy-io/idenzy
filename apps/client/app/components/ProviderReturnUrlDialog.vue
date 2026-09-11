<script setup lang="ts">
/**
 * Registers one route a finished social sign-in may return to: the page in the customer's
 * own application that receives the code and exchanges it for a session.
 *
 * This is the second of the two URLs in an OAuth setup and the one nobody can place from
 * its name. The first is ours, goes in the provider console, and is fixed by the
 * deployment; this one is theirs, goes in this list, and is where we send the browser
 * once the provider has come back to us. The dialog says which is which before it takes
 * anything, because registering ours here and theirs at the provider is the way a first
 * setup fails, and it fails with an error the user sees and the operator does not.
 *
 * The origin is offered rather than added. Landing on a page and reading a credentialed
 * response from it are different privileges (ADR-0006), so allowing the origin is a
 * second act with a box of its own, off until somebody ticks it.
 */
import { originOf, validateAllowedOrigin } from "~/utils/origins";
import { returnUriIssue } from "~/utils/providers";

const props = defineProps<{
  /** Already registered on this project, so a duplicate can be named as one. */
  returnUris: readonly string[];
  /** The CORS allowlist, so the box says whether this origin is already on it. */
  allowedOrigins: readonly string[];
  /** Ours, so the dialog can say what this field is not. */
  callback: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  /** The URL trimmed and otherwise as typed, and whether to allow its origin as well. */
  confirm: [uri: string, allowOrigin: boolean];
}>();

const uri = ref("");
const allowOrigin = ref(false);
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

const titleId = useId();

watch(open, (value) => {
  if (value) {
    uri.value = "";
    allowOrigin.value = false;
  }
});

const text = computed(() => uri.value.trim());
const issue = computed(() => returnUriIssue(text.value, props.returnUris));
const ready = computed(() => text.value !== "" && issue.value === "");

/**
 * What the origin offer can say. A native scheme has none, a loopback or plain-http one
 * is refused by the allowlist whatever this dialog does, and one already allowed needs
 * no second decision.
 */
const origin = computed(() => {
  if (!ready.value) return null;
  const value = originOf(text.value);
  if (value === null) return { value: "", state: "none" as const };
  if (props.allowedOrigins.some((entry) => entry.toLowerCase() === value)) {
    return { value, state: "allowed" as const };
  }
  if (validateAllowedOrigin(value, []) !== null) return { value, state: "refused" as const };
  return { value, state: "offer" as const };
});

function confirm() {
  if (!ready.value) return;
  const wanted = origin.value?.state === "offer" && allowOrigin.value;
  emit("confirm", text.value, wanted);
  /* Cleared before the fade, or the list it just joined reports it as already there. */
  uri.value = "";
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="560" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Add a return URL</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Where your application receives a finished social sign-in. We take the provider's
            callback, verify it, and send the browser here with a single-use code your page
            exchanges for a session.
          </p>
        </header>

        <!-- The two URLs, side by side, before the field rather than after it. Registering
             ours here and theirs at the provider is the way a first setup fails. -->
        <div class="grid gap-2 rounded-(--idenzy-radius-small) bg-ink/4 p-3 ring-1 ring-ink/6 ring-inset sm:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-[11px] font-medium text-ink/70">Goes in the provider console</span>
            <span class="truncate font-mono text-[11px] text-ink/60">{{ callback }}</span>
            <span class="text-[11px] leading-4 text-ink/45">Ours. Fixed, and not this field.</span>
          </div>
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-[11px] font-medium text-ink">Goes in this field</span>
            <span class="truncate font-mono text-[11px] text-ink/80">
              https://app.example.com/auth/callback
            </span>
            <span class="text-[11px] leading-4 text-ink/45">Yours. A route in your own app.</span>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="provider-return-url">
            Application return URL
          </label>
          <v-text-field
            id="provider-return-url"
            ref="field"
            v-model="uri"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-oauth-return-url"
            placeholder="https://app.example.com/auth/callback"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{
              issue ||
              "The whole URL, path included. No wildcards and no prefixes: we render no page of our own, so this list is all that stands between our redirect and somebody else's. It is checked when the flow starts and again at the callback."
            }}
          </p>
        </div>

        <!-- What saving this actually produces, before it is saved: the string the server
             will compare, and the separate decision its origin is. -->
        <SamplePanel v-if="ready" meta="Matched exactly" title="What gets registered">
          <SampleLine icon="material-symbols:link">{{ text }}</SampleLine>
          <SampleLine class="mt-1" icon="material-symbols:key-outline" tone="muted">
            Every provider on this project may return here. The list belongs to the project,
            not to Google or Apple, because the code is ours whichever of them minted the
            identity behind it.
          </SampleLine>

          <label
            v-if="origin?.state === 'offer'"
            class="mt-3 flex cursor-pointer items-start gap-2 rounded-(--idenzy-radius-x-small) border border-line bg-surface px-3 py-2"
            for="provider-return-origin"
          >
            <v-checkbox-btn
              id="provider-return-origin"
              v-model="allowOrigin"
              class="flex-none"
              color="primary"
              density="compact"
              hide-details
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-xs leading-4 font-medium text-ink">
                Also allow <span class="font-mono">{{ origin.value }}</span> to call the API
              </span>
              <span class="text-[11px] leading-4 text-ink/55">
                A return URL says where a redirect may land. It does not let a browser on that
                page read a credentialed response, which is the separate CORS allowlist, and
                without it the exchange call is refused by the browser rather than by us, with
                nothing in our logs to explain it.
              </span>
            </span>
          </label>
          <SampleLine
            v-else-if="origin?.state === 'allowed'"
            class="mt-2"
            icon="material-symbols:check-circle-outline"
            tone="muted"
          >
            <span class="font-mono">{{ origin.value }}</span> is already on the CORS allowlist, so
            the page can make the exchange call.
          </SampleLine>
          <SampleLine
            v-else-if="origin?.state === 'refused'"
            class="mt-2"
            icon="material-symbols:info-outline"
            tone="muted"
          >
            <span class="font-mono">{{ origin.value }}</span> cannot go on the CORS allowlist,
            which takes https and no loopback host. A sign-in that returns here still works in
            development, where the SDK talks to the API from the same origin.
          </SampleLine>
          <SampleLine
            v-else-if="origin?.state === 'none'"
            class="mt-2"
            icon="material-symbols:info-outline"
            tone="muted"
          >
            A native scheme has no origin, so there is nothing to add to the CORS allowlist and
            nothing a browser would send.
          </SampleLine>
        </SamplePanel>

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
            Add return URL
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
