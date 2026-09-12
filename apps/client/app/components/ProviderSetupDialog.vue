<script setup lang="ts">
/**
 * Setting up one provider, as the four things it actually takes rather than one form.
 *
 * The steps are the shape of the work and they exist because two of them are about
 * different URLs that both wear the word "redirect". Step two is ours: the callback the
 * provider console has to hold, fixed by the deployment, copied out of here and pasted
 * over there. Step three is theirs: the route in their own application we send the
 * browser to afterwards with a code. Registering one where the other belongs is the way a
 * first setup fails, and it fails at the provider's consent screen where the user sees an
 * error and the operator sees nothing, so the two are separated by a step and each says
 * what the other is.
 *
 * The secret goes one way. It is stored envelope encrypted under the project's data key
 * and the panel is never told what it is, so on a provider that already has one the field
 * is a replacement and leaving it blank keeps what is stored. Clearing is not offered: a
 * provider without a secret cannot finish a sign-in, and removing it from the project is
 * the honest way to say that.
 *
 * The last step is a test rather than a summary, and the one thing it cannot check is
 * said out loud: whether the provider console holds our callback is only ever settled by
 * a real sign-in, because a wrong redirect URI is refused before we are called at all. A
 * project on a custom auth domain can start one from here in a new tab, since a top-level
 * navigation resolves a project by `Host` alone; a project on the shared host cannot, and
 * gets the SDK call to run from its own application instead.
 *
 * Opened over a provider that already exists, the steps are tabs rather than a funnel:
 * somebody rotating a secret must not have to walk past two steps they are not changing.
 *
 * Both credential fields are named and the secret is marked `new-password`, which is what
 * keeps a password manager out of them. A text field followed by a password field is a
 * sign-in form as far as the browser is concerned, and it will put the operator's own
 * address in the client id and their panel password in the secret, which saves cleanly
 * and fails at the provider.
 */
import type { Step } from "~/components/Steps.vue";
import { originOf } from "~/utils/origins";
import {
  ASSERTION_LOOK,
  callbackUri,
  draftFrom,
  evaluateProviderChecks,
  INSTANT_HOSTS,
  issueFor,
  MODE_LABELS,
  missingFor,
  type ProviderDraft,
  type ProviderName,
  providerInfo,
  returnUrisMissingOrigin,
  validateProvider,
} from "~/utils/providers";
import { CHECK_MARKS, CHECK_WORDS } from "~/utils/setup-check";
import { relativeTimeWords } from "~/utils/time";

type StepId = "provider" | "credentials" | "return" | "test";

const props = withDefaults(
  defineProps<{
    /** The provider being managed. Null opens the catalogue and adds a new one. */
    provider: ProviderName | null;
    /** Which step to open on, for a row whose button names one. */
    startAt?: StepId | "";
  }>(),
  { startAt: "" },
);

const open = defineModel<boolean>({ required: true });

const projects = useProjectStore();
const store = useProvidersStore();
const origins = useOriginsStore();
const authDomains = useAuthDomainsStore();
const { copy, copied } = useClipboard({ copiedDuring: 1400, legacy: true });

const now = useNow({ interval: 60_000 });

const apiBase = useAuthApiBase();

const ADD_STEPS: readonly Step[] = [
  { id: "provider", label: "Provider" },
  { id: "credentials", label: "Callback & credentials" },
  { id: "return", label: "Return URL" },
  { id: "test", label: "Test" },
];

/* Managing an existing provider is not choosing one, so that step is gone rather than
   ticked: a step nobody may take is not a step. */
const MANAGE_STEPS = ADD_STEPS.filter((entry) => entry.id !== "provider");

const editing = computed(() => props.provider !== null);
const steps = computed(() => (editing.value ? MANAGE_STEPS : ADD_STEPS));

const step = ref<StepId>("provider");
const chosen = ref<ProviderName | null>(null);
const draft = ref<ProviderDraft | null>(null);
const tried = ref(false);
const advanced = ref(false);
const saving = ref(false);
const testing = ref(false);

/** The provider the dialog is about: the one it was opened over, or the one picked. */
const info = computed(() => {
  const id = props.provider ?? chosen.value;
  return id === null ? null : providerInfo(id);
});

const config = computed(() =>
  info.value === null ? null : store.configFor(projects.current.id, info.value.id),
);

