<script setup lang="ts">
/**
 * Synchronous hooks: the five points where a project's own service is called while one of its
 * users waits (notes/hooks.md; PROJECT.md 3.2, 9.6).
 *
 * In the note's order: whether a webhook is what the reader wanted, then the hook points with
 * readiness, deadline and failure rate, then signing and failure, folded. The figures lead the
 * list, as on every screen that has them. Configure opens a hook's own configuration in a
 * dialog, which owns its endpoint, its deadline, its contract, its check and Enable.
 *
 * Nothing calls a hook yet, and the page says so before anything else (`HOOK_CALLS`). A
 * configuration is saved and checked as far as a check goes without a call; enabling waits on a
 * call being possible, so no row reads as a gate that only exists in local state.
 *
 * The open hook is named in the query, replaced rather than pushed, so a link opens it.
 */
import type { RecordColumn } from "~/components/RecordTable.vue";
import {
  addedTo,
  callFigures,
  defaultHook,
  FAIL_CLOSED_NOTE,
  firstFailure,
  formatDuration,
  HOOK_CALLS,
  HOOK_FAILURES,
  HOOK_FIGURE_DAYS,
  HOOK_KINDS,
  HOOK_OR_WEBHOOK,
  HOOK_SIGNATURE_HEADER,
  HOOK_TIMESTAMP_HEADER,
  HOOK_TIMESTAMP_TOLERANCE_SECONDS,
  HOOK_TYPE_HEADER,
  HOOK_TYPES,
  type HookStats,
  type HookType,
  NO_RETRY_NOTE,
  replacesLiveEndpoint,
  secretSummary,
  verdictOf,
} from "~/utils/hooks";

const projects = useProjectStore();
const store = useHooksStore();
const route = useRoute();
const router = useRouter();
const { lgAndUp } = useDisplay();
const now = useNow({ interval: 60_000 });
const running = HOOK_CALLS.running;

const project = computed(() => projects.current.id);
const hooks = computed(() => store.hooksFor(project.value));
const secret = computed(() => store.secretFor(project.value));

/** Per hook, read once so the rows, the dialog and the figures agree. Null while nothing calls. */
const stats = computed(
  () => new Map(HOOK_TYPES.map((type) => [type, store.statsFor(project.value, type)] as const)),
);
const figures = computed(() =>
  callFigures([...stats.value.values()].filter((entry): entry is HookStats => entry !== null)),
);

const configured = computed(() => hooks.value.filter((hook) => hook.url !== null).length);
const enabledCount = computed(() => hooks.value.filter((hook) => hook.enabled).length);

const pathHooks = computed(() =>
  hooks.value.filter((hook) => HOOK_KINDS[hook.type] !== "override"),
);
const sendHooks = computed(() =>
  hooks.value.filter((hook) => HOOK_KINDS[hook.type] === "override"),
);

const listHeading = computed(() =>
  store.loading
    ? "Reading this project's hooks"
    : `${configured.value} of ${HOOK_TYPES.length} set up, ${enabledCount.value} enabled`,
);

/** The worst case a request picks up, which is what the deadlines add up to. */
const budget = computed(() => {
  const signIn = addedTo("sign_in", hooks.value);
  const signUp = addedTo("sign_up", hooks.value);
  if (signUp === 0) return "No sign-in waits on a hook";
  return `Up to ${formatDuration(signIn)} on a sign-in, ${formatDuration(signUp)} on a sign-up`;
});

const HOOK_COLUMNS: readonly RecordColumn[] = [
  { key: "hook", label: "Hook", width: "minmax(0, 2.2fr)" },
  { key: "ready", label: "Ready?", width: "minmax(0, 1.2fr)" },
  { key: "deadline", label: "Deadline", width: "minmax(0, 0.7fr)" },
  { key: "failures", label: "Failure rate", width: "minmax(0, 1fr)" },
  { key: "configure", label: "", width: "132px", align: "end" },
];

const COMPARE_COLUMNS: readonly RecordColumn[] = [
  { key: "label", label: "", width: "minmax(0, 1fr)" },
  { key: "hook", label: "A hook", width: "minmax(0, 1.4fr)" },
  { key: "webhook", label: "A webhook", width: "minmax(0, 1.4fr)" },
];

/*
 * The hook whose configuration is open, named in the URL so a link opens it.
 */
function isHookType(value: unknown): value is HookType {
  return typeof value === "string" && (HOOK_TYPES as readonly string[]).includes(value);
}

