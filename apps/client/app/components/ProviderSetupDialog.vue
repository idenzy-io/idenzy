<script setup lang="ts">
/**
 * The credentials for one provider, written as one record.
 *
 * It opens with the callback URL rather than with a field, because that value is the
 * first thing the provider console asks for and the setup fails in a way nobody can read
 * if it is wrong: the provider refuses the redirect before we are ever called. Copying it
 * is therefore step one, and the console it belongs to is one click away.
 *
 * The secret goes one way. It is stored envelope encrypted under the project's data key
 * and the panel is never told what it is, so on a provider that already has one the field
 * is a replacement rather than the current value, and leaving it blank keeps what is
 * stored. Clearing a secret is not offered, because a provider without one is a provider
 * that cannot finish a sign-in, and removing it from the project is the honest way to say
 * that.
 *
 * Everything is validated against the record it would make before anything is sent, the
 * same rule the passwords and passkeys screens follow, and the reasons sit under their own
 * fields rather than in a banner at the top.
 *
 * Both credential fields are named and the secret is marked `new-password`, which is what
 * keeps a password manager out of them. A text field followed by a password field is a
 * sign-in form as far as the browser is concerned, and it will put the operator's own
 * address in the client id and their panel password in the secret, which saves cleanly and
 * fails at the provider.
 */
import {
  draftFrom,
  INSTANT_HOSTS,
  issueFor,
  MODE_LABELS,
  type ProviderConfig,
  type ProviderDraft,
  type ProviderInfo,
  validateProvider,
} from "~/utils/providers";

const props = defineProps<{
  /** Null while the dialog has never been opened, which is the state before first paint. */
  info: ProviderInfo | null;
  /** The saved configuration, or null for a provider being set up for the first time. */
  config: ProviderConfig | null;
  /** Where the provider sends the browser back to, for the console it has to be pasted in. */
  callback: string;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [draft: ProviderDraft];
}>();

const EMPTY: ProviderDraft = {
  mode: "custom",
  clientId: "",
  clientSecret: "",
  scopes: "",
  customScopes: false,
  settings: {},
  storeTokens: false,
};

const draft = ref<ProviderDraft>({ ...EMPTY });
const tried = ref(false);
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const first = useTemplateRef<{ focus: () => void }>("first");

watch(open, (showing) => {
  if (!showing || props.info === null) return;
  draft.value = draftFrom(props.info, props.config);
  tried.value = false;
});

const secretStored = computed(() => props.config?.secretSet === true);
const editing = computed(() => props.config !== null);

const issues = computed(() =>
  props.info === null ? [] : validateProvider(props.info, draft.value, secretStored.value),
);

/** A reason is shown once the reader has tried to save, not while they are still typing. */
function reason(field: string): string {
  if (!tried.value || props.info === null) return "";
  return issueFor(props.info, issues.value, field);
}

const mode = computed({
  get: () => draft.value.mode,
  set: (value: string) => {
    if (value === "instant" || value === "custom") draft.value.mode = value;
  },
});

const MODE_OPTIONS = [
  { value: "custom", label: MODE_LABELS.custom.label },
  { value: "instant", label: MODE_LABELS.instant.label },
];

const revealed = ref(false);

const defaults = computed(() => props.info?.defaultScopes ?? []);

function confirm() {
  tried.value = true;
  if (issues.value.length > 0 || props.info === null) return;
  emit("confirm", { ...draft.value });
}