const saved = computed(() => config.value !== null);
const callback = computed(() => (info.value ? callbackUri(apiBase.value, info.value.id) : ""));

const configuredNames = computed(
  () => Object.keys(store.forProject(projects.current.id)) as ProviderName[],
);

const returnUris = computed(() => store.returnUrisFor(projects.current.id));
const allowedOrigins = computed(() =>
  origins.forProject(projects.current.id).map((entry) => entry.origin),
);

/*
 * Every opening is a fresh pass. A dialog that came back holding the last provider's
 * draft would write one project's client id into another's row.
 */
watch(open, (opened) => {
  if (!opened) return;
  chosen.value = props.provider;
  draft.value = info.value ? draftFrom(info.value, config.value) : null;
  tried.value = false;
  advanced.value = false;
  step.value = pickStart();
});

function pickStart(): StepId {
  if (props.startAt !== "" && steps.value.some((entry) => entry.id === props.startAt)) {
    return props.startAt;
  }
  return editing.value ? "credentials" : "provider";
}

/* Choosing a provider in the catalogue replaces the draft, because the fields, the
   secret's shape and the defaults all belong to the provider rather than to the form. */
watch(chosen, (id) => {
  if (props.provider !== null) return;
  const picked = id === null ? null : providerInfo(id);
  draft.value = picked ? draftFrom(picked, null) : null;
  tried.value = false;
});

/**
 * How far the reader may jump. A record that already exists is complete enough for every
 * step to mean something; one being added is not, so the list stays a funnel until the
 * credentials are written.
 */
const reached = computed(() => (saved.value ? "test" : ""));

const issues = computed(() =>
  info.value === null || draft.value === null
    ? []
    : validateProvider(info.value, draft.value, config.value?.secretSet === true),
);

/** A reason is shown once the reader has tried to move on, not while they are typing. */
function reason(field: string): string {
  if (!tried.value || info.value === null) return "";
  return issueFor(info.value, issues.value, field);
}

const mode = computed({
  get: () => draft.value?.mode ?? "custom",
  set: (value: string) => {
    if (draft.value && (value === "instant" || value === "custom")) draft.value.mode = value;
  },
});

const MODE_OPTIONS = [
  { value: "custom", label: MODE_LABELS.custom.label },
  { value: "instant", label: MODE_LABELS.instant.label },
];

const revealed = ref(false);
const defaults = computed(() => info.value?.defaultScopes ?? []);
const assertion = computed(() => (info.value ? ASSERTION_LOOK[info.value.email] : null));

/*
 * Moving between the steps.
 */

/* A step that is not in the current list cannot be shown, and leaving one there would
   render the catalogue over a provider that is already chosen. */
watch(
  steps,
  (list) => {
    if (!list.some((entry) => entry.id === step.value)) step.value = list[0]?.id as StepId;
  },
  { immediate: true },
);

const at = computed(() => {
  const index = steps.value.findIndex((entry) => entry.id === step.value);
  return index === -1 ? 0 : index;
});
const first = computed(() => at.value <= 0);
const last = computed(() => at.value === steps.value.length - 1);

function goto(id: string) {
  if (steps.value.some((entry) => entry.id === id)) step.value = id as StepId;
}

function back() {
  const previous = steps.value[at.value - 1];
  if (previous) goto(previous.id);
}

/** What the footer's primary does, which is different on every step. */
const canContinue = computed(() => {
  if (step.value === "provider") return chosen.value !== null;
  return true;
});

async function advance() {
  if (step.value === "credentials") {
    tried.value = true;
    if (issues.value.length > 0) return;
  }
  if (step.value === "return") {
    await write();
    return;
  }
  const next = steps.value[at.value + 1];
  if (next) goto(next.id);
}

/**
 * The credential set as one write, because the fields are checked against each other and
 * a provider half saved fails at the token endpoint rather than in the panel. The step
 * advances on the write landing rather than on the click, so a refused save keeps the
 * values on screen.
 */
async function write() {
  if (info.value === null || draft.value === null) return;
  saving.value = true;
  try {
    await store.save(projects.current.id, info.value.id, { ...draft.value });
    goto("test");
  } finally {
    saving.value = false;
  }
}

/*
 * The last step.
 */

