<script setup lang="ts">
/**
 * Intake, in the note's order: what was asked, about whom, when it reached you, where it
 * came from, who has it, and the rule its deadline is counted under, with the date those
 * add up to written out underneath.
 *
 * The received time is the point of the form. The deadline runs from it and never from the
 * moment of logging, so a request emailed on Monday and typed in on Friday is due on the
 * same day either way, and the preview says how much of the period is already gone. The
 * old form had no such field and silently moved the deadline (notes/data-requests.md P1).
 *
 * A subject is found by searching and confirmed by seeing the account whole, or recorded as
 * the person described themselves: a request the search cannot place is still one to
 * answer, and matching it is the first thing verifying does. Logging runs nothing.
 *
 * It closes on a settled write, never on the click, and holds its draft against an outside
 * click or Escape once anything is typed (notes/dialogs.md).
 */
import type { IntakeInput } from "~/stores/data-requests";
import {
  CALENDAR_NOTE,
  DEADLINE_RULES,
  type DeadlineRule,
  DUE_SOON_DAYS,
  dateInput,
  daysLeft,
  dueFrom,
  fromInputs,
  INTAKE_ISSUE_LABELS,
  type IntakeDraft,
  intakeIssues,
  kindInfo,
  loggedLateBy,
  REQUEST_KINDS,
  REQUEST_SOURCES,
  type RequestKind,
  type RequestSource,
  RULE_INFO,
  SOURCE_INFO,
  timeInput,
} from "~/utils/data-requests";
import type { Member } from "~/utils/members";
import { formatDate } from "~/utils/time";
import type { ProjectUser } from "~/utils/users";

const props = defineProps<{
  users: readonly ProjectUser[];
  members: readonly Member[];
  /** The member reading the page, who holds a request nobody reassigns. */
  currentMemberId: string | null;
  projectName: string;
  /** Logs it, and resolves to the new request's id. */
  submit: (input: IntakeInput) => Promise<string>;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  logged: [id: string];
}>();

const { smAndUp } = useDisplay();
const titleId = `${useId()}-title`;
const now = useNow({ interval: 30_000 });

/* Mounted only while open, so the form starts fresh on every opening. */
const opened = new Date();
const kind = ref<RequestKind>("access");
const subjectMode = ref("account");
const subjectUserId = ref<string | null>(null);
const query = ref("");
const claimed = ref("");
const date = ref(dateInput(opened));
const time = ref(timeInput(opened));
const source = ref<RequestSource>("email");
const reference = ref("");
const assigneeId = ref<string | null>(props.currentMemberId);
const rule = ref<DeadlineRule>("gdpr");

const touched = ref(false);
const busy = ref(false);
const failure = ref("");

const KIND_OPTIONS = REQUEST_KINDS.map((id) => ({
  value: id,
  label: kindInfo(id).label,
  icon: kindInfo(id).icon,
}));

const kindModel = computed({
  get: (): string | null => kind.value,
  set: (value: string | null) => {
    const found = REQUEST_KINDS.find((id) => id === value);
    if (found !== undefined) kind.value = found;
  },
});

const SUBJECT_MODES = [
  { value: "account", label: "Find their account" },
  { value: "unmatched", label: "Not matched yet" },
];

const RULE_OPTIONS = DEADLINE_RULES.map((id) => ({
  value: id,
  label: `${RULE_INFO[id].label} · ${RULE_INFO[id].period}`,
}));

const ruleModel = computed({
  get: (): string => rule.value,
  set: (value: string) => {
    const found = DEADLINE_RULES.find((id) => id === value);
    if (found !== undefined) rule.value = found;
  },
});

const owner = computed(
  () => props.members.find((member) => member.id === assigneeId.value) ?? null,
);

const receivedAt = computed(() => fromInputs(date.value, time.value));

const draft = computed<IntakeDraft>(() => ({
  kind: kind.value,
  subjectUserId: subjectMode.value === "account" ? subjectUserId.value : null,
  claimedIdentity: subjectMode.value === "unmatched" ? claimed.value : "",
  receivedAt: receivedAt.value,
  source: source.value,
  reference: reference.value,
  assigneeId: assigneeId.value,
  rule: rule.value,
}));

const issues = computed(() => intakeIssues(draft.value, now.value));
const valid = computed(() => Object.keys(issues.value).length === 0);

/* Shown once the form has been sent, so a blank form does not open covered in red. */
const shown = computed(() => (touched.value ? issues.value : {}));

const dirty = computed(
  () =>
    kind.value !== "access" ||
    subjectUserId.value !== null ||
    query.value.trim() !== "" ||
    claimed.value.trim() !== "" ||
    date.value !== dateInput(opened) ||
    time.value !== timeInput(opened) ||
    source.value !== "email" ||
    reference.value.trim() !== "" ||
    assigneeId.value !== props.currentMemberId ||
    rule.value !== "gdpr",
);

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The date the form adds up to, and how much of the period is already gone. */
const preview = computed(() => {
  const at = receivedAt.value;
  if (at === null) return null;
  const dueAt = dueFrom(at, rule.value);
  return {
    dueAt,
    left: daysLeft({ dueAt }, now.value),
    gone: loggedLateBy({ receivedAt: at, loggedAt: now.value.toISOString() }),
  };
});

