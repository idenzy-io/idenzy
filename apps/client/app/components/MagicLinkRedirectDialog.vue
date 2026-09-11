<script setup lang="ts">
/**
 * Registers one route a clicked magic link may land on: the page a customer's app
 * receives the sign-in result on, and nothing else.
 *
 * A customer holds four lists of URLs and this is the one nobody can place from its
 * name, so the dialog spells out what the value is for, shows the whole example rather
 * than a host, and states what the entry will be compared against once it is saved. The
 * server compares the whole string and normalises nothing, so what is written here is
 * what their code has to send, byte for byte.
 *
 * The origin is offered rather than added. Landing on a page and reading a credentialed
 * response from it are different privileges (ADR-0006), so allowing the origin is a
 * second act with a box of its own, off until somebody ticks it.
 */
import { originOf, validateAllowedOrigin } from "~/utils/origins";
import { REDIRECT_ISSUE_LABELS, validateRedirectUri } from "~/utils/otp";

const props = defineProps<{
  redirectUris: readonly string[];
  /** The CORS allowlist, so the box says whether this origin is already on it. */
  allowedOrigins: readonly string[];
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

const issue = computed(() => {
  if (text.value === "") return "";
  const found = validateRedirectUri(text.value);
  if (found !== null) return REDIRECT_ISSUE_LABELS[found];
  if (props.redirectUris.includes(text.value)) return "Already on the list.";
  return "";
});

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
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="520" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Add a return URL</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Where your app receives the sign-in result. The click spends the link and sends the
            browser here with a single-use code in the query, which your page exchanges for a
            session. This is not your OAuth callback, your CORS origin or your passkey URL.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="return-url-next">
            Application return URL
          </label>
          <v-text-field
            id="return-url-next"
            ref="field"
            v-model="uri"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            name="idenzy-return-url"
            placeholder="https://app.example.com/auth/callback"
            variant="filled"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{
              issue ||
              "The whole URL, path included. No wildcards and no prefixes: this list is all that stands between our redirect and somebody else's."
            }}
          </p>
        </div>

        <!-- What saving this actually produces, before it is saved: the string the server
             will compare, and the separate decision its origin is. -->
        <SamplePanel v-if="ready" title="What gets registered" meta="Matched exactly">
          <SampleLine icon="material-symbols:link">{{ text }}</SampleLine>

          <template v-if="origin?.state === 'offer'">
            <label
              class="mt-3 flex cursor-pointer items-start gap-2 rounded-(--idenzy-radius-x-small) border border-line bg-surface px-3 py-2"
              for="return-url-origin"
            >
              <v-checkbox-btn
                id="return-url-origin"
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
                  A return URL says where a click may land. It does not let a browser on that page
                  read a credentialed response, which is the separate CORS allowlist, and without
                  it the exchange call is refused by the browser rather than by us.
                </span>
              </span>
            </label>
          </template>
          <SampleLine v-else-if="origin?.state === 'allowed'" class="mt-2" icon="material-symbols:check-circle-outline" tone="muted">
            <span class="font-mono">{{ origin.value }}</span> is already on the CORS allowlist, so
            the page can make the exchange call.
          </SampleLine>
          <SampleLine v-else-if="origin?.state === 'refused'" class="mt-2" icon="material-symbols:info-outline" tone="muted">
            <span class="font-mono">{{ origin.value }}</span> cannot go on the CORS allowlist, which
            takes https and no loopback host. A link that lands here still works in development,
            where the SDK talks to the API from the same origin.
          </SampleLine>
          <SampleLine v-else-if="origin?.state === 'none'" class="mt-2" icon="material-symbols:info-outline" tone="muted">
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
