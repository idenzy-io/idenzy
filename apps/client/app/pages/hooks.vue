<script setup lang="ts">
/**
 * Synchronous customer hooks: the five points where a customer's own service is called
 * while one of their users is waiting (PROJECT.md 3.2, 9.6).
 *
 * The page is built around one distinction and repeats it until it has landed, because
 * everybody arrives here from the webhooks screen next door and the two are opposites. A
 * webhook is told afterwards, retried, and cannot break anything. A hook is called during
 * the request, the sign-in is blocked on the reply, and there is a hard deadline after which
 * the request fails. So a hook is the only thing on this platform that lets a customer's own
 * code change the outcome of a sign-in, and it is also the only thing that lets their
 * downtime become ours. Both halves of that belong on the screen where the switch is.
 *
 * Fail-closed is not a setting and the page never presents it as one. A gate that could be
 * got past by being slow was never a gate: an attacker able to make a customer's endpoint
 * time out would otherwise turn `before-sign-in` off from the outside. What the screen does
 * instead is say, per hook, what a failure means in that hook's own words, because a refused
 * sign-in and an unsent email are the same policy and very different sentences.
 *
 * The pipeline card is the one people came for. The order is a fact with a consequence
 * nobody expects: `AuthFlow` consults the MFA gate after `verify` and before the hooks, so a
 * `before-sign-in` hook is never handed a half-authenticated user and cannot be used to wave
 * one past a challenge.
 *
 * Two things are deliberately quiet. The deadline budget is added up in the header of the
 * list, because a budget assembled one switch at a time is one nobody totals, and the number
 * a customer is choosing is the worst case rather than today's median. And `customize-claims`
 * carries a pointer to claim templates, because the template is a read the transaction was
 * making anyway where the hook is a round trip inside every sign-in, and a screen that
 * offered them as equals would be selling the expensive one.
 */
import {
  addedToSignIn,
  BUDGET_WARNING_MS,
  DEADLINE_ISSUE,
  DEADLINE_MAX_MS,
  DEADLINE_MIN_MS,
  formatDuration,
  HOOK_FAILURES,
  HOOK_LABELS,
  HOOK_SIGNATURE_HEADER,
  HOOK_TIMESTAMP_HEADER,
  HOOK_TIMESTAMP_TOLERANCE_SECONDS,
  HOOK_TYPE_HEADER,
  type HookType,
  isHookLive,
  NO_RETRY_NOTE,
} from "~/utils/hooks";

const projects = useProjectStore();
const store = useHooksStore();

const hooks = computed(() => store.hooksFor(projects.current.id));
const live = computed(() => hooks.value.filter(isHookLive));

/** Per hook, or null where it is not in the path. Read once so the row and the bars agree. */
const stats = computed(
  () =>
    new Map(hooks.value.map((hook) => [hook.type, store.statsFor(projects.current.id, hook.type)])),
);

/** What a sign-in picks up in the worst case, which is what a deadline actually buys. */
const budget = computed(() => addedToSignIn(hooks.value));

const totals = computed(() => {
  let calls = 0;
  let refused = 0;
  let failed = 0;
  const callsDaily = Array.from({ length: 30 }, () => 0);
  const failedDaily = Array.from({ length: 30 }, () => 0);
  for (const entry of stats.value.values()) {
    if (entry === null) continue;
    calls += entry.calls;
    refused += entry.refused;
    failed += entry.failed;
    entry.callsDaily.forEach((value, day) => {
      callsDaily[day] = (callsDaily[day] ?? 0) + value;
    });
    entry.failedDaily.forEach((value, day) => {
      failedDaily[day] = (failedDaily[day] ?? 0) + value;
    });
  }
  return { calls, refused, failed, callsDaily, failedDaily };
});

/** Which cards start unfolded. The list and where it runs are what a visit is for. */
const expanded = reactive({ failure: false, signing: false, never: false });

/*
 * Saving. Every control writes itself, like the other settings screens, so each row can
 * show its own wait rather than the page holding a draft nobody asked for.
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

function toggle(type: HookType, enabled: boolean) {
  void whileBusy(type, () => store.patch(projects.current.id, type, { enabled }));
}

/** Clearing the URL takes the hook out of the path, so the switch goes with it. */
function removeEndpoint(type: HookType) {
  void whileBusy(type, () => store.patch(projects.current.id, type, { url: null, enabled: false }));
}

/*
 * The two dialogs. Which hook they are about is held here rather than passed down, so the
 * subject survives the frame in which the dialog is closing.
 */
