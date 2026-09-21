<script setup lang="ts">
/**
 * One auth domain's setup: the two records, the check that looks for them, and the two
 * steps that come after verification and are not ours to perform.
 *
 * A dialog opened from a row, the way the revocation and sending-domain setups open. The
 * list is what the screen is about, and a block under it pushed everything else off the
 * fold and made changing which domain you were reading a scroll back up.
 *
 * The five steps are the note's, and the last two are the reason the shape exists.
 * Verification and client migration are different acts: a verified host does not change a
 * deployed base URL and does not make an unrelated application origin same-site with it.
 * So `Update SDK` hands over the exact URL and says nothing has happened until it ships,
 * and `Test` names what its check covers and — the part a green tick would hide — what it
 * cannot see from here.
 */
import type { Step } from "~/components/Steps.vue";
import type { SetupProbe } from "~/utils/auth-domains";
import {
  AUTH_RECORD_INFO,
  AUTH_SETUP_STEPS,
  type AuthDomain,
  type AuthSetupStage,
  apiBaseUrl,
  authNextStep,
  authSetupStage,
  certificateAuthorised,
  dnsFound,
  RECORD_STATUS_LABELS,
  siteOf,
} from "~/utils/auth-domains";
import { formatDateTime, relativeTime } from "~/utils/time";

const props = defineProps<{
  domain: AuthDomain;
  /** The origins already on the CORS allowlist, which the test offers as choices. */
  origins: readonly string[];
  /** The last probe, or null while nothing has been run in this project. */
  probe: SetupProbe | null;
  checking: boolean;
  busy: boolean;
  /** Why a check did not run. Never a finding about the domain, which is the records' job. */
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  recheck: [];
  verify: [origin: string];
  remove: [];
}>();

const now = useNow({ interval: 30_000 });
const titleId = `${useId()}-title`;

const { lgAndUp } = useDisplay();

const tested = computed(() => props.probe !== null && props.probe.host === props.domain.domain);

/** The step with the work in it, which is where the dialog opens. */
const stage = computed<AuthSetupStage>(() => authSetupStage(props.domain, tested.value));

/**
 * How far the reader may walk, which is further than the work has got.
 *
 * A verified host may always reach the test, because updating the SDK is not something
 * this end can observe: gating the last step on it would leave the check unreachable for
 * exactly the domain it is for.
 */
const reached = computed<AuthSetupStage>(() =>
  props.domain.status === "verified" ? "test" : stage.value,
);

/* Opened on the step with work in it, and free to walk after that: somebody who came back
   to copy a record must not have to step past two they are not changing. */
const step = ref<AuthSetupStage>(stage.value);

watch(
  () => props.domain.id,
  () => {
    step.value = stage.value;
  },
);

/* A check that lands moves the reader on, because the answer is the next screen. */
watch(stage, (value) => {
  if (value !== step.value) step.value = value;
});

const steps = AUTH_SETUP_STEPS as readonly Step[];

function goto(id: string) {
  step.value = id as AuthSetupStage;
}

const baseUrl = computed(() => apiBaseUrl(props.domain.domain));

/* Seeded at setup rather than on `open`: the page mounts this component only while it is
   open, so a watcher on the model never fires and the field would open empty. */
const origin = ref(props.origins[0] ?? "");

const originAllowed = computed(() => props.origins.includes(origin.value.trim()));

const checkedAgo = computed(() =>
  props.domain.checkedAt === null ? "" : relativeTime(props.domain.checkedAt, now.value),
);

const RECORD_MARKS: Record<string, { icon: string; tone: string }> = {
  found: { icon: "material-symbols:check-circle-outline", tone: "text-success" },
  missing: { icon: "material-symbols:error-outline", tone: "text-warning" },
  pending: { icon: "material-symbols:pending-outline", tone: "text-ink/40" },
};

const SDK_SNIPPET = computed(
  () => `const idenzy = new Idenzy({
  publishableKey: "pk_…",
  apiBaseUrl: "${baseUrl.value}",
});`,
);
</script>

