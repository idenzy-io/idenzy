<script setup lang="ts">
/**
 * Attaching a revocation cache, as the three things it actually takes.
 *
 * The steps exist because the work is in two places and only one of them is here. Step
 * one is configuration a developer copies into their own server. Step two is a test this
 * end can run: it publishes an entry for a session that never existed and watches for the
 * read that carries it, and the synthetic id is the whole safety of it, because revoking
 * a real session to answer a question about configuration would sign somebody out.
 *
 * Step three is the half we cannot see at all. A read of the snapshot says a process
 * fetched it; it does not say that process would refuse a token, and it says nothing
 * about the other processes a customer runs. So the last step hands over a check to run
 * where the cache lives and records what the operator says they saw. It is a statement
 * they made, never a check we ran, and the panel says so wherever it quotes it.
 *
 * Opened over an integration already confirmed, the steps are tabs rather than a funnel:
 * somebody re-testing after a deploy must not have to walk past a step they are not
 * changing.
 */
import type { Step } from "~/components/Steps.vue";
import {
  cacheExample,
  POLL_SECONDS,
  PROBE_TIMEOUT_SECONDS,
  probeCheckExample,
  probeLatencySeconds,
  SETUP_STEPS,
  type SetupStepId,
  SNAPSHOT_PATH,
  type SnapshotEndpoint,
} from "~/utils/revocation";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  /** Where this project's snapshot is, derived by the page that owns the derivation. */
  endpoint: SnapshotEndpoint;
  /** How long an entry stays in the set, written out. The lifetimes screen owns it. */
  retentionLabel: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{ copy: [what: string] }>();

const projects = useProjectStore();
const store = useRevocationsStore();
const { copy } = useClipboard({ legacy: true });

const now = useNow({ interval: 1000 });

const titleId = `${useId()}-title`;

const projectId = computed(() => projects.current.id);
const probe = computed(() => store.probeFor(projectId.value));
const probing = computed(() => probe.value?.state === "running");
const confirmedAt = computed(() => store.confirmedAt(projectId.value));

const steps = SETUP_STEPS as readonly Step[];
const step = ref<SetupStepId>("configure");

/** A jump ahead is allowed as far as the reader has anything to see. */
const reached = computed<SetupStepId>(() => (probe.value === null ? "test" : "confirm"));

const at = computed(() => SETUP_STEPS.findIndex((entry) => entry.id === step.value));
const first = computed(() => at.value === 0);
const last = computed(() => at.value === SETUP_STEPS.length - 1);

/* Opened over an integration that has been tested, the reader starts where the work is
   rather than three steps behind it. */
watch(open, (showing) => {
  if (!showing) return;
  step.value = probe.value === null ? "configure" : confirmedAt.value === null ? "test" : "confirm";
});

function goto(id: string) {
  const found = SETUP_STEPS.find((entry) => entry.id === id);
  if (found !== undefined) step.value = found.id;
}

function back() {
  const previous = SETUP_STEPS[at.value - 1];
  if (previous !== undefined) step.value = previous.id;
}

function forward() {
  const next = SETUP_STEPS[at.value + 1];
  if (next !== undefined) step.value = next.id;
}

const snapshotUrl = computed(() => `${props.endpoint.issuerUrl}${SNAPSHOT_PATH}`);
const example = computed(() => cacheExample(props.endpoint.issuerUrl, projectId.value));
const confirmExample = computed(() => probeCheckExample(probe.value?.sessionId ?? "ses_probe_…"));

/** True once the panel has seen a poll carrying the probe, which gates step three. */
const observed = computed(() => probe.value?.state === "read");

function runTest() {
  store.runProbe(projectId.value);
  step.value = "test";
}

/**
 * Records the statement and leaves the dialog up. Dismissing on the click would hide the
 * one thing the reader came here to see land, and this step is a claim they may want to
 * make again after the next deploy rather than a form that is finished with.
 */
function confirmEnforcement() {
  store.confirm(projectId.value);
}

async function copyExample() {
  await copy(example.value);
  emit("copy", "Server example");
}

const GUIDE_URL = "https://idenzy.io/docs/tokens/revocation";
</script>