const editing = ref<HookType | null>(null);
const endpointOpen = ref(false);
const deadlineOpen = ref(false);

function askEndpoint(type: HookType) {
  editing.value = type;
  endpointOpen.value = true;
}

function askDeadline(type: HookType) {
  editing.value = type;
  deadlineOpen.value = true;
}

const editingHook = computed(() =>
  editing.value === null ? null : (hooks.value.find((hook) => hook.type === editing.value) ?? null),
);
const editingBusy = computed(() => editing.value !== null && isBusy(editing.value));

function confirmEndpoint(url: string) {
  const type = editing.value;
  if (type === null) return;
  void whileBusy(type, () => store.patch(projects.current.id, type, { url }));
}

function confirmDeadline(value: number) {
  const type = editing.value;
  if (type === null) return;
  if (editingHook.value?.deadlineMs === value) return;
  void whileBusy(type, () => store.patch(projects.current.id, type, { deadlineMs: value }));
}

/* A dialog belongs to the project it was opened from. */
watch(
  () => projects.current.id,
  () => {
    endpointOpen.value = false;
    deadlineOpen.value = false;
    editing.value = null;
  },
);

const saving = computed(() => busy.value.size > 0);
const lastSaved = computed(() => store.lastSavedAt(projects.current.id));

/**
 * The tail against the deadline, per live hook.
 *
 * Drawn against the largest of the two so both bars share a scale, which is the only way the
 * comparison means anything: a p99 bar longer than the deadline bar is a share of requests
 * being cut off on purpose, and that is the whole reason this panel is here.
 */
const latency = computed(() =>
  live.value.map((hook) => {
    const entry = stats.value.get(hook.type) ?? null;
    const p99 = entry?.p99 ?? 0;
    const scale = Math.max(hook.deadlineMs, p99, 1);
    return {
      type: hook.type,
      deadlineMs: hook.deadlineMs,
      p50: entry?.p50 ?? null,
      p99: entry?.p99 ?? null,
      deadlineShare: Math.round((hook.deadlineMs / scale) * 100),
      p99Share: Math.round((p99 / scale) * 100),
      over: p99 > hook.deadlineMs,
    };
  }),
);

const GUIDES_URL = "https://idenzy.dev/docs/hooks";