/* The dialog closes on the write landing rather than on the click, so a refused save
   keeps the values on screen. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable @after-enter="first?.focus()">
    <v-card v-if="info" border flat>
      <form class="flex max-h-[82vh] flex-col" @submit.prevent="confirm">
        <header class="flex flex-none items-start gap-3 px-5 pt-5 pb-4">
          <span class="flex size-9 flex-none items-center justify-center text-ink">
            <Icon
              :class="[info.monochrome ? '[.v-theme--dark_&]:invert' : '', info.tint ?? '']"
              :name="info.icon"
              aria-hidden="true"
              class="text-[26px]"
            />
          </span>
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="m-0 text-sm font-medium text-ink">
              {{ editing ? `${info.label} credentials` : `Add ${info.label}` }}
            </h2>
            <p class="m-0 text-xs leading-5 text-ink/60">{{ info.note }}</p>
          </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-line px-5 py-5">
          <!-- The console's side of the setup, first, because a redirect URI the provider
               does not hold is refused before we are called at all. -->
          <section class="flex flex-col gap-2">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="m-0 text-xs font-medium text-ink">Callback URL</h3>
              <a
                :href="info.console.href"
                class="inline-flex items-center gap-1 text-[11px] font-medium text-ink no-underline"
                rel="noopener"
                target="_blank"
              >
                {{ info.console.label }}
                <Icon aria-hidden="true" class="text-xs" name="material-symbols:open-in-new" />
              </a>
            </div>
            <CopyField :value="callback" label="Copy the callback URL" />
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              Register this as the redirect URI in the provider console. It is ours, not the
              route in your application: we finish the exchange and then send the browser to
              a URI you registered with us, carrying a single-use code.
            </p>
          </section>

          <section class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Credentials</h3>
            <SegmentedControl v-model="mode" :options="MODE_OPTIONS" label="Credentials" />
            <p class="m-0 text-[11px] leading-4 text-ink/50">{{ MODE_LABELS[draft.mode].detail }}</p>

            <div
              v-if="draft.mode === 'instant'"
              class="flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-3 py-2.5 text-[11px] leading-4 text-ink/75"
            >
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm text-warning"
                name="material-symbols:warning-outline"
              />
              <span>
                A sign-in that returns anywhere but {{ INSTANT_HOSTS }} is refused, and the
                consent screen carries our name rather than yours. It is here so a provider
                works in the thirty seconds before you have an app of your own, and for
                nothing after that.
              </span>
            </div>
          </section>

          <template v-if="draft.mode === 'custom'">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-ink" for="provider-client-id">
                {{ info.clientIdLabel ?? "Client ID" }}
              </label>
              <v-text-field
                id="provider-client-id"
                ref="first"
                v-model="draft.clientId"
                :error="reason('clientId') !== ''"
                autocomplete="off"
                class="font-mono"
                name="idenzy-oauth-client-id"
                hide-details
                variant="filled"
              />
              <p :class="reason('clientId') ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px]">
                {{ reason("clientId") || "Public, and carried on every authorization URL." }}
              </p>
            </div>

            <div class="flex flex-col gap-1.5">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <label class="text-xs font-medium text-ink" for="provider-client-secret">
                  {{ info.secret.label }}
                </label>
                <span v-if="secretStored" class="text-[11px] text-ink/50">
                  One is stored. Leave this blank to keep it.
                </span>
              </div>
              <v-textarea
                v-if="info.secret.multiline"
                id="provider-client-secret"
                v-model="draft.clientSecret"
                :error="reason('clientSecret') !== ''"
                :placeholder="info.secret.placeholder"
                auto-grow
                autocomplete="new-password"
                class="font-mono text-xs"
                hide-details
                name="idenzy-oauth-client-secret"
                rows="4"
                variant="outlined"
              />
              <v-text-field
                v-else
                id="provider-client-secret"
                v-model="draft.clientSecret"
                :append-inner-icon="
                  revealed
                    ? 'material-symbols:visibility-off-outline'
                    : 'material-symbols:visibility-outline'
                "
                :error="reason('clientSecret') !== ''"
                :placeholder="info.secret.placeholder"
                :type="revealed ? 'text' : 'password'"
                autocomplete="new-password"
                class="font-mono"
                hide-details
                name="idenzy-oauth-client-secret"
                variant="filled"
                @click:append-inner="revealed = !revealed"
              />
              <p
                :class="reason('clientSecret') ? 'text-error' : 'text-ink/50'"
                class="m-0 text-[11px]"
              >
                {{ reason("clientSecret") || info.secret.hint }}
              </p>
            </div>

            <div v-for="field in info.fields" :key="field.key" class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-ink" :for="`provider-${field.key}`">
                {{ field.label }}
                <span v-if="!field.required" class="font-normal text-ink/45">optional</span>
              </label>
              <v-text-field
                :id="`provider-${field.key}`"
                :error="reason(field.key) !== ''"
                :model-value="draft.settings[field.key] ?? ''"
                :placeholder="field.placeholder"
                autocomplete="off"
                class="font-mono"
                hide-details
                variant="filled"
                @update:model-value="draft.settings[field.key] = String($event)"
              />
              <p :class="reason(field.key) ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px]">
                {{ reason(field.key) || field.hint }}
              </p>
            </div>
          </template>

          <section class="flex flex-col gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Scopes</h3>
            <p v-if="defaults.length === 0" class="m-0 text-[11px] leading-4 text-ink/55">
              {{ info.label }} takes no scopes. What the integration may do is configured on
              the integration itself, so nothing is requested here.
            </p>
            <template v-else>
              <ul class="m-0 flex list-none flex-wrap gap-1 p-0">
                <li
                  v-for="scope in defaults"
                  :key="scope"
                  class="rounded-full border border-line bg-canvas px-2 py-0.5 font-mono text-[10px] leading-4 text-ink/65"
                >
                  {{ scope }}
                </li>
              </ul>
              <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
                <v-checkbox-btn
                  v-model="draft.customScopes"
                  class="-mt-1.5 -ml-1.5"
                  color="primary"
                  density="compact"
                />
                <span class="flex flex-col gap-0.5 pt-px">
                  Ask for different scopes
                  <span class="text-[11px] text-ink/50">
                    Replaces the list above. A scope the provider has not granted the app is
                    refused at the consent screen, where the user sees it and you do not.
                  </span>
                </span>
              </label>
              <v-text-field
                v-if="draft.customScopes"
                v-model="draft.scopes"
                aria-label="Scopes"
                autocomplete="off"
                class="font-mono"
                hide-details
                placeholder="openid email profile"
                variant="filled"
              />
            </template>
          </section>

          <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
            <v-checkbox-btn
              v-model="draft.storeTokens"
              class="-mt-1.5 -ml-1.5"
              color="primary"
              density="compact"
            />
            <span class="flex flex-col gap-0.5 pt-px">
              Keep the provider's tokens
              <span class="text-[11px] leading-4 text-ink/50">
                Off unless you call {{ info.label }}'s API as the user. A refresh token is a
                standing grant on somebody's account, and one nobody uses is a liability
                rather than a feature. Stored envelope encrypted either way.
              </span>
            </span>
          </label>
        </div>

        <footer
          class="flex flex-none items-center justify-between gap-3 border-t border-line px-5 py-3.5"
        >
          <p class="m-0 text-[11px] text-ink/45">
            {{
              config?.enabled
                ? "Applies to the next sign-in. Nobody is signed out."
                : `Saving turns ${info.label} on for this project.`
            }}
          </p>
          <div class="flex items-center gap-2">
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
              :loading="busy"
              class="text-xs font-medium"
              color="primary"
              size="small"
              type="submit"
              variant="flat"
            >
              {{ editing ? "Save changes" : `Add ${info.label}` }}
            </v-btn>
          </div>
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