<template>
  <!-- `width` as well as `max-width`: a cap alone lets a multi-step dialog size itself to
       its narrowest step and rewrap at every other one. -->
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="760" scrollable width="100%">
    <v-card border flat>
      <div class="flex max-h-[86vh] flex-col">
        <header class="flex flex-none flex-col gap-2.5 px-5 py-3.5">
          <div class="flex min-w-0 flex-col gap-0.5">
            <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
              Verify revocation on {{ projects.current.name }}
            </h2>
            <p class="m-0 text-xs text-ink/55">
              Attaching a cache to a verifier you run, and checking that it holds what we
              publish. Nothing here changes this project.
            </p>
          </div>
          <Steps :current="step" :reached="reached" :steps="steps" @select="goto" />
        </header>

        <div
          class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto border-t border-line px-5 py-5"
        >
          <!-- 1 · Configure the SDK ---------------------------------------------- -->
          <template v-if="step === 'configure'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Build a cache in your server</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                One per process, built at startup and held: it owns a secret key and a
                polling timer, so its start and close belong to whoever owns the process.
                Attached to a verifier, it changes the answer rather than the shape of it.
              </p>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-1.5">
                <span class="text-xs font-medium text-ink">Snapshot URL</span>
                <CopyField :value="snapshotUrl" label="Copy the snapshot URL" />
                <span class="text-[11px] leading-4 text-ink/55">{{ endpoint.note }}</span>
              </div>
              <div class="flex min-w-0 flex-col gap-1.5">
                <span class="text-xs font-medium text-ink">Project ID</span>
                <CopyField :value="projectId" label="Copy the project ID" />
                <span class="text-[11px] leading-4 text-ink/55">
                  The audience of every token we sign for this project, and what the
                  snapshot names.
                </span>
              </div>
            </div>

            <div class="divide-y divide-line">
              <SettingRow label="The key it needs">
                <template #description>
                  A secret key, never a publishable one, and the endpoint refuses the prefix
                  before it looks anything up. The payload names accounts whose sessions were
                  all ended and times their security events, so it belongs on a server and in
                  an environment variable. Nothing in a browser bundle may hold it.
                </template>
                <template #actions>
                  <NuxtLink
                    class="flex items-center gap-1 text-xs font-medium whitespace-nowrap text-ink no-underline transition-colors hover:text-ink/60"
                    to="/keys"
                    @click="open = false"
                  >
                    API keys
                    <Icon
                      aria-hidden="true"
                      class="text-sm"
                      name="material-symbols:chevron-right"
                    />
                  </NuxtLink>
                </template>
              </SettingRow>
              <SettingRow
                :description="`Every instance polls, and the delay a revocation takes to reach a process is roughly one interval, so this is the number to move if seconds matter. It is not free: a fleet of pollers costs a conditional request each, answered 304 while the set is unchanged.`"
                :fixed="`${POLL_SECONDS}s`"
                label="How often it asks"
              />
            </div>

            <SamplePanel
              note="Written against this project and the host it answers on, so nothing here is a placeholder but the environment variable."
              title="On a Node server"
            >
              <template #meta>
                <v-btn
                  class="-my-1 text-[11px] font-medium"
                  color="neutral"
                  prepend-icon="material-symbols:content-copy-outline"
                  size="x-small"
                  variant="text"
                  @click="copyExample"
                >
                  Copy server example
                </v-btn>
              </template>
              <CodeBlock :code="example" />
            </SamplePanel>

            <p class="m-0 text-[11px] leading-4 text-ink/55">
              The options a cache takes, and how the five server-rendering helpers pass one
              through to the same verifier, are in the
              <a
                :href="GUIDE_URL"
                class="font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                rel="noopener"
                target="_blank"
                >revocation guide</a
              >.
            </p>
          </template>

          <!-- 2 · Run the test ---------------------------------------------------- -->
          <template v-else-if="step === 'test'">
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Publish an entry and watch for the read</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                The test publishes one entry for a session that never existed and watches for
                the poll that carries it. No session of yours is revoked to answer a question
                about configuration, and the entry ages out of the set on the ordinary
                schedule.
              </p>
            </div>

            <dl class="m-0 divide-y divide-line rounded-(--idenzy-radius-small) border border-line">
              <div class="grid gap-1 px-3.5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt class="text-xs font-medium text-ink">Synthetic session</dt>
                <dd class="m-0 flex min-w-0 flex-col gap-0.5">
                  <span class="truncate font-mono text-xs text-ink">
                    {{ probe?.sessionId ?? "Created when you run the test" }}
                  </span>
                  <span class="text-[11px] leading-4 text-ink/55">
                    An id nothing has ever held a token for, which is what makes running this
                    against a live project safe.
                  </span>
                </dd>
              </div>
              <div class="grid gap-1 px-3.5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt class="text-xs font-medium text-ink">Expected at your verifier</dt>
                <dd class="m-0 flex min-w-0 flex-col gap-0.5">
                  <span class="font-mono text-xs text-ink">isRevoked(…) === true</span>
                  <span class="text-[11px] leading-4 text-ink/55">
                    Within one poll of the entry being published, and for as long as the entry
                    is in the set.
                  </span>
                </dd>
              </div>
              <div class="grid gap-1 px-3.5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt class="text-xs font-medium text-ink">Observed here</dt>
                <dd class="m-0 flex min-w-0 flex-col gap-1">
                  <span v-if="probe === null" class="font-mono text-xs text-ink/45">Not run</span>
                  <span v-else-if="probe.state === 'running'" class="flex items-center gap-1.5">
                    <Icon
                      aria-hidden="true"
                      class="animate-spin text-sm text-ink/45"
                      name="material-symbols:progress-activity"
                    />
                    <span class="font-mono text-xs text-ink/70">Waiting for a read</span>
                  </span>
                  <span v-else-if="probe.state === 'read'" class="flex items-center gap-1.5">
                    <Icon
                      aria-hidden="true"
                      class="text-sm text-success"
                      name="material-symbols:check-circle-outline"
                    />
                    <span class="font-mono text-xs text-ink tabular-nums">
                      Read {{ probeLatencySeconds(probe) }}s after publishing
                    </span>
                  </span>
                  <span v-else class="flex items-center gap-1.5">
                    <Icon
                      aria-hidden="true"
                      class="text-sm text-warning"
                      name="material-symbols:error-outline"
                    />
                    <span class="font-mono text-xs text-ink">
                      No read in {{ PROBE_TIMEOUT_SECONDS }}s
                    </span>
                  </span>
                  <span class="text-[11px] leading-4 text-ink/55">
                    {{
                      probe === null
                        ? "This half is the snapshot being fetched. The other half is the last step, because a fetch is not a refusal."
                        : probe.state === "running"
                          ? `Nothing has read the set since the entry was published. A poller answers inside its own interval, and this gives up after ${PROBE_TIMEOUT_SECONDS} seconds.`
                          : probe.state === "read"
                            ? "Something holding this project's secret key fetched a snapshot carrying the entry. What it then did with a token is the last step."
                            : "Nothing fetched the set while the test was open, so no verifier of yours learned about the entry. Check that the process built a cache and that its secret key is this project's."
                    }}
                  </span>
                </dd>
              </div>
            </dl>
          </template>

          <!-- 3 · Confirm enforcement --------------------------------------------- -->
          <template v-else>
            <div class="flex flex-col gap-1">
              <h3 class="m-0 text-sm font-medium text-ink">Check what your own verifier holds</h3>
              <p class="m-0 text-xs leading-5 text-ink/60">
                The panel saw a snapshot fetched. Whether the process that fetched it would
                refuse a token is visible in that process alone, so this step is a check you
                run and a statement you make, and nothing here writes it for you.
              </p>
            </div>

            <SamplePanel
              v-if="probe !== null"
              :meta="`Probe ${probe.sessionId}`"
              note="Run it in the process you attached the cache to. Both lines read the copy it already holds, so neither one costs a request."
              title="What to check"
            >
              <CodeBlock :code="confirmExample" />
            </SamplePanel>
            <p
              v-else
              class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line px-3.5 py-3 text-xs leading-5 text-ink/60"
            >
              <Icon
                aria-hidden="true"
                class="mt-0.5 flex-none text-sm text-ink/45"
                name="material-symbols:info-outline"
              />
              Run the test first. The snippet needs the id of a probe entry, and an entry from
              an earlier run has aged out of the set by now.
            </p>

            <p class="m-0 text-[11px] leading-4 text-ink/55">
              The entry leaves the set after {{ retentionLabel }}, one access-token lifetime
              plus a minute of skew, and the same call then answers
              <span class="font-mono text-ink/75">false</span> again, correctly: by that point
              no token minted before the revocation can still be presented.
            </p>

            <p v-if="confirmedAt !== null" class="m-0 text-[11px] leading-4 text-ink/55">
              Last confirmed {{ relativeTimeWords(confirmedAt, now) }}. Confirming again
              replaces that, and neither one is a check we ran.
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
            <!-- The unmet requirement beside the control, rather than a disabled button
                 nobody can explain. -->
            <span v-if="last && !observed" class="hidden text-[11px] text-ink/45 sm:inline">
              {{
                probe === null
                  ? "Run the test first"
                  : probing
                    ? "Waiting for the read"
                    : "Nothing read the set, so there is nothing to confirm"
              }}
            </span>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Close
            </v-btn>

            <!-- Run test sits bottom right on its own step, which is where the one action
                 this dialog performs belongs. -->
            <v-btn
              v-if="step === 'test' && observed"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="runTest"
            >
              Run again
            </v-btn>

            <FancyButton v-if="step === 'configure'" @click="forward">
              Continue
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
            </FancyButton>
            <FancyButton v-else-if="step === 'test' && !observed" :disabled="probing" @click="runTest">
              {{ probe === null ? "Run test" : "Run test again" }}
              <Icon
                :class="probing ? 'animate-spin' : ''"
                :name="
                  probing
                    ? 'material-symbols:progress-activity'
                    : 'material-symbols:play-arrow-outline'
                "
                aria-hidden="true"
                class="text-sm"
              />
            </FancyButton>
            <FancyButton v-else-if="step === 'test'" @click="forward">
              Continue
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
            </FancyButton>

            <!-- The last step records a statement rather than saving a form, so it stays
                 up once made: the reader sees it land, may make it again after the next
                 deploy, and closes deliberately. -->
            <template v-else>
              <v-btn
                v-if="confirmedAt !== null"
                class="text-xs font-medium"
                color="neutral"
                size="small"
                variant="text"
                @click="confirmEnforcement"
              >
                Confirm again
              </v-btn>
              <FancyButton v-if="confirmedAt === null" :disabled="!observed" @click="confirmEnforcement">
                Confirm enforcement
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:check" />
              </FancyButton>
              <FancyButton v-else @click="open = false">
                Done
                <Icon aria-hidden="true" class="text-sm" name="material-symbols:check" />
              </FancyButton>
            </template>
          </div>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