const checks = computed(() =>
  info.value === null || config.value === null
    ? []
    : evaluateProviderChecks(info.value, config.value, {
        returnUris: returnUris.value,
        allowedOrigins: allowedOrigins.value,
      }),
);

const returnUrlDialog = ref(false);
const returnBusy = ref(false);

async function addReturnUrl(uri: string, allowOrigin: boolean) {
  returnBusy.value = true;
  try {
    await store.addReturnUri(projects.current.id, uri);
    if (!allowOrigin) return;
    const origin = originOf(uri);
    if (origin !== null) await origins.add(projects.current.id, origin, "oauth");
  } finally {
    returnBusy.value = false;
  }
}

async function removeReturnUrl(uri: string) {
  returnBusy.value = true;
  try {
    await store.removeReturnUri(projects.current.id, uri);
  } finally {
    returnBusy.value = false;
  }
}

/**
 * Whether this URL's page could not read a credentialed response. The same rule the check
 * list uses, so a native scheme and a loopback host are not reported as gaps: one has no
 * origin at all and the other is refused by the allowlist whatever anybody does.
 */
function originGap(uri: string): boolean {
  return returnUrisMissingOrigin([uri], allowedOrigins.value).length > 0;
}

/** Which return URL the test comes back to. The first registered one is the usual answer. */
const testTarget = ref("");

watch(
  returnUris,
  (list) => {
    if (testTarget.value === "" || !list.includes(testTarget.value)) {
      testTarget.value = list[0] ?? "";
    }
  },
  { immediate: true },
);

/**
 * A verified custom auth domain, which is what decides whether a test can be started from
 * here at all. A top-level navigation carries neither our header nor an Authorization, so
 * the start route resolves a project by `Host` alone and only a domain of the customer's
 * own can name one.
 */
const authDomain = computed(
  () =>
    authDomains.forProject(projects.current.id).find((entry) => entry.status === "verified")
      ?.domain ?? null,
);

const testUrl = computed(() => {
  if (info.value === null || authDomain.value === null || testTarget.value === "") return "";
  const query = new URLSearchParams({ redirect_uri: testTarget.value });
  return `https://${authDomain.value}/v1/auth/oauth/${info.value.id}/start?${query.toString()}`;
});

/** The call a project on the shared host runs from its own application instead. */
const sdkCall = computed(() =>
  info.value === null
    ? ""
    : `await idenzy.signIn.withOAuth({\n  provider: "${info.value.id}",\n  redirectUri: "${testTarget.value || "https://app.example.com/auth/callback"}",\n});`,
);

/* Measured against the later of the clock and the stamp: the stamp is written after the
   tick that preceded it, and a clock behind it reads "in a few seconds" for a minute. */
const lastRun = computed(() => {
  const at = config.value?.testedAt;
  if (!at) return "";
  const stamp = new Date(at);
  return relativeTimeWords(at, now.value < stamp ? stamp : now.value);
});

/**
 * Records that a sign-in was run, never that it worked. Where it ended is the customer's
 * own return page, which is not this one, so a panel claiming a pass would be inventing
 * the half of the answer that matters.
 */
async function runTest() {
  if (info.value === null) return;
  testing.value = true;
  try {
    if (testUrl.value !== "") window.open(testUrl.value, "_blank", "noopener,noreferrer");
    await store.recordTest(projects.current.id, info.value.id);
  } finally {
    testing.value = false;
  }
}

const missing = computed(() =>
  info.value === null || config.value === null ? [] : missingFor(info.value, config.value),
);
</script>

