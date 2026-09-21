<script setup lang="ts">
/**
 * One request, in the order the note sets: its stages, when it reached the project and
 * under which rule, whether the person was verified, the work and what evidences it, the
 * answer, and last the one step that is next. Receipt and verification come before any
 * control that acts, because acting for somebody nobody verified is the mistake this
 * screen exists to prevent.
 *
 * The footer holds exactly one primary action, the valid next step, and says beside it why
 * it cannot be taken where it cannot. Refusal is secondary and asks for its grounds in a
 * dialog of its own. Nothing here completes a request by itself: Close request is offered
 * only once the work is evidenced and the response recorded (notes/data-requests.md P1).
 *
 * Capped from `lg` up and a full-height sheet below, with the deadline under the title at
 * every width and the footer fixed, which is the note's mobile arrangement.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  actionBlocker,
  bundleExpiresAt,
  bundleState,
  CALENDAR_NOTE,
  CHANNEL_LABELS,
  type DataSubjectRequest,
  dueTone,
  dueWords,
  ERASURE_KEEPS,
  EXPORT_JOBS,
  type ExportJob,
  isOpen,
  JOB_STATE_LABELS,
  type JobState,
  kindInfo,
  loggedLateBy,
  NEXT_ACTION_LABELS,
  type NextAction,
  nextActionOf,
  REFUSAL_GROUND_INFO,
  RULE_INFO,
  SOURCE_INFO,
  stageSummary,
  stagesOf,
  subjectDetail,
  subjectTitle,
  VERIFICATION_INFO,
  workDone,
} from "~/utils/data-requests";
import type { Member } from "~/utils/members";
import { formatDate, formatDateTime } from "~/utils/time";
import type { ProjectUser } from "~/utils/users";

const props = defineProps<{
  request: DataSubjectRequest;
  /** The account it is about, where it has been matched to one. */
  user: ProjectUser | null;
  members: readonly Member[];
  now: Date;
  /** A write started from here is in flight. */
  busy: boolean;
  /** Why the last write started from here was refused. */
  failure: string;
  /** Why the deadline cannot be extended, or null where it can. */
  extensionBlocked: string | null;
  titleId: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  act: [action: NextAction];
  refuse: [];
  extend: [];
  assign: [memberId: string | null];
}>();

const { lgAndUp } = useDisplay();

const info = computed(() => kindInfo(props.request.kind));
const rule = computed(() => RULE_INFO[props.request.rule]);
const stages = computed(() => stagesOf(props.request));
const summary = computed(() => stageSummary(props.request));
const next = computed(() => nextActionOf(props.request));
const blocker = computed(() => (next.value === null ? null : actionBlocker(next.value)));
const live = computed(() => isOpen(props.request.status));
const assignee = computed(
  () => props.members.find((member) => member.id === props.request.assigneeId) ?? null,
);
const lateLog = computed(() => loggedLateBy(props.request));
const noAccount = computed(() => props.request.verification?.outcome === "no_account");
const account = computed(() =>
  props.user !== null && props.user.deletedAt === null ? props.user : null,
);
/* Newest first: the run that decides where the work stands is the one read first. */
const jobs = computed<ExportJob[]>(() => [...props.request.jobs].reverse());
const keeps = ref(false);

const DUE_TEXT: Record<string, string> = {
  error: "text-error",
  warning: "text-warning",
  success: "text-ink",
  neutral: "text-ink/65",
};

const JOB_TONES: Record<JobState, BadgeTone> = {
  queued: "neutral",
  running: "neutral",
  failed: "error",
  succeeded: "success",
};

const WORK_TITLES = { export: "Export", erasure: "Erasure", correction: "Correction" } as const;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** What the footer says about a request that is finished. */
const closedLine = computed(() => {
  const request = props.request;
  const on = request.completedAt === null ? "" : ` ${formatDate(request.completedAt)}`;
  const timing = dueWords(request, props.now);
  const inTime = timing === "Met" ? "inside its deadline" : timing.toLowerCase();
  if (request.status === "rejected") return `Refused${on}, ${inTime}.`;
  return `Completed${on}, ${inTime}.`;
});