const previewLine = computed(() => {
  const figures = preview.value;
  if (figures === null) return "";
  if (figures.left < 0) {
    return `Already overdue by ${plural(-figures.left, "day")}. It reached you before this deadline passed, and logging it now does not move it.`;
  }
  const left = figures.left === 0 ? "it is due today" : `${plural(figures.left, "day")} left`;
  if (figures.gone > 0) {
    return `It reached you ${plural(figures.gone, "day")} ago, so ${left}. Logging it now does not move the date.`;
  }
  return figures.left === 0 ? "Due today." : `${plural(figures.left, "day")} left.`;
});

const previewTone = computed(() => {
  const figures = preview.value;
  if (figures === null) return "text-ink/60";
  if (figures.left < 0) return "text-error";
  return figures.left <= DUE_SOON_DAYS ? "text-warning" : "text-ink/60";
});

/* A search that found nobody carries its text over, so it is not typed twice. */
function recordUnmatched() {
  claimed.value = query.value.trim();
  subjectMode.value = "unmatched";
}

function focusFirstIssue() {
  const id = issues.value.subject
    ? subjectMode.value === "account"
      ? "dsr-log-subject"
      : "dsr-log-claimed"
    : issues.value.received
      ? "dsr-log-date"
      : null;
  if (id !== null) document.getElementById(id)?.focus();
}