const detailType = ref<HookType>("before_sign_in");
const detailOpen = ref(false);
const detailTitleId = `${useId()}-hook`;

const detail = computed(
  () => hooks.value.find((hook) => hook.type === detailType.value) ?? defaultHook(detailType.value),
);

function configure(type: HookType) {
  detailType.value = type;
  detailOpen.value = true;
}

/* Replaced rather than pushed: opening a hook is not a place to step back to. */
watch(detailOpen, (open) => {
  const rest = Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== "hook"));
  void router.replace({ query: open ? { ...rest, hook: detailType.value } : rest });
});

onMounted(() => {
  const asked = route.query["hook"];
  const value = Array.isArray(asked) ? asked[0] : asked;
  if (isHookType(value)) configure(value);
});

/*
 * Checking, which holds its own wait per hook.
 */
const busy = ref<Set<string>>(new Set());

function isBusy(key: string): boolean {
  return busy.value.has(key);
}

async function whileBusy(key: string, work: () => Promise<void>) {
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

function validate(type: HookType) {
  void whileBusy(`validate:${type}`, async () => {
    await store.validate(project.value, type);
  });
}

/*
 * The dialogs that write. One is open at a time, over the hook's own dialog when it is opened
 * from there, and each is mounted only while it is, so the subject, the wait and the error are
 * held here once.
 */
type DialogKind = "endpoint" | "deadline" | "enable" | "disable" | "remove" | "rotate";

const dialog = ref<DialogKind | null>(null);
const subject = ref<HookType>("before_sign_in");
const working = ref(false);
const problem = ref("");

const subjectHook = computed(
  () => hooks.value.find((hook) => hook.type === subject.value) ?? defaultHook(subject.value),
);
const removeAction = computed(() => (dialog.value === "disable" ? "disable" : "remove"));

function ask(kind: DialogKind, type?: HookType) {
  if (type !== undefined) subject.value = type;
  problem.value = "";
  dialog.value = kind;
}

/** A dialog's own model: it can close itself, and only `ask` opens it. */
function dialogModel(...kinds: DialogKind[]) {
  return computed({
    get: () => dialog.value !== null && kinds.includes(dialog.value),
    set: (value: boolean) => {
      if (!value && dialog.value !== null && kinds.includes(dialog.value)) dialog.value = null;
    },
  });
}

const endpointOpen = dialogModel("endpoint");
const deadlineOpen = dialogModel("deadline");
const enableOpen = dialogModel("enable");
const removeOpen = dialogModel("disable", "remove");
const rotateOpen = dialogModel("rotate");

/** Closes on success only; a failure keeps the dialog and says what did not happen. */
async function run(work: () => Promise<void>, failure: string) {
  working.value = true;
  problem.value = "";
  try {
    await work();
    dialog.value = null;
  } catch {
    problem.value = failure;
  } finally {
    working.value = false;
  }
}

/** The secret, held only while its dialog is open. */
const revealed = ref<{ secret: string; until: string | null } | null>(null);
const secretOpen = ref(false);

function reveal(value: string, until: string | null) {
  revealed.value = { secret: value, until };
  secretOpen.value = true;
}

interface SaveOutcome {
  problem: string;
  secret: string | null;
}

/** An enabled hook's new URL has to pass before it replaces the one a request waits on. */
async function replaceLive(type: HookType, url: string): Promise<SaveOutcome> {
  const check = await store.validate(project.value, type, url);
  if (verdictOf(check) !== "ready") {
    const reason = firstFailure(check)?.detail ?? "Part of the check was not run.";
    return {
      problem: `The new URL did not pass validation, so the current one is still called. ${reason}`,
      secret: null,
    };
  }
  await store.saveEndpoint(project.value, type, url, check);
  return { problem: "", secret: null };
}

async function confirmEndpoint(url: string) {
  const type = subject.value;
  working.value = true;
  problem.value = "";
  try {
    const hook = store.hookFor(project.value, type);
    const outcome = replacesLiveEndpoint(hook, url)
      ? await replaceLive(type, url)
      : { problem: "", ...(await store.saveEndpoint(project.value, type, url)) };
    if (outcome.problem) {
      problem.value = outcome.problem;
      return;
    }
    dialog.value = null;
    if (outcome.secret !== null) reveal(outcome.secret, null);
  } catch {
    problem.value = "The endpoint was not saved. What you typed is still here, so try again.";
  } finally {
    working.value = false;
  }
}

function confirmDeadline(deadlineMs: number) {
  const type = subject.value;
  if (deadlineMs === subjectHook.value.deadlineMs) {
    dialog.value = null;
    return;
  }
  void run(
    () => store.setDeadline(project.value, type, deadlineMs),
    "The deadline was not changed. The current one still applies, so try again.",
  );
}

function confirmEnable() {
  const type = subject.value;
  void run(
    () => store.enable(project.value, type),
    "It was not enabled, and nothing calls it. Try again.",
  );
}

function confirmRemove() {
  const type = subject.value;
  if (removeAction.value === "disable") {
    void run(
      () => store.disable(project.value, type),
      "It was not turned off and is still called. Try again.",
    );
    return;
  }
  void run(
    () => store.removeEndpoint(project.value, type),
    "The endpoint was not removed and is still saved. Try again.",
  );
}

function confirmRotate() {
  void run(async () => {
    const rotated = await store.rotateSecret(project.value);
    reveal(rotated.secret, rotated.until);
  }, "The secret was not rotated. The current one still signs, so try again.");
}

/* A dialog belongs to the project it was opened from, and a revealed secret certainly does. */
watch(project, () => {
  dialog.value = null;
  detailOpen.value = false;
  secretOpen.value = false;
  revealed.value = null;
});

const reference = reactive({ signing: false, failure: false });

const GUIDE_URL = "https://idenzy.io/docs/hooks";
</script>

<template>
  <div class="flex w-full flex-col gap-6">
    <PageHeader title="Hooks">
      <template #badge>
        <StatusBadge
          v-if="running"
          :label="`${enabledCount} active`"
          :tone="enabledCount > 0 ? 'success' : 'neutral'"
        />
        <StatusBadge v-else label="Not called yet" tone="warning" />
      </template>
      <template #description>
        Your own service, called during a request on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> while the person
        waits. The one place your code can change a sign-in, and the one place its downtime fails
        one.
      </template>
      <template #actions>
        <v-btn
          :href="GUIDE_URL"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:menu-book-outline"
          rel="noopener"
          size="small"
          target="_blank"
          variant="outlined"
        >
          Integration guide
        </v-btn>
      </template>
    </PageHeader>

    <!-- The first decision on the screen: plenty of people who arrive here wanted the page
         next door, and it is the one that cannot break a sign-in. -->
    <!-- Inline, so a narrow screen wraps it as a sentence rather than leaving the glyph on a
         line of its own. -->
    <p class="m-0 text-xs leading-5 text-ink/60">
      <Icon
        aria-hidden="true"
        class="mr-1 inline-block align-[-3px] text-sm text-ink/45"
        name="material-symbols:webhook"
      />
      <span class="font-medium text-ink">Only need to know after something happens?</span>
      A webhook is told afterwards, is retried, and cannot break a sign-in.
      <NuxtLink
        class="font-medium whitespace-nowrap text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
        to="/webhooks"
      >
        Open Webhooks
      </NuxtLink>
    </p>

    <!-- Before anything that could read as enforcement (P1). -->
    <div
      v-if="!running"
      class="flex items-start gap-2.5 rounded-(--idenzy-radius) border border-line bg-surface px-4 py-3"
      role="status"
    >
      <span aria-hidden="true" class="mt-1.5 size-1.5 flex-none rounded-full bg-warning" />
      <p class="m-0 text-sm text-ink">
        Nothing calls a hook yet.
        <span class="text-ink/60">
          {{ HOOK_CALLS.reason }} Validation checks what it can without a call, and enabling waits
          until something can make one.
        </span>
      </p>
    </div>

    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <h2 class="m-0 text-sm font-medium text-ink">Observed calls</h2>
        <span class="text-xs text-ink/55">Last {{ HOOK_FIGURE_DAYS }} days</span>
      </header>

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UsageTile
          v-for="figure in figures"
          :key="figure.id"
          :info="figure.info"
          :label="figure.label"
          :seed="figure.seed"
          :series="figure.series"
          :value="figure.value"
        />
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/55">
        <template v-if="running">
          Every call to an enabled hook on this project. A refusal is your service saying no; a
          failure is a request that failed because of the call.
        </template>
        <template v-else>
          Nothing calls a hook, so there are no figures. Read an empty tile as nobody counting,
          not as nothing failing.
        </template>
      </p>
    </section>

    <section class="flex flex-col gap-3">
      <header class="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="m-0 text-sm font-medium text-ink">{{ listHeading }}</h2>
          <p class="m-0 text-xs leading-5 text-ink/55">
            Five points where we would call your service. Configure one to set where we call and
            how long we wait, check it, then enable it.
          </p>
        </div>
        <span class="flex items-center gap-1.5 text-xs text-ink/60">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:timer-outline" />
          {{ budget }}
        </span>
      </header>

      <RecordTable :columns="HOOK_COLUMNS" framed label="Hook points">
        <template v-if="store.loading">
          <li v-for="row in 5" :key="row" class="record-row">
            <span class="record-cell record-cell--primary flex items-center gap-3">
              <span class="size-8 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8" />
              <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                <span class="h-2.5 w-28 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2 w-48 max-w-full animate-pulse rounded-full bg-ink/6" />
              </span>
            </span>
            <span class="record-cell record-cell--half"><span class="block h-4 w-20 animate-pulse rounded-full bg-ink/8" /></span>
            <span class="record-cell record-cell--half"><span class="block h-2.5 w-10 animate-pulse rounded-full bg-ink/6" /></span>
            <span class="record-cell record-cell--half"><span class="block h-2.5 w-16 animate-pulse rounded-full bg-ink/6" /></span>
            <span class="record-cell record-cell--action" />
          </li>
        </template>

        <template v-else>
          <li class="bg-ink/2 px-3.5 py-1.5 text-[11px] leading-4 font-medium text-ink/50">
            On the sign-in path
          </li>
          <HookRow
            v-for="hook in pathHooks"
            :key="hook.type"
            :hook="hook"
            :stats="stats.get(hook.type) ?? null"
            @configure="configure(hook.type)"
            @deadline="ask('deadline', hook.type)"
            @endpoint="ask('endpoint', hook.type)"
            @remove="ask('remove', hook.type)"
          />
          <li class="bg-ink/2 px-3.5 py-1.5 text-[11px] leading-4 font-medium text-ink/50">
            In place of our sender
          </li>
          <HookRow
            v-for="hook in sendHooks"
            :key="hook.type"
            :hook="hook"
            :stats="stats.get(hook.type) ?? null"
            @configure="configure(hook.type)"
            @deadline="ask('deadline', hook.type)"
            @endpoint="ask('endpoint', hook.type)"
            @remove="ask('remove', hook.type)"
          />
        </template>
      </RecordTable>
    </section>

    <LayerCard
      v-model:open="reference.signing"
      description="Which secret signs a hook, how you get it, and what rotating it moves."
      expandable
      title="Signing"
    >
      <div class="divide-y divide-line">
        <SettingRow :description="secretSummary(secret, now)" label="Hook signing secret">
          <template v-if="secret" #actions>
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              prepend-icon="material-symbols:key-outline"
              size="small"
              variant="outlined"
              @click="ask('rotate')"
            >
              Rotate secret
            </v-btn>
          </template>
        </SettingRow>
        <SettingRow
          description="Webhook secrets are per endpoint, and a project can have none or several, so none of them signs a hook. Rotating one never touches a hook, and rotating this never touches a webhook."
          fixed="Its own"
          label="Not a webhook secret"
        />
        <SettingRow
          description="Shown once and never again is settled. How it is held so we can sign with it is not, as for webhook secrets."
          fixed="Not settled"
          label="Where it is kept"
        />
        <SettingRow
          :fixed="HOOK_SIGNATURE_HEADER"
          description="Over the timestamp, a dot, then the raw body, exactly as a webhook delivery is, so the verifier on the Webhooks page checks a hook with this secret. Read the body as text first: re-serialised JSON never matches."
          label="How a call is signed"
        />
        <SettingRow
          :description="`Refuse a call whose timestamp is more than ${HOOK_TIMESTAMP_TOLERANCE_SECONDS / 60} minutes out before you check the signature. That is what makes it replay-safe rather than merely authentic.`"
          :fixed="HOOK_TIMESTAMP_HEADER"
          label="How replay is stopped"
        />
        <SettingRow
          :fixed="HOOK_TYPE_HEADER"
          description="Names which of the five the body is for, so one route can serve them all."
          label="Which hook"
        />
      </div>
    </LayerCard>

    <LayerCard
      v-model:open="reference.failure"
      description="Four ways a call does not come back with a yes, why none is retried, and how that differs from a webhook."
      expandable
      title="How a hook fails"
    >
      <div class="flex flex-col gap-5">
        <div class="divide-y divide-line">
          <SettingRow
            v-for="failure in HOOK_FAILURES"
            :key="failure.id"
            :description="failure.note"
            :fixed="failure.id === 'refused' ? 'Yours' : 'Fails the request'"
            :label="failure.label"
          />
          <SettingRow :description="NO_RETRY_NOTE" fixed="Never" label="Retried" />
          <SettingRow :description="FAIL_CLOSED_NOTE" fixed="Always" label="Fail-closed" />
        </div>

        <div class="flex flex-col gap-2">
          <h3 class="m-0 text-xs font-medium text-ink">A hook or a webhook</h3>
          <RecordTable :columns="COMPARE_COLUMNS" framed label="A hook or a webhook">
            <li v-for="row in HOOK_OR_WEBHOOK" :key="row.id" class="record-row">
              <span class="record-cell record-cell--primary text-xs font-medium text-ink">{{ row.label }}</span>
              <span class="record-cell text-xs text-ink/75" data-label="A hook">{{ row.hook }}</span>
              <span class="record-cell text-xs text-ink/75" data-label="A webhook">{{ row.webhook }}</span>
            </li>
          </RecordTable>
        </div>
      </div>
    </LayerCard>

    <!-- A hook's configuration, over the list rather than under it: capped from `lg` up and a
         full-height sheet below it. It does not write and close itself, so it stays mounted;
         the edits it offers open over it, and it is still there when they close. -->
    <v-dialog
      v-model="detailOpen"
      :aria-labelledby="detailTitleId"
      :fullscreen="!lgAndUp"
      :max-width="lgAndUp ? 880 : undefined"
      :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
      scrollable
      width="100%"
    >
      <v-card border flat>
        <HookConfigPanel
          :hook="detail"
          :hooks="hooks"
          :project-name="projects.current.name"
          :secret="secret"
          :stats="stats.get(detail.type) ?? null"
          :title-id="detailTitleId"
          :validating="isBusy(`validate:${detail.type}`)"
          @close="detailOpen = false"
          @deadline="ask('deadline', detail.type)"
          @disable="ask('disable', detail.type)"
          @enable="ask('enable', detail.type)"
          @endpoint="ask('endpoint', detail.type)"
          @validate="validate(detail.type)"
        />
      </v-card>
    </v-dialog>

    <!-- Mounted only while open, like every dialog here that writes and then closes. -->
    <HookEndpointDialog
      v-if="dialog === 'endpoint'"
      v-model="endpointOpen"
      :busy="working"
      :current="subjectHook.url"
      :deadline-ms="subjectHook.deadlineMs"
      :enabled="subjectHook.enabled"
      :error="problem"
      :project-name="projects.current.name"
      :secret="secret"
      :type="subject"
      @confirm="confirmEndpoint"
    />

    <HookDeadlineDialog
      v-if="dialog === 'deadline'"
      v-model="deadlineOpen"
      :busy="working"
      :error="problem"
      :hook="subjectHook"
      :hooks="hooks"
      :project-name="projects.current.name"
      :stats="stats.get(subject) ?? null"
      @confirm="confirmDeadline"
    />

    <HookEnableDialog
      v-if="dialog === 'enable'"
      v-model="enableOpen"
      :busy="working"
      :error="problem"
      :hook="subjectHook"
      :hooks="hooks"
      :project-name="projects.current.name"
      :secret="secret"
      @confirm="confirmEnable"
    />

    <HookRemoveDialog
      v-if="dialog === 'disable' || dialog === 'remove'"
      v-model="removeOpen"
      :action="removeAction"
      :busy="working"
      :error="problem"
      :hook="subjectHook"
      :project-name="projects.current.name"
      @confirm="confirmRemove"
    />

    <HookRotateDialog
      v-if="dialog === 'rotate'"
      v-model="rotateOpen"
      :busy="working"
      :enabled-count="enabledCount"
      :error="problem"
      :project-name="projects.current.name"
      @confirm="confirmRotate"
    />

    <HookSecretDialog
      v-if="secretOpen && revealed"
      v-model="secretOpen"
      :project-name="projects.current.name"
      :secret="revealed.secret"
      :until="revealed.until"
      @done="revealed = null"
    />
  </div>
</template>