function expiry(job: ExportJob): string {
  const at = bundleExpiresAt(job);
  return at === null ? "" : formatDate(at);
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 880 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
  >
    <v-card border flat>
      <div :class="lgAndUp ? 'max-h-[88vh]' : 'h-full'" class="flex flex-col">
        <header class="flex flex-none flex-col gap-3 border-b border-line px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 flex-col gap-1">
              <p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/60">
                <span class="inline-flex items-center gap-1.5">
                  <Icon :name="info.icon" aria-hidden="true" class="text-sm text-ink/55" />
                  {{ info.label }} request
                  <span v-if="request.rule === 'gdpr'" class="text-ink/45">
                    · {{ info.article }}
                  </span>
                </span>
                <StatusBadge :label="summary.label" :tone="summary.tone" />
              </p>
              <h2 :id="titleId" class="m-0 truncate text-base font-semibold tracking-tight text-ink">
                {{ subjectTitle(request, user) }}
              </h2>
              <p class="m-0 truncate font-mono text-[11px] text-ink/55">
                {{ subjectDetail(request, user) }}
              </p>
            </div>
            <v-btn
              aria-label="Close"
              color="neutral"
              density="comfortable"
              icon="material-symbols:close"
              size="small"
              variant="text"
              @click="open = false"
            />
          </div>

          <!-- The deadline stays beside the title at every width, as the note asks. -->
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p class="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span :class="DUE_TEXT[dueTone(request, now)]" class="text-sm font-medium">
                {{ dueWords(request, now) }}
              </span>
              <span class="text-xs text-ink/55">
                Due {{ formatDate(request.dueAt) }} · {{ rule.label }}, {{ rule.period }} from
                receipt<template v-if="request.extension">, extended</template>
              </span>
            </p>

            <v-menu :offset="4" location="bottom end">
              <template #activator="{ props: activator }">
                <v-btn
                  v-bind="activator"
                  :disabled="!live || busy"
                  class="text-xs font-medium"
                  color="neutral"
                  size="small"
                  variant="text"
                >
                  <span class="mr-1 font-normal text-ink/50">Assigned to</span>
                  {{ assignee?.name ?? "Nobody" }}
                  <Icon
                    aria-hidden="true"
                    class="ml-0.5 text-base"
                    name="material-symbols:keyboard-arrow-down"
                  />
                </v-btn>
              </template>
              <v-list density="compact" min-width="240" nav>
                <v-list-item
                  v-for="member in members"
                  :key="member.id"
                  :active="member.id === request.assigneeId"
                  :subtitle="member.email"
                  :title="member.name"
                  @click="emit('assign', member.id)"
                />
                <v-list-item
                  :active="request.assigneeId === null"
                  title="Nobody"
                  @click="emit('assign', null)"
                />
              </v-list>
            </v-menu>
          </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col divide-y divide-line overflow-y-auto">
          <section class="px-5 py-4">
            <DataRequestStages :stages="stages" />
          </section>

          <!-- Receipt first: the deadline is only as good as the time it runs from. -->
          <section class="flex flex-col gap-3 px-5 py-4">
            <h3 class="m-0 text-xs font-normal text-ink/45">Receipt</h3>
            <dl class="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-0.5">
                <dt class="text-[11px] text-ink/50">Reached you</dt>
                <dd class="m-0 text-xs text-ink">{{ formatDateTime(request.receivedAt) }}</dd>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  {{
                    lateLog > 0
                      ? `Logged ${plural(lateLog, "day")} later by ${request.loggedBy}. The deadline ran from receipt.`
                      : `Logged by ${request.loggedBy}.`
                  }}
                </dd>
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <dt class="text-[11px] text-ink/50">Source</dt>
                <dd class="m-0 flex items-center gap-1.5 text-xs text-ink">
                  <Icon
                    :name="SOURCE_INFO[request.source].icon"
                    aria-hidden="true"
                    class="text-sm text-ink/50"
                  />
                  {{ SOURCE_INFO[request.source].label }}
                </dd>
                <dd class="m-0 truncate text-[11px] leading-4 text-ink/55">
                  {{ request.reference || "No reference recorded." }}
                </dd>
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <dt class="flex items-center gap-1 text-[11px] text-ink/50">
                  Deadline rule
                  <v-tooltip :text="`${rule.note} ${CALENDAR_NOTE}`" location="top" max-width="340">
                    <template #activator="{ props: tip }">
                      <button
                        v-bind="tip"
                        aria-label="How this deadline is counted"
                        class="inline-flex text-ink/40 transition-colors duration-150 hover:text-ink/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        type="button"
                      >
                        <Icon aria-hidden="true" class="text-xs" name="material-symbols:info-outline" />
                      </button>
                    </template>
                  </v-tooltip>
                </dt>
                <dd class="m-0 text-xs text-ink">{{ rule.label }} {{ rule.citation }}</dd>
                <dd class="m-0 text-[11px] leading-4 text-ink/55">
                  {{ rule.period }} from receipt, on the calendar.
                </dd>
              </div>
              <div class="flex min-w-0 flex-col gap-0.5">
                <dt class="text-[11px] text-ink/50">Due</dt>
                <dd class="m-0 text-xs text-ink">{{ formatDate(request.dueAt) }}</dd>
                <dd v-if="request.extension" class="m-0 text-[11px] leading-4 text-ink/55">
                  Extended from {{ formatDate(request.extension.previousDueAt) }} by
                  {{ request.extension.by }}, reviewed by {{ request.extension.reviewedBy }}.
                  They were told {{ formatDate(request.extension.toldAt) }}.
                </dd>
                <dd v-else-if="live" class="m-0 flex flex-col items-start gap-0.5">
                  <button
                    :disabled="extensionBlocked !== null || busy"
                    class="text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink disabled:text-ink/35"
                    type="button"
                    @click="emit('extend')"
                  >
                    Extend deadline
                  </button>
                  <span v-if="extensionBlocked" class="text-[11px] leading-4 text-ink/50">
                    {{ extensionBlocked }}
                  </span>
                </dd>
              </div>
            </dl>
            <p
              v-if="request.extension"
              class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
            >
              {{ request.extension.reason }}
            </p>
          </section>

          <!-- Whether it is them, before anything that acts on their data. -->
          <section class="flex flex-col gap-2 px-5 py-4">
            <h3 class="m-0 text-xs font-normal text-ink/45">Subject</h3>

            <template v-if="request.verification === null">
              <p class="m-0 text-xs leading-5 text-ink">
                <template v-if="request.subjectUserId !== null">
                  Matched to an account when it was logged, and not verified yet.
                </template>
                <template v-else>
                  Not matched to an account. They gave
                  <span class="font-mono text-[11px]">{{ request.claimedIdentity }}</span>.
                </template>
              </p>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                Nothing is exported, erased or corrected until it is verified.
              </p>
            </template>

            <template v-else-if="request.verification.outcome === 'no_account'">
              <p class="m-0 text-xs leading-5 text-ink">No account on this project holds them.</p>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                Checked by {{ request.verification.by }},
                {{ formatDate(request.verification.at) }}.
              </p>
            </template>

            <template v-else>
              <p class="m-0 text-xs leading-5 text-ink">
                {{
                  request.verification.method
                    ? VERIFICATION_INFO[request.verification.method].label
                    : "Verified"
                }}
              </p>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                Verified by {{ request.verification.by }},
                {{ formatDate(request.verification.at) }}.
              </p>
            </template>

            <p
              v-if="request.verification?.note"
              class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
            >
              {{ request.verification.note }}
            </p>

            <p v-if="user?.deletedAt" class="m-0 text-[11px] leading-4 text-ink/55">
              The account was erased {{ formatDate(user.deletedAt) }}. This request keeps its id
              as the proof.
            </p>
            <NuxtLink
              v-else-if="account"
              :to="`/users/${account.id}`"
              class="inline-flex items-center gap-1 self-start text-xs font-medium text-ink/70 no-underline transition-colors duration-150 hover:text-ink hover:underline"
            >
              <Icon aria-hidden="true" class="text-sm" name="material-symbols:person-outline" />
              Open the account
            </NuxtLink>
          </section>

          <!-- The work, and only what evidences it. -->
          <section class="flex flex-col gap-2 px-5 py-4">
            <h3 class="m-0 text-xs font-normal text-ink/45">{{ WORK_TITLES[info.work] }}</h3>

            <p v-if="noAccount" class="m-0 text-xs leading-5 text-ink/75">
              Nothing to do. No account holds them, so nothing is held about them.
            </p>

            <p v-else-if="request.verification === null && request.status !== 'rejected'" class="m-0 text-xs leading-5 text-ink/55">
              Waits on verification.
            </p>

            <template v-else-if="info.work === 'export'">
              <p
                v-if="!EXPORT_JOBS.running && jobs.length === 0"
                class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/65"
              >
                <span aria-hidden="true" class="mt-2 size-1.5 flex-none rounded-full bg-warning" />
                {{ EXPORT_JOBS.reason }}
              </p>
              <p v-else-if="jobs.length === 0" class="m-0 text-xs leading-5 text-ink/55">
                No export prepared yet.
              </p>
              <ul
                v-else
                class="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-(--idenzy-radius-small) bg-ink/4 p-0 ring-1 ring-ink/6 ring-inset"
              >
                <li v-for="job in jobs" :key="job.id" class="flex flex-col gap-1.5 px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusBadge :label="JOB_STATE_LABELS[job.state]" :tone="JOB_TONES[job.state]" />
                    <span class="text-[11px] text-ink/55">
                      Started {{ formatDateTime(job.startedAt) }} by {{ job.startedBy }}
                    </span>
                    <span v-if="job.finishedAt" class="text-[11px] text-ink/55">
                      · ended {{ formatDateTime(job.finishedAt) }}
                    </span>
                  </div>

                  <template v-if="job.state === 'failed'">
                    <p class="m-0 text-xs leading-5 text-error">{{ job.failure }}</p>
                    <p class="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
                      <span class="font-mono">{{ job.id }}</span>
                      <NuxtLink
                        class="font-medium text-ink/70 no-underline hover:text-ink hover:underline"
                        to="/audit"
                      >
                        Investigate in the audit log
                      </NuxtLink>
                    </p>
                  </template>

                  <template v-else-if="job.state === 'succeeded'">
                    <p class="m-0 text-[11px] leading-4 text-ink/55">
                      Read {{ plural(job.tables.length, "table") }}: {{ job.tables.join(", ") }}.
                    </p>
                    <template v-if="bundleState(job, now) === 'live' && job.artifactUri">
                      <CopyField :value="job.artifactUri" dense label="Copy the bundle link" />
                      <p class="m-0 text-[11px] leading-4 text-ink/55">
                        Expires {{ expiry(job) }}. After that the copy is gone and this record
                        of it stays.
                      </p>
                    </template>
                    <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
                      The bundle expired {{ expiry(job) }} and is gone. The export finished, and
                      this record of it stays.
                    </p>
                  </template>
                </li>
              </ul>
            </template>

            <template v-else-if="info.work === 'erasure'">
              <p v-if="request.erasure" class="m-0 text-xs leading-5 text-ink">
                Run by {{ request.erasure.by }}, {{ formatDateTime(request.erasure.at) }}. The
                account is a tombstone now, and the identity they gave was cleared with it.
              </p>
              <p v-else-if="user?.deletedAt" class="m-0 text-xs leading-5 text-ink/75">
                Already erased on the users screen. Running it from here records the erasure
                against this request.
              </p>
              <p v-else-if="request.status !== 'rejected'" class="m-0 text-xs leading-5 text-ink/75">
                Not run. Review erasure lists what it removes from this account before anything
                happens.
              </p>
              <button
                :aria-expanded="keeps"
                class="inline-flex items-center gap-1 self-start text-xs font-medium text-ink/70 transition-colors duration-150 hover:text-ink"
                type="button"
                @click="keeps = !keeps"
              >
                What an erasure keeps
                <Icon
                  :class="keeps ? 'rotate-180' : ''"
                  aria-hidden="true"
                  class="text-base transition-transform duration-150"
                  name="material-symbols:keyboard-arrow-down"
                />
              </button>
              <ul v-if="keeps" class="m-0 flex list-none flex-col gap-2 p-0">
                <li v-for="kept in ERASURE_KEEPS" :key="kept.what" class="flex flex-col gap-0.5">
                  <span class="text-xs font-medium text-ink">{{ kept.what }}</span>
                  <span class="text-[11px] leading-4 text-ink/55">{{ kept.why }}</span>
                </li>
              </ul>
            </template>

            <template v-else>
              <template v-if="request.correction">
                <p
                  class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
                >
                  {{ request.correction.summary }}
                </p>
                <p class="m-0 text-[11px] leading-4 text-ink/55">
                  Recorded by {{ request.correction.by }},
                  {{ formatDateTime(request.correction.at) }}.
                </p>
              </template>
              <p v-else-if="request.status !== 'rejected'" class="m-0 text-xs leading-5 text-ink/75">
                Not recorded. Make the change on the account, then record what changed.
              </p>
            </template>
          </section>

          <section class="flex flex-col gap-2 px-5 py-4">
            <h3 class="m-0 text-xs font-normal text-ink/45">Answer</h3>

            <template v-if="request.refusal">
              <p class="m-0 text-xs leading-5 font-medium text-ink">
                Refused: {{ REFUSAL_GROUND_INFO[request.refusal.ground].label.toLowerCase() }}
              </p>
              <p
                class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
              >
                {{ request.refusal.reasoning }}
              </p>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                Told by {{ CHANNEL_LABELS[request.refusal.channel].toLowerCase() }},
                {{ formatDate(request.refusal.toldAt) }}. Recorded by {{ request.refusal.by }}.
              </p>
            </template>

            <template v-else-if="request.response">
              <p class="m-0 text-xs leading-5 text-ink">
                {{ CHANNEL_LABELS[request.response.channel] }},
                {{ formatDate(request.response.sentAt) }}
              </p>
              <p
                class="m-0 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2 text-xs leading-5 text-ink/75 ring-1 ring-ink/6 ring-inset"
              >
                {{ request.response.summary }}
              </p>
              <p class="m-0 text-[11px] leading-4 text-ink/55">
                Recorded by {{ request.response.by }}.
              </p>
            </template>

            <p v-else class="m-0 text-xs leading-5 text-ink/55">
              {{
                request.verification !== null && workDone(request)
                  ? "Nothing recorded yet. Record what you sent them, then close the request."
                  : "Recorded once the work is done."
              }}
            </p>
          </section>
        </div>

        <!-- One primary action, the valid next step, and the reason beside it where it
             cannot be taken. Refusing sits apart on the left. -->
        <footer class="flex flex-none flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <template v-if="live && next">
            <v-btn
              :disabled="busy"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="emit('refuse')"
            >
              Record refusal…
            </v-btn>
            <span class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
              <p
                v-if="failure"
                class="m-0 max-w-md text-[11px] leading-4 text-error sm:text-right"
                role="alert"
              >
                {{ failure }}
              </p>
              <p
                v-else-if="blocker"
                class="m-0 max-w-md text-[11px] leading-4 text-ink/55 sm:text-right"
              >
                {{ blocker }}
              </p>
              <v-btn
                :disabled="blocker !== null"
                :loading="busy"
                class="text-xs font-medium"
                color="primary"
                size="small"
                variant="flat"
                @click="emit('act', next)"
              >
                {{ NEXT_ACTION_LABELS[next] }}
              </v-btn>
            </span>
          </template>
          <template v-else>
            <p class="m-0 mr-auto text-xs text-ink/60">{{ closedLine }}</p>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Close
            </v-btn>
          </template>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