const GUIDES = [
  {
    icon: "material-symbols:alt-route",
    title: "Writing a hook endpoint",
    detail: "The five payloads, what a 200 must carry, and the deadline you are working to.",
    href: GUIDES_URL,
  },
  {
    icon: "material-symbols:lock-outline",
    title: "Verifying the signature",
    detail: "The same scheme deliveries use, so one function covers both paths.",
    href: "https://idenzy.dev/docs/webhooks/verifying",
  },
  {
    icon: "material-symbols:token-outline",
    title: "Claims without a hook",
    detail: "What a claim template can already do, and when it genuinely cannot.",
    href: "https://idenzy.dev/docs/tokens/claims",
  },
  {
    icon: "material-symbols:speed",
    title: "Keeping a hook fast",
    detail: "Why the tail is the number that matters, and what to do about it.",
    href: `${GUIDES_URL}/latency`,
  },
];
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader icon="material-symbols:alt-route" title="Hooks">
      <template #description>
        Your own service, called from inside a request on
        <span class="font-medium text-ink">{{ projects.current.name }}</span> while the person
        signing in waits. The only place your code can change what a sign-in does, and the
        only place your downtime becomes theirs.
      </template>
      <template #actions>
        <v-btn
          :href="GUIDES_URL"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:menu-book-outline"
          rel="noopener"
          size="small"
          target="_blank"
          variant="outlined"
        >
          Hook guide
        </v-btn>
      </template>
    </PageHeader>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
      <div class="flex min-w-0 flex-col gap-6">
        <LayerCard
          description="Two ways of telling you something happened, and only one of them can break a sign-in. Reach for the other one unless you need to change the outcome."
          title="A hook is not a webhook"
        >
          <div class="grid gap-3 sm:grid-cols-2">
            <section
              class="flex flex-col gap-2 rounded-(--idenzy-radius-small) border border-primary/30 bg-primary/4 px-3.5 py-3"
            >
              <h3 class="m-0 flex items-center gap-2 text-xs font-medium text-ink">
                <Icon
                  aria-hidden="true"
                  class="text-sm text-primary"
                  name="material-symbols:alt-route"
                />
                A hook
              </h3>
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-[11px] leading-4 text-ink/70">
                <li>Called during the request. The sign-in waits for the answer.</li>
                <li>Can refuse it, or change what the token carries.</li>
                <li>One attempt, one deadline. Never retried.</li>
                <li>
                  <span class="font-medium text-ink">Fail-closed:</span> a call that does not
                  come back fails the request.
                </li>
              </ul>
            </section>

            <section
              class="flex flex-col gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas px-3.5 py-3"
            >
              <h3 class="m-0 flex items-center gap-2 text-xs font-medium text-ink">
                <Icon
                  aria-hidden="true"
                  class="text-sm text-ink/60"
                  name="material-symbols:webhook"
                />
                A webhook
              </h3>
              <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-[11px] leading-4 text-ink/70">
                <li>Sent afterwards. Nothing waits for it.</li>
                <li>Cannot change anything that already happened.</li>
                <li>Retried for a day, at least once, in no guaranteed order.</li>
                <li>
                  <span class="font-medium text-ink">Fail-safe:</span> a receiver that is down
                  costs you notifications and costs your users nothing.
                </li>
              </ul>
              <NuxtLink
                class="mt-0.5 text-[11px] font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                to="/webhooks"
              >
                Set up a webhook instead
              </NuxtLink>
            </section>
          </div>
        </LayerCard>

        <LayerCard
          :padded="false"
          description="Five points where we will call you. Each one is off until it has an endpoint, and each says what happens to the request when the call does not come back."
          title="Hook points"
        >
          <template #badge>
            <StatusBadge
              :label="live.length === 0 ? 'None live' : `${live.length} live`"
              :tone="live.length === 0 ? 'neutral' : 'success'"
            />
          </template>
          <template #actions>
            <v-tooltip
              location="top"
              max-width="300"
              text="The worst case a sign-in picks up: every live hook on that path, each waited for up to its own deadline. Today's median is lower and the day your endpoint is unwell it will not be."
            >
              <template #activator="{ props: tip }">
                <span
                  v-bind="tip"
                  :class="budget > BUDGET_WARNING_MS ? 'text-warning' : 'text-ink/60'"
                  class="flex items-center gap-1.5 text-xs"
                >
                  <Icon aria-hidden="true" class="text-sm" name="material-symbols:timer-outline" />
                  <span class="font-mono tabular-nums">
                    {{ budget === 0 ? "Nothing" : `+${formatDuration(budget)}` }}
                  </span>
                  on a sign-in
                </span>
              </template>
            </v-tooltip>
          </template>

          <div v-if="store.loading" class="divide-y divide-line">
            <div v-for="row in 3" :key="row" class="flex items-center gap-4 px-4 py-5">
              <span class="size-9 flex-none animate-pulse rounded-(--idenzy-radius-x-small) bg-ink/8" />
              <span class="flex min-w-0 flex-1 flex-col gap-2">
                <span class="h-3 w-40 animate-pulse rounded-full bg-ink/8" />
                <span class="h-2.5 w-full max-w-lg animate-pulse rounded-full bg-ink/6" />
                <span class="h-2.5 w-56 animate-pulse rounded-full bg-ink/6" />
              </span>
            </div>
          </div>

          <div v-else class="divide-y divide-line">
            <HookRow
              v-for="hook in hooks"
              :key="hook.type"
              :busy="isBusy(hook.type)"
              :hook="hook"
              :stats="stats.get(hook.type) ?? null"
              @configure="askEndpoint(hook.type)"
              @deadline="askDeadline(hook.type)"
              @remove="removeEndpoint(hook.type)"
              @toggle="toggle(hook.type, $event)"
            />
          </div>

          <div
            class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[10px] leading-4 text-ink/45"
          >
            <p class="m-0">
              A switch here writes on the spot. Turning a gate off stops it refusing anybody
              from the next request, which is the point and is worth saying out loud.
            </p>
            <p class="m-0">Every change is in the audit log.</p>
          </div>
        </LayerCard>

        <LayerCard
          description="One request, in order, with your three points on it. Everything above a point has already happened by the time we call you."
          title="Where each hook runs"
        >
          <HookPipeline :hooks="hooks" />

          <p
            class="m-0 mt-5 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas px-3 py-2.5 text-[11px] leading-4 text-ink/65"
          >
            <Icon
              aria-hidden="true"
              class="mt-px flex-none text-sm text-ink/40"
              name="material-symbols:mail-outline"
            />
            <span>
              The two delivery hooks are not on this path. They run on the dispatcher instead,
              in place of our own sender, after whatever asked for the message has already
              been answered.
            </span>
          </p>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.failure"
          expandable
          description="Four ways a call does not come back with a yes, and what each one leaves behind."
          title="When a hook fails"
        >
          <div class="divide-y divide-line">
            <SettingRow
              v-for="failure in HOOK_FAILURES"
              :key="failure.id"
              :description="failure.note"
              :fixed="failure.id === 'refused' ? 'Yours' : 'Fails the request'"
              :label="failure.label"
            />
            <SettingRow :description="NO_RETRY_NOTE" fixed="Never" label="Retried" />
            <SettingRow
              description="Fail-closed is not a switch and will not become one. A gate that could be got past by being slow was never a gate: anybody able to make your endpoint time out could otherwise turn it off from the outside."
              fixed="Always"
              label="Fail-closed"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.signing"
          expandable
          description="The same scheme a webhook delivery uses, so the verification you have already written covers both."
          title="Signing and headers"
        >
          <div class="divide-y divide-line">
            <SettingRow
              :fixed="HOOK_SIGNATURE_HEADER"
              description="Over the timestamp, a dot, then the raw body, exactly as a delivery is. The body has to be the bytes as they arrived: a handler that parses the JSON and re-serialises it is signing a different string and will never match."
              label="How it is signed"
            />
            <SettingRow
              :description="`Refuse anything more than ${HOOK_TIMESTAMP_TOLERANCE_SECONDS} seconds out of step before you check the digest. That is what makes the signature replay-safe rather than merely authentic.`"
              :fixed="HOOK_TIMESTAMP_HEADER"
              label="How replay is stopped"
            />
            <SettingRow
              description="Your webhook signing secret, not a second one. One secret and one verification function is one place for it to be wrong, and rolling it covers both paths at once."
              fixed="Shared"
              label="Which secret"
            />
            <SettingRow
              description="Names which of the five the body is for, so one route can serve them all. Switching on it beats five endpoints that drift apart, and it is what the dialog suggests when you set the first one."
              :fixed="HOOK_TYPE_HEADER"
              label="Which hook"
            />
            <SettingRow
              description="We call from our own network, so an address on your machine is one nothing of ours can reach. Use a tunnel that gives you a public hostname while you are building."
              fixed="https only"
              label="Where we can call"
            />
          </div>
        </LayerCard>

        <LayerCard
          v-model:open="expanded.never"
          expandable
          description="Four things a hook is regularly expected to do and does not."
          title="What a hook never does"
        >
          <div class="divide-y divide-line">
            <SettingRow
              description="A hook runs before the thing it is about, or it is not a hook. If what you want is to be told after the fact, that is a webhook, and it is the one that cannot take your sign-ins down with it."
              fixed="Never"
              label="Run after the answer went back"
            />
            <SettingRow
              description="Nothing about a credential leaves us. A gate is handed who is signing in and how, never the password, the code or the assertion, because a hook that could read one would make every customer's endpoint a place a password is."
              fixed="Never"
              label="See a credential"
            />
            <SettingRow
              description="A hook cannot let somebody past a second factor. The MFA gate runs before it, so by the time you are called the factor is already proved, and a hook returning allow on an account that owes one changes nothing."
              fixed="Never"
              label="Skip a second factor"
            />
            <SettingRow
              description="It is not a place to do work. Whatever you were going to write to your own database belongs on the webhook, where taking a second is your problem instead of your users'. A hook answers a question and returns."
              fixed="Never"
              label="Wait on your own side"
            />
          </div>
        </LayerCard>
      </div>

      <aside class="flex flex-col gap-4 xl:sticky xl:top-20">
        <div class="flex items-baseline justify-between px-1">
          <h2 class="m-0 text-base font-semibold tracking-tight text-ink">Hooks</h2>
          <span class="text-xs text-ink/55">Last 30 days</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <UsageTile
            :seed="81"
            :series="totals.callsDaily"
            :value="totals.calls"
            info="Calls made to your endpoints across every live hook."
            label="Calls"
          />
          <UsageTile
            :seed="83"
            :value="totals.refused"
            info="Calls your service answered with a no. The only kind of failure that is your service working correctly."
            label="Refused"
          />
          <UsageTile
            :seed="85"
            :series="totals.failedDaily"
            :value="totals.failed"
            info="Calls that timed out, returned a bad status, or came back in a shape we could not read. Every one of these failed somebody's request."
            label="Failed"
          />
          <!-- A count rather than the deadline budget: UsageTile writes a figure compactly
               and carries no unit, so 1500 milliseconds would read as "1.5k". The budget is a
               duration and lives where a duration has context, above the bars. -->
          <UsageTile
            :seed="87"
            :value="live.length"
            info="Hooks with an endpoint and their switch on. Anything else on the list is configuration nobody is calling."
            label="Live hooks"
          />
        </div>

        <LayerCard
          :padded="false"
          description="The tail against the deadline you set. A p99 past the line is a share of requests being cut off on purpose."
          title="Latency and deadlines"
        >
          <p
            v-if="latency.length > 0"
            :class="budget > BUDGET_WARNING_MS ? 'text-warning' : 'text-ink/60'"
            class="m-0 flex items-baseline gap-2 border-b border-line px-4 py-3 text-xs"
          >
            <span class="font-mono text-base leading-none font-medium tabular-nums">
              +{{ formatDuration(budget) }}
            </span>
            <span>worst case on a sign-in</span>
          </p>
          <ul v-if="latency.length > 0" class="m-0 flex list-none flex-col gap-3 p-4 text-xs">
            <li v-for="entry in latency" :key="entry.type" class="flex flex-col gap-1.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="truncate text-ink/80">{{ HOOK_LABELS[entry.type] }}</span>
                <span
                  :class="entry.over ? 'text-warning' : 'text-ink/55'"
                  class="flex-none font-mono text-[11px] tabular-nums"
                >
                  {{ entry.p99 === null ? "–" : formatDuration(entry.p99) }}
                  <span class="text-ink/35">/ {{ formatDuration(entry.deadlineMs) }}</span>
                </span>
              </div>
              <!-- Two bars on one scale: the tail, then the line it is measured against. -->
              <span class="relative block h-1.5 overflow-hidden rounded-full bg-ink/8">
                <span
                  :class="entry.over ? 'bg-warning' : 'bg-primary'"
                  :style="{ width: `${entry.p99Share}%` }"
                  class="absolute inset-y-0 left-0 rounded-full"
                />
                <span
                  :style="{ left: `${entry.deadlineShare}%` }"
                  aria-hidden="true"
                  class="absolute inset-y-0 w-px bg-ink/45"
                />
              </span>
              <span v-if="entry.p50 !== null" class="text-[10px] leading-3 text-ink/45">
                Median {{ formatDuration(entry.p50) }}
              </span>
            </li>
          </ul>
          <p v-else class="m-0 px-4 py-6 text-center text-xs text-ink/50">
            No hook is in the path, so nothing on this project waits on anybody else.
          </p>
        </LayerCard>

        <LayerCard :padded="false" title="Guides">
          <ul class="m-0 list-none divide-y divide-line p-0">
            <li v-for="guide in GUIDES" :key="guide.href">
              <a
                :href="guide.href"
                class="flex items-start gap-3 px-4 py-3 text-xs no-underline transition-colors duration-150 hover:bg-ink/3"
                rel="noopener"
                target="_blank"
              >
                <Icon
                  :name="guide.icon"
                  aria-hidden="true"
                  class="mt-px flex-none text-xl text-ink/70"
                />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="font-medium text-ink">{{ guide.title }}</span>
                  <span class="line-clamp-1 text-[11px] text-ink/55">{{ guide.detail }}</span>
                </span>
              </a>
            </li>
          </ul>
        </LayerCard>

        <SaveStatus :last-saved="lastSaved" :saving="saving" />
      </aside>
    </div>

    <HookEndpointDialog
      v-model="endpointOpen"
      :busy="editingBusy"
      :current="editingHook?.url ?? null"
      :deadline-ms="editingHook?.deadlineMs ?? 0"
      :type="editing"
      @confirm="confirmEndpoint"
    />

    <NumberDialog
      v-model="deadlineOpen"
      :current="editingHook?.deadlineMs ?? 0"
      :hint="`Between ${DEADLINE_MIN_MS} and ${DEADLINE_MAX_MS}. Set it above your endpoint's tail, not its median.`"
      :integer-label="DEADLINE_ISSUE.integer"
      :max="DEADLINE_MAX_MS"
      :min="DEADLINE_MIN_MS"
      :range-label="DEADLINE_ISSUE.range"
      :title="`Change the ${editing ? HOOK_LABELS[editing].toLowerCase() : ''} deadline`"
      description="How long we wait before the call is abandoned and the request fails. Every millisecond of it is added to somebody's sign-in on the day your endpoint is slow, and a deadline under your own p99 is a decision to fail that share of requests."
      label="Wait at most"
      suffix="ms"
      @confirm="confirmDeadline"
    />
  </div>
</template>