<template>
  <!-- `width` as well as `max-width`: a cap alone lets a multi-step dialog size itself to
       its narrowest step and rewrap at every other one. -->
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 820 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
  >
    <v-card border flat>
      <div :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'" class="flex flex-col">
        <header class="flex flex-none flex-col gap-2.5 px-5 py-3.5">
          <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div class="flex min-w-0 flex-col gap-0.5">
              <h2 :id="titleId" class="m-0 font-mono text-sm break-all text-ink">
                {{ domain.domain }}
              </h2>
              <p class="m-0 text-xs leading-5 text-ink/55">{{ authNextStep(domain, tested) }}</p>
            </div>
            <div class="flex flex-none items-center gap-2">
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                prepend-icon="material-symbols:delete-outline"
                size="small"
                variant="text"
                @click="emit('remove')"
              >
                Remove
              </v-btn>
              <v-btn
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="outlined"
                @click="open = false"
              >
                Close
              </v-btn>
            </div>
          </div>
          <Steps :current="step" :reached="reached" :steps="steps" @select="goto" />
        </header>

        <div
          class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-line px-5 py-5"
        >
          <!-- 1 · Host ---------------------------------------------------------- -->
          <template v-if="step === 'host'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">The host you chose</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                An API host and never a page. Your own sign-in screen stays where you built
                it; what changes is the URL its
                <span class="font-mono">fetch</span> calls go to.
              </p>
            </div>
            <dl
              class="m-0 grid grid-cols-1 gap-px rounded-(--idenzy-radius-small) bg-line ring-1 ring-ink/6 sm:grid-cols-2"
            >
              <div class="flex flex-col gap-1 bg-surface p-3.5">
                <dt class="text-[11px] leading-4 text-ink/45">API base URL</dt>
                <dd class="m-0 font-mono text-xs break-all text-ink">{{ baseUrl }}</dd>
              </div>
              <div class="flex flex-col gap-1 bg-surface p-3.5">
                <dt class="text-[11px] leading-4 text-ink/45">Same-site with</dt>
                <dd class="m-0 font-mono text-xs break-all text-ink">
                  {{ siteOf(domain.domain) }}
                </dd>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  Any page under this site can hold a cookie set by the host.
                </dd>
              </div>
            </dl>
          </template>

          <!-- 2 and 3 · The records --------------------------------------------- -->
          <template v-else-if="step === 'dns' || step === 'certificate'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">
                {{ step === "dns" ? "Publish the CNAME" : "Publish the authorisation record" }}
              </h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                Both go in the zone that answers for
                <span class="font-mono text-ink/75">{{ siteOf(domain.domain) }}</span
                >. Nothing here is built by the panel: a value is what arrived on the row, so
                what you copy is what a check looks for.
              </p>
            </div>

            <ul class="m-0 flex list-none flex-col gap-3 p-0">
              <li
                v-for="record in domain.records"
                :key="record.kind"
                class="flex flex-col gap-2.5 rounded-(--idenzy-radius-small) bg-ink/4 p-3.5 ring-1 ring-ink/6 ring-inset"
              >
                <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="text-xs font-medium text-ink">
                      {{ AUTH_RECORD_INFO[record.kind].label }}
                    </span>
                    <span class="font-mono text-[10px] leading-4 text-ink/55">
                      {{ AUTH_RECORD_INFO[record.kind].type }}
                    </span>
                  </span>
                  <span
                    :class="RECORD_MARKS[record.status]?.tone"
                    class="flex flex-none items-center gap-1.5 text-[11px]"
                  >
                    <Icon
                      :name="
                        RECORD_MARKS[record.status]?.icon ?? 'material-symbols:pending-outline'
                      "
                      aria-hidden="true"
                      class="flex-none text-sm"
                    />
                    {{ RECORD_STATUS_LABELS[record.status] }}
                  </span>
                </div>

                <div class="grid gap-2 sm:grid-cols-2">
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-[10px] leading-4 text-ink/45">Name</span>
                    <CopyField
                      :label="`Copy the name for the ${AUTH_RECORD_INFO[record.kind].label}`"
                      :value="record.name"
                      dense
                      wrap
                    />
                  </div>
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-[10px] leading-4 text-ink/45">Points at</span>
                    <CopyField
                      :label="`Copy the value for the ${AUTH_RECORD_INFO[record.kind].label}`"
                      :value="record.value"
                      dense
                      wrap
                    />
                  </div>
                </div>

                <p class="m-0 text-[11px] leading-4 text-ink/55">
                  {{ AUTH_RECORD_INFO[record.kind].purpose }}
                </p>
              </li>
            </ul>

            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                <template v-if="checkedAgo">
                  Last checked {{ checkedAgo }} ({{ formatDateTime(domain.checkedAt ?? "") }}).
                </template>
                <!-- Nothing looks on a schedule, so a reader waiting for one would wait
                     forever. A check happens because somebody asks for it. -->
                <template v-else>
                  Not checked yet. Nothing looks on its own: publish both records and run the
                  check.
                </template>
              </p>
              <v-btn
                :loading="busy"
                class="text-xs font-medium"
                color="primary"
                prepend-icon="material-symbols:refresh"
                size="small"
                variant="flat"
                @click="emit('recheck')"
              >
                Check DNS
              </v-btn>
            </div>
          </template>

          <!-- 4 · Update the SDK, which is theirs to do ------------------------- -->
          <template v-else-if="step === 'sdk'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Point your client at it</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                The host is verified and answers for this project. Nothing about a deployed
                application changes on its own: until this ships, your users are still on the
                shared host and still in header mode.
              </p>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-xs font-medium text-ink">API base URL</span>
              <CopyField :value="baseUrl" label="Copy the API base URL" wrap />
            </div>

            <SamplePanel
              meta="Illustrative"
              note="Your publishable key is on the API keys screen. The base URL is the only line this host changes."
              title="In your client"
            >
              <pre
                class="m-0 overflow-x-auto font-mono text-[11px] leading-5 whitespace-pre text-ink"
              >{{ SDK_SNIPPET }}</pre>
            </SamplePanel>

            <p class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/55">
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm"
                name="material-symbols:info-outline"
              />
              <span>
                Leave the transport alone. `auto` asks for cookie mode and steps down to
                header mode once if the server says it is unavailable, and naming a mode
                explicitly turns that negotiation off in both directions.
              </span>
            </p>
          </template>

          <!-- 5 · The test, and what it does not cover -------------------------- -->
          <template v-else>
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Test it from an application origin</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                The check resolves this host's records from our side. It says the name points at
                us, the certificate is authorised, the project answers by Host, and whether a
                browser on the origin you name would be allowed to call it.
              </p>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-ink" for="auth-test-origin">
                Your app origin
              </label>
              <v-combobox
                id="auth-test-origin"
                v-model="origin"
                :items="origins"
                autocomplete="off"
                class="font-mono"
                density="comfortable"
                hide-details
                placeholder="https://app.example.com"
                variant="filled"
              />
              <p class="m-0 text-[11px] leading-4 text-ink/50">
                <template v-if="origins.length === 0">
                  Nothing is on the CORS allowlist yet, so any origin named here is refused by
                  the browser. Allowed origins is where that list lives.
                </template>
                <template v-else-if="origin.trim() !== '' && !originAllowed">
                  Not on the CORS allowlist. The check will say so rather than guess.
                </template>
                <template v-else>
                  The origins already on this project's CORS allowlist are offered here.
                </template>
              </p>
            </div>

            <ul v-if="probe" class="m-0 flex list-none flex-col gap-2 p-0" role="status">
              <li
                v-for="line in probe.lines"
                :key="line.label"
                class="flex items-start gap-2.5 rounded-(--idenzy-radius-small) bg-ink/4 p-3 ring-1 ring-ink/6 ring-inset"
              >
                <Icon
                  :class="line.ok ? 'text-success' : 'text-warning'"
                  :name="
                    line.ok
                      ? 'material-symbols:check-circle-outline'
                      : 'material-symbols:error-outline'
                  "
                  aria-hidden="true"
                  class="mt-px flex-none text-base"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="text-xs leading-4 font-medium text-ink">{{ line.label }}</span>
                  <span class="text-[11px] leading-4 text-ink/55">{{ line.detail }}</span>
                </span>
              </li>
            </ul>

            <!-- The half a green tick would hide. -->
            <p class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/55">
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm"
                name="material-symbols:info-outline"
              />
              <span>
                What it cannot see is your own build. A pass here does not mean a deployed
                client is calling this host, and it does not make an application on another
                site same-site with it.
              </span>
            </p>
          </template>
        </div>

        <footer
          class="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
        >
          <!-- A refusal here is about the check and not about the domain: the records say
               what is true of the domain, and they are a scroll away. -->
          <p v-if="error" class="m-0 text-[11px] leading-4 text-error" role="alert">{{ error }}</p>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/50">
            <template v-if="dnsFound(domain) && certificateAuthorised(domain)">
              Both records found. The host resolves and the certificate is authorised.
            </template>
            <template v-else-if="dnsFound(domain)">
              The CNAME is found and the authorisation record is not.
            </template>
            <template v-else>Neither record has been seen yet.</template>
          </p>
          <v-btn
            v-if="step === 'test'"
            :loading="checking"
            class="text-xs font-medium"
            color="primary"
            prepend-icon="material-symbols:play-arrow-outline"
            size="small"
            variant="flat"
            @click="emit('verify', origin)"
          >
            Verify setup
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