<template>
  <v-dialog v-model="open" max-width="720" scrollable width="100%">
    <v-card border flat>
      <form class="flex max-h-[86vh] flex-col" @submit.prevent="advance">
        <!-- The steps are the dialog's title: what this is, and how far through it the
             reader is, in one line. -->
        <header
          class="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
        >
          <div class="flex min-w-0 items-center gap-3">
            <span
              v-if="info"
              aria-hidden="true"
              class="flex size-7 flex-none items-center justify-center text-ink"
            >
              <Icon
                :class="[info.monochrome ? '[.v-theme--dark_&]:invert' : '', info.tint ?? '']"
                :name="info.icon"
                class="text-[22px]"
              />
            </span>
            <Steps :current="step" :reached="reached" :steps="steps" @select="goto" />
          </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-line px-5 py-5">
          <!-- 1 · Provider ------------------------------------------------------ -->
          <template v-if="step === 'provider'">
            <div class="flex flex-col gap-1">
              <h2 class="m-0 text-sm font-medium text-ink">Which provider?</h2>
              <p class="m-0 text-xs leading-5 text-ink/60">
                Each one is an endpoint pair and a profile mapping over the same checked flow.
                What differs between them is what they tell us about an address, and that is
                shown once you have picked one.
              </p>
            </div>

            <ProviderCatalogue v-model="chosen" :configured="configuredNames" />

            <!-- The caveats belong here rather than on eighteen cards: after a choice, and
                 before any credentials are pasted. -->
            <SamplePanel
              v-if="info && assertion"
              :meta="info.protocol === 'oidc' ? 'OpenID Connect' : 'OAuth 2.0'"
              :title="`What ${info.label} is like`"
            >
              <SampleLine :icon="assertion.icon">
                <span class="font-medium">{{ assertion.label }}.</span>
                {{ info.emailNote }}
              </SampleLine>
              <SampleLine class="mt-2" icon="material-symbols:info-outline" tone="muted">
                {{ info.note }}
              </SampleLine>
            </SamplePanel>
          </template>

          <!-- 2 · Callback and credentials ------------------------------------- -->
          <template v-else-if="step === 'credentials' && info && draft">
            <div class="flex flex-col gap-1">
              <h2 class="m-0 text-sm font-medium text-ink">
                Register at {{ info.label }}, then paste what it gives you
              </h2>
              <p class="m-0 text-xs leading-5 text-ink/60">
                The callback below is ours and goes in the provider console. A redirect URI
                that console does not hold is refused before we are ever called, which is why
                it is the first thing here and not the last.
              </p>
            </div>

            <section class="flex flex-col gap-2">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h3 class="m-0 text-xs font-medium text-ink">Callback URL &middot; goes at {{ info.label }}</h3>
                <a
                  :href="info.console.href"
                  class="inline-flex items-center gap-1 text-[11px] font-medium text-ink no-underline hover:underline"
                  rel="noopener"
                  target="_blank"
                >
                  {{ info.console.label }}
                  <Icon aria-hidden="true" class="text-xs" name="material-symbols:open-in-new" />
                </a>
              </div>
              <CopyField :value="callback" label="Copy the callback URL" />
              <p class="m-0 text-[11px] leading-4 text-ink/50">
                Not the route in your application. We finish the exchange here and then send
                the browser to a URL you register in the next step, carrying a single-use code.
              </p>
            </section>

            <section class="flex flex-col gap-2">
              <h3 class="m-0 text-xs font-medium text-ink">Credentials</h3>
              <SegmentedControl v-model="mode" :options="MODE_OPTIONS" label="Credentials" />
              <p class="m-0 text-[11px] leading-4 text-ink/50">
                {{ MODE_LABELS[draft.mode].detail }}
              </p>

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
                  v-model="draft.clientId"
                  :error="reason('clientId') !== ''"
                  autocomplete="off"
                  class="font-mono"
                  hide-details
                  name="idenzy-oauth-client-id"
                  variant="filled"
                />
                <p
                  :class="reason('clientId') ? 'text-error' : 'text-ink/50'"
                  class="m-0 text-[11px]"
                >
                  {{ reason("clientId") || "Public, and carried on every authorization URL." }}
                </p>
              </div>

              <div class="flex flex-col gap-1.5">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <label class="text-xs font-medium text-ink" for="provider-client-secret">
                    {{ info.secret.label }}
                  </label>
                  <span v-if="config?.secretSet" class="text-[11px] text-ink/50">
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
                <label :for="`provider-${field.key}`" class="text-xs font-medium text-ink">
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
                <p
                  :class="reason(field.key) ? 'text-error' : 'text-ink/50'"
                  class="m-0 text-[11px]"
                >
                  {{ reason(field.key) || field.hint }}
                </p>
              </div>
            </template>

            <!-- Optional scopes and provider-token storage sit below the standard
                 credentials and folded, because a first setup needs neither. -->
            <div class="rounded-(--idenzy-radius) border border-line">
              <button
                :aria-expanded="advanced"
                class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-(--idenzy-radius) bg-transparent px-3 py-2.5 text-left transition-colors duration-150 hover:bg-ink/3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                type="button"
                @click="advanced = !advanced"
              >
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-xs font-medium text-ink">Scopes and provider tokens</span>
                  <span class="text-[11px] leading-4 text-ink/50">
                    {{
                      draft.customScopes
                        ? "Scopes of your own"
                        : defaults.length === 0
                          ? "No scopes to request"
                          : `${defaults.length} default scopes`
                    }}
                    &middot;
                    {{ draft.storeTokens ? "keeping the provider's tokens" : "no tokens kept" }}
                  </span>
                </span>
                <Icon
                  :class="advanced ? 'rotate-180' : ''"
                  aria-hidden="true"
                  class="flex-none text-lg text-ink/50 transition-transform duration-200"
                  name="material-symbols:keyboard-arrow-down"
                />
              </button>

              <div v-if="advanced" class="border-t border-line px-3 py-3">
              <section class="flex flex-col gap-2">
                <h3 class="m-0 text-xs font-medium text-ink">Scopes</h3>
                <p v-if="defaults.length === 0" class="m-0 text-[11px] leading-4 text-ink/55">
                  {{ info.label }} takes no scopes. What the integration may do is configured
                  on the integration itself, so nothing is requested here.
                </p>
                <template v-else>
                  <ul class="m-0 flex list-none flex-wrap gap-1 p-0">
                    <li
                      v-for="scope in defaults"
                      :key="scope"
                      class="rounded-full bg-ink/4 ring-1 ring-ink/6 ring-inset px-2 py-0.5 font-mono text-[10px] leading-4 text-ink/65"
                    >
                      {{ scope }}
                    </li>
                  </ul>
                  <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
                    <v-checkbox-btn
                      v-model="draft.customScopes"
                      class="-mt-1.5 -ml-1.5 flex-none"
                      color="primary"
                      density="compact"
                    />
                    <span class="flex flex-col gap-0.5 pt-px">
                      Ask for different scopes
                      <span class="text-[11px] text-ink/50">
                        Replaces the list above. A scope the provider has not granted the app
                        is refused at the consent screen, where the user sees it and you do
                        not.
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

              <label class="mt-4 flex cursor-pointer items-start gap-2 text-xs text-ink">
                <v-checkbox-btn
                  v-model="draft.storeTokens"
                  class="-mt-1.5 -ml-1.5 flex-none"
                  color="primary"
                  density="compact"
                />
                <span class="flex flex-col gap-0.5 pt-px">
                  Keep the provider's tokens
                  <span class="text-[11px] leading-4 text-ink/50">
                    Off unless you call {{ info.label }}'s API as the user. A refresh token is
                    a standing grant on somebody's account, and one nobody uses is a liability
                    rather than a feature. Stored envelope encrypted either way.
                  </span>
                </span>
              </label>
              </div>
            </div>
          </template>

          <!-- 3 · Return URL ---------------------------------------------------- -->
          <template v-else-if="step === 'return' && info">
            <div class="flex flex-col gap-1">
              <h2 class="m-0 text-sm font-medium text-ink">Where your application takes over</h2>
              <p class="m-0 text-xs leading-5 text-ink/60">
                The other URL, and the one that is yours. Once
                {{ info.label }} returns to our callback and we have verified it, we send the
                browser here with a single-use code your page exchanges for a session. The
                list belongs to the project, so every provider on it returns to the same
                routes.
              </p>
            </div>

            <ul
              v-if="returnUris.length > 0"
              class="m-0 list-none divide-y divide-line rounded-(--idenzy-radius) border border-line p-0"
            >
              <li
                v-for="uri in returnUris"
                :key="uri"
                class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-2"
              >
                <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
                  <Icon class="text-[15px] text-ink/45" name="material-symbols:link" />
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="truncate font-mono text-xs leading-4 text-ink">{{ uri }}</span>
                  <span
                    v-if="originGap(uri)"
                    class="flex items-center gap-1 text-[11px] leading-4 text-warning"
                  >
                    <Icon
                      aria-hidden="true"
                      class="flex-none text-xs"
                      name="material-symbols:error-outline"
                    />
                    Its origin is not on the CORS allowlist, so the exchange call is refused by
                    the browser
                  </span>
                </span>
                <v-btn
                  :disabled="returnBusy"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="text"
                  @click="removeReturnUrl(uri)"
                >
                  Remove
                </v-btn>
              </li>
            </ul>
            <p
              v-else
              class="m-0 rounded-(--idenzy-radius) border border-dashed border-line px-3 py-4 text-center text-xs text-ink/50"
            >
              None registered, so a sign-in cannot be started at all. The route your quickstart
              adds is the usual first one.
            </p>

            <div class="flex flex-wrap items-center gap-3">
              <v-btn
                :loading="returnBusy"
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:add"
                size="small"
                variant="outlined"
                @click="returnUrlDialog = true"
              >
                Add return URL
              </v-btn>
              <NuxtLink
                class="inline-flex items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
                to="/domains/origins"
              >
                Check the CORS allowlist
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
              </NuxtLink>
            </div>

            <SamplePanel
              meta="Two different lists"
              note="Neither is derived from the other, and adding one never adds the other. Landing on a page and reading a credentialed response from it are different privileges."
              title="What each URL is for"
            >
              <SampleLine icon="material-symbols:hub-outline">
                <span class="font-medium">Our callback.</span> Goes in the
                {{ info.label }} console. Fixed by the deployment.
              </SampleLine>
              <SampleLine class="mt-1.5" icon="material-symbols:link">
                <span class="font-medium">Your return URL.</span> Goes in the list above. We
                send the browser here with a code.
              </SampleLine>
              <SampleLine class="mt-1.5" icon="material-symbols:public">
                <span class="font-medium">Your CORS origin.</span> A separate list on Allowed
                origins. Without it the page cannot exchange the code.
              </SampleLine>
            </SamplePanel>
          </template>

          <!-- 4 · Test ---------------------------------------------------------- -->
          <template v-else-if="step === 'test' && info">
            <div class="flex flex-col gap-1">
              <h2 class="m-0 text-sm font-medium text-ink">
                {{ info.label }} is saved. Now see whether it works.
              </h2>
              <p class="m-0 text-xs leading-5 text-ink/60">
                Everything below is read from this project's own configuration, so it answers
                the moment something changes.
              </p>
            </div>

            <ul class="m-0 list-none divide-y divide-line rounded-(--idenzy-radius) border border-line p-0">
              <li
                v-for="check in checks"
                :key="check.id"
                class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 px-3 py-2.5"
              >
                <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
                  <Icon
                    :class="CHECK_MARKS[check.state].tone"
                    :name="CHECK_MARKS[check.state].icon"
                    class="text-base"
                  />
                </span>
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="text-xs leading-4 font-medium text-ink">{{ check.label }}</span>
                    <span :class="CHECK_MARKS[check.state].tone" class="text-[11px] leading-4">
                      {{ CHECK_WORDS[check.state] }}
                    </span>
                  </span>
                  <span class="text-[11px] leading-4 text-ink/60">{{ check.finding }}</span>
                  <NuxtLink
                    v-if="check.fix"
                    :to="check.fix.to"
                    class="inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
                  >
                    {{ check.fix.label }}
                    <Icon
                      aria-hidden="true"
                      class="text-sm"
                      name="material-symbols:chevron-right"
                    />
                  </NuxtLink>
                </span>
              </li>
            </ul>

            <!-- The check that cannot be run, stated rather than drawn as one that passed. -->
            <p
              class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset px-3 py-2.5 text-[11px] leading-4 text-ink/70"
            >
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm text-ink/45"
                name="material-symbols:help-outline"
              />
              <span>
                Whether the {{ info.label }} console holds our callback is the one thing this
                end cannot see. A redirect URI that does not match is refused at their consent
                screen, before we are called at all, so only a real sign-in settles it.
              </span>
            </p>

            <section class="flex flex-col gap-3">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h3 class="m-0 text-xs font-medium text-ink">Run a real sign-in</h3>
                <span v-if="lastRun" class="text-[11px] text-ink/50">Last run {{ lastRun }}</span>
              </div>

              <div v-if="returnUris.length > 1" class="flex flex-col gap-1.5">
                <label class="text-xs font-medium text-ink" for="provider-test-target">
                  Come back to
                </label>
                <v-select
                  id="provider-test-target"
                  v-model="testTarget"
                  :items="[...returnUris]"
                  class="font-mono"
                  hide-details
                  variant="filled"
                />
              </div>

              <template v-if="authDomain">
                <p class="m-0 text-[11px] leading-4 text-ink/60">
                  Opens {{ info.label }}'s consent screen in a new tab on
                  <span class="font-mono text-ink/80">{{ authDomain }}</span
                  >, your own auth domain. Nothing here is lost, and where it ends is the page
                  you picked above rather than this one: a sign-in that lands there with a code
                  is a working provider.
                </p>
                <div class="flex flex-wrap items-center gap-2">
                  <v-btn
                    :disabled="testTarget === ''"
                    :loading="testing"
                    append-icon="material-symbols:open-in-new"
                    class="text-xs font-medium"
                    color="primary"
                    size="small"
                    variant="flat"
                    @click="runTest"
                  >
                    Start a test sign-in
                  </v-btn>
                  <span class="text-[11px] text-ink/45">
                    Recorded as run, never as passed. Only your return page knows how it ended.
                  </span>
                </div>
              </template>

              <template v-else>
                <p class="m-0 text-[11px] leading-4 text-ink/60">
                  A sign-in cannot be started from here on the shared API host. A top-level
                  navigation carries no publishable key, so the start route can only resolve a
                  project by <span class="font-mono">Host</span>, which needs an auth domain of
                  your own. Run it from your application instead, where the SDK asks for the
                  URL over JSON and navigates itself.
                </p>
                <SamplePanel meta="In your application" title="The call to run">
                  <pre class="m-0 overflow-x-auto font-mono text-[11px] leading-5 text-ink">{{ sdkCall }}</pre>
                </SamplePanel>
                <div class="flex flex-wrap items-center gap-2">
                  <v-btn
                    class="text-xs font-medium"
                    color="neutral"
                    :prepend-icon="
                      copied
                        ? 'material-symbols:check'
                        : 'material-symbols:content-copy-outline'
                    "
                    size="small"
                    variant="outlined"
                    @click="copy(sdkCall)"
                  >
                    {{ copied ? "Copied" : "Copy the call" }}
                  </v-btn>
                  <v-btn
                    :loading="testing"
                    class="text-xs font-medium"
                    color="neutral"
                    size="small"
                    variant="text"
                    @click="runTest"
                  >
                    I ran it
                  </v-btn>
                  <NuxtLink
                    class="inline-flex items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
                    to="/domains"
                  >
                    Add an auth domain
                    <Icon
                      aria-hidden="true"
                      class="text-sm"
                      name="material-symbols:chevron-right"
                    />
                  </NuxtLink>
                </div>
              </template>
            </section>

            <p v-if="missing.length > 0" class="m-0 text-[11px] leading-4 text-warning">
              {{ missing.join(" and ") }} {{ missing.length === 1 ? "is" : "are" }} still
              missing, so a sign-in will fail at the token endpoint after the user has already
              consented. Step {{ editing ? 1 : 2 }} is where that is settled.
            </p>
          </template>
        </div>

        <footer
          class="flex flex-none items-center justify-between gap-3 border-t border-line px-5 py-3"
        >
          <v-btn
            :disabled="first"
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:chevron-left"
            size="small"
            variant="text"
            @click="back"
          >
            Back
          </v-btn>

          <div class="flex items-center gap-2">
            <span v-if="step === 'return'" class="hidden text-[11px] text-ink/45 sm:inline">
              {{
                saved
                  ? "Applies to the next sign-in. Nobody is signed out."
                  : `Saving turns ${info?.label ?? "the provider"} on for this project.`
              }}
            </span>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              {{ last ? "Done" : "Cancel" }}
            </v-btn>
            <FancyButton v-if="!last" :disabled="!canContinue || saving" @click="advance">
              {{ step === "return" ? (saved ? "Save changes" : `Add ${info?.label}`) : "Continue" }}
              <Icon
                :class="saving ? 'animate-spin' : ''"
                :name="
                  saving
                    ? 'material-symbols:progress-activity'
                    : 'material-symbols:chevron-right'
                "
                aria-hidden="true"
                class="text-sm"
              />
            </FancyButton>
          </div>
        </footer>
      </form>
    </v-card>

    <ProviderReturnUrlDialog
      v-model="returnUrlDialog"
      :allowed-origins="allowedOrigins"
      :callback="callback"
      :return-uris="returnUris"
      @confirm="addReturnUrl"
    />
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