async function submit() {
  touched.value = true;
  failure.value = "";
  const at = receivedAt.value;
  if (!valid.value || at === null) {
    focusFirstIssue();
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    const id = await props.submit({ ...draft.value, receivedAt: at });
    emit("logged", id);
    open.value = false;
  } catch {
    failure.value = "The request could not be logged. Nothing was saved, so it can be sent again.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!smAndUp"
    :max-width="smAndUp ? 520 : undefined"
    :persistent="busy || dirty"
    scrollable
    width="100%"
  >
    <v-card border flat>
      <form
        :class="smAndUp ? 'max-h-[88vh]' : 'h-full'"
        class="flex flex-col"
        novalidate
        @submit.prevent="submit"
      >
        <header class="flex flex-none flex-col gap-1 border-b border-line px-5 py-4">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">Log a data request</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            For a request that reached
            <span class="font-medium text-ink/80">{{ projectName }}</span> by email, a ticket,
            a form or a letter. Logging records it and runs nothing.
          </p>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <div class="flex flex-col gap-2">
            <span class="text-xs font-medium text-ink">What they asked for</span>
            <ChoiceList
              v-model="kindModel"
              :columns="2"
              :disabled="busy"
              :options="KIND_OPTIONS"
              label="What they asked for"
            />
            <p class="m-0 text-[11px] leading-4 text-ink/55">{{ kindInfo(kind).note }}</p>
          </div>

          <div class="flex flex-col gap-2">
            <span class="text-xs font-medium text-ink">Who it is about</span>
            <SegmentedControl
              v-model="subjectMode"
              :disabled="busy"
              :options="SUBJECT_MODES"
              label="Who it is about"
              stretch
            />
            <DataRequestSubjectSearch
              v-if="subjectMode === 'account'"
              v-model="subjectUserId"
              v-model:query="query"
              :disabled="busy"
              :error="shown.subject !== undefined"
              :users="users"
              input-id="dsr-log-subject"
              no-match-label="Record them as not matched"
              @no-match="recordUnmatched"
            />
            <v-text-field
              v-else
              id="dsr-log-claimed"
              v-model="claimed"
              :disabled="busy"
              :error="shown.subject !== undefined"
              aria-label="How they identified themselves"
              autocomplete="off"
              hide-details
              placeholder="The address they wrote from, or the name they gave"
              spellcheck="false"
              variant="filled"
            />
            <p
              :class="shown.subject ? 'text-error' : 'text-ink/50'"
              class="m-0 text-[11px] leading-4"
            >
              <template v-if="shown.subject">{{ INTAKE_ISSUE_LABELS[shown.subject] }}</template>
              <template v-else-if="subjectMode === 'account'">
                Pick the account and check it is theirs. Verifying it is them is the next step.
              </template>
              <template v-else>
                Kept as they gave it. Matching it to an account is the first thing verifying does.
              </template>
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-medium text-ink" for="dsr-log-date">When it reached you</label>
            <div class="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
              <v-text-field
                id="dsr-log-date"
                v-model="date"
                :disabled="busy"
                :error="shown.received !== undefined"
                hide-details
                type="date"
                variant="filled"
              />
              <v-text-field
                v-model="time"
                :disabled="busy"
                :error="shown.received !== undefined"
                aria-label="Time it reached you"
                hide-details
                type="time"
                variant="filled"
              />
            </div>
            <p
              :class="shown.received ? 'text-error' : 'text-ink/50'"
              class="m-0 text-[11px] leading-4"
            >
              {{
                shown.received
                  ? INTAKE_ISSUE_LABELS[shown.received]
                  : "Not when you are logging it. The deadline runs from here."
              }}
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-medium text-ink" for="dsr-log-source">Where it came from</label>
            <!-- Drawn like the filled fields beside it, as the claim form's field picker is. -->
            <button
              id="dsr-log-source"
              :disabled="busy"
              aria-haspopup="menu"
              class="group flex h-10 w-full items-center justify-between gap-2 rounded-t-(--idenzy-radius) border-b border-ink/25 bg-ink/5 px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-ink/45 hover:bg-ink/8 focus-visible:border-primary focus-visible:outline-none"
              type="button"
            >
              <span class="flex min-w-0 items-center gap-2">
                <Icon
                  :name="SOURCE_INFO[source].icon"
                  aria-hidden="true"
                  class="flex-none text-base text-ink/55"
                />
                <span class="truncate">{{ SOURCE_INFO[source].label }}</span>
              </span>
              <Icon
                aria-hidden="true"
                class="flex-none text-base text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
                name="material-symbols:unfold-more"
              />
              <v-menu :offset="6" activator="parent" location="bottom start">
                <v-list density="compact" min-width="260" nav>
                  <v-list-item
                    v-for="entry in REQUEST_SOURCES"
                    :key="entry"
                    :active="entry === source"
                    :prepend-icon="SOURCE_INFO[entry].icon"
                    :title="SOURCE_INFO[entry].label"
                    @click="source = entry"
                  />
                </v-list>
              </v-menu>
            </button>
            <v-text-field
              v-model="reference"
              :disabled="busy"
              :placeholder="SOURCE_INFO[source].placeholder"
              aria-label="Reference"
              autocomplete="off"
              hide-details
              variant="filled"
            />
            <p class="m-0 text-[11px] leading-4 text-ink/50">
              Optional. Where the original sits, so the request can be traced back to it.
            </p>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-xs font-medium text-ink" for="dsr-log-owner">Assigned to</label>
            <button
              id="dsr-log-owner"
              :disabled="busy"
              aria-haspopup="menu"
              class="group flex h-10 w-full items-center justify-between gap-2 rounded-t-(--idenzy-radius) border-b border-ink/25 bg-ink/5 px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-ink/45 hover:bg-ink/8 focus-visible:border-primary focus-visible:outline-none"
              type="button"
            >
              <span :class="owner ? 'text-ink' : 'text-ink/55'" class="truncate">
                {{ owner?.name ?? "Nobody yet" }}
              </span>
              <Icon
                aria-hidden="true"
                class="flex-none text-base text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
                name="material-symbols:unfold-more"
              />
              <v-menu :offset="6" activator="parent" location="bottom start">
                <v-list density="compact" min-width="260" nav>
                  <v-list-item
                    v-for="member in members"
                    :key="member.id"
                    :active="member.id === assigneeId"
                    :subtitle="member.email"
                    :title="member.name"
                    @click="assigneeId = member.id"
                  />
                  <v-list-item
                    :active="assigneeId === null"
                    title="Nobody yet"
                    @click="assigneeId = null"
                  />
                </v-list>
              </v-menu>
            </button>
            <p class="m-0 text-[11px] leading-4 text-ink/50">Who answers it, and watches its date.</p>
          </div>

          <div class="flex flex-col gap-2">
            <span class="flex items-center gap-1 text-xs font-medium text-ink">
              Deadline rule
              <v-tooltip :text="CALENDAR_NOTE" location="top" max-width="320">
                <template #activator="{ props: tip }">
                  <button
                    v-bind="tip"
                    aria-label="How the date is counted"
                    class="inline-flex text-ink/40 transition-colors duration-150 hover:text-ink/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    type="button"
                  >
                    <Icon aria-hidden="true" class="text-sm" name="material-symbols:info-outline" />
                  </button>
                </template>
              </v-tooltip>
            </span>
            <SegmentedControl
              v-model="ruleModel"
              :disabled="busy"
              :options="RULE_OPTIONS"
              label="Deadline rule"
              stretch
            />
            <div
              class="flex items-start gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 text-[11px] leading-4 ring-1 ring-ink/6 ring-inset"
              role="status"
            >
              <Icon
                aria-hidden="true"
                class="mt-px flex-none text-sm text-ink/50"
                name="material-symbols:schedule-outline"
              />
              <span v-if="preview" class="flex flex-col gap-0.5">
                <span class="text-ink/75">
                  Due
                  <span class="font-medium text-ink">{{ formatDate(preview.dueAt) }}</span>,
                  {{ RULE_INFO[rule].period }} from receipt under {{ RULE_INFO[rule].label }}
                  {{ RULE_INFO[rule].citation }}.
                </span>
                <span :class="previewTone">{{ previewLine }}</span>
              </span>
              <span v-else class="text-ink/55">
                Enter when it reached you to see the date it is due.
              </span>
            </div>
          </div>

          <p v-if="failure" class="m-0 text-[11px] leading-4 text-error" role="alert">
            {{ failure }}
          </p>
        </div>

        <footer class="flex flex-none flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <p class="m-0 mr-auto text-[11px] leading-4 text-ink/50">
            Nothing is exported or erased by logging.
          </p>
          <v-btn
            :disabled="busy"
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
            Log request
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
