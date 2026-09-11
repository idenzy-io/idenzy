<script setup lang="ts">
/**
 * One hook's configuration, the body of the dialog Configure opens, in the note's order: what it
 * is for and the delay a person feels, where it runs, where we call and how long we wait, the
 * call itself, the check, then Enable with the failure it risks stated right above it
 * (notes/hooks.md).
 *
 * Capped from `lg` up and a full-height sheet below it, so the header and the footer are
 * `flex-none` and the middle scrolls; the consequence stays above the activation footer at every
 * width.
 *
 * Enable is never the first thing on offer. It waits on a current check and on something being
 * able to call a hook at all, and says which beside the button rather than greying it out.
 */
import {
  ANSWER_NOTES,
  deadlineOutcome,
  delayLine,
  enableBlocker,
  type FindingVerdict,
  failureLine,
  formatDuration,
  HOOK_CALLS,
  HOOK_FIGURE_DAYS,
  HOOK_ICONS,
  HOOK_KIND_LABELS,
  HOOK_KINDS,
  HOOK_LABELS,
  HOOK_NOTES,
  HOOK_PURPOSES,
  HOOK_TYPE_HEADER,
  type HookConfig,
  type HookSecret,
  type HookStats,
  isCheckCurrent,
  KIND_NOUNS,
  REQUEST_NOTES,
  readinessWords,
  sampleRequest,
  sampleResponse,
  tailPastDeadline,
} from "~/utils/hooks";
import { formatDate, relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  hook: HookConfig;
  hooks: readonly HookConfig[];
  stats: HookStats | null;
  secret: HookSecret | null;
  projectName: string;
  /** The heading's id, which names the dialog this sits in. */
  titleId: string;
  validating: boolean;
}>();

const emit = defineEmits<{
  endpoint: [];
  deadline: [];
  validate: [];
  enable: [];
  disable: [];
  close: [];
}>();

const { lgAndUp } = useDisplay();
const now = useNow({ interval: 30_000 });
const running = HOOK_CALLS.running;

const kind = computed(() => HOOK_KINDS[props.hook.type]);
const readiness = computed(() => readinessWords(props.hook, running));
const blocker = computed(() => enableBlocker(props.hook, running));
const current = computed(() => isCheckCurrent(props.hook));
const late = computed(() => tailPastDeadline(props.stats, props.hook.deadlineMs));

/** The tail and the deadline on one scale, the only way the comparison means anything. */
const latency = computed(() => {
  const p99 = props.stats?.p99 ?? null;
  if (p99 === null) return null;
  const scale = Math.max(props.hook.deadlineMs, p99, 1);
  return {
    p50: props.stats?.p50 ?? null,
    p99,
    tail: Math.round((p99 / scale) * 100),
    line: Math.round((props.hook.deadlineMs / scale) * 100),
  };
});

const VERDICT_ICONS: Record<FindingVerdict, string> = {
  pass: "material-symbols:check-circle-outline",
  warn: "material-symbols:warning-outline",
  fail: "material-symbols:cancel-outline",
  skip: "material-symbols:do-not-disturb-on-outline",
};

const VERDICT_TONES: Record<FindingVerdict, string> = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-error",
  skip: "text-ink/35",
};

const VERDICT_WORDS: Record<FindingVerdict, string> = {
  pass: "Passed",
  warn: "Warning",
  fail: "Failed",
  skip: "Not run",
};
</script>

<template>
  <div :class="lgAndUp ? 'max-h-[88vh]' : 'h-full'" class="flex min-h-0 flex-col">
    <header class="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
      <span
        :class="hook.enabled ? 'bg-primary/10 text-primary' : 'bg-ink/4 text-ink/60 ring-1 ring-ink/6 ring-inset'"
        aria-hidden="true"
        class="flex size-9 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
      >
        <Icon :name="HOOK_ICONS[hook.type]" class="text-lg" />
      </span>

      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="text-[11px] leading-4 text-ink/45">Hook on {{ projectName }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">{{ HOOK_LABELS[hook.type] }}</h2>
          <span class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium text-ink/55">
            {{ HOOK_KIND_LABELS[kind] }}
          </span>
          <StatusBadge :label="readiness.label" :tone="readiness.tone" />
        </div>
        <p class="m-0 text-xs leading-5 text-ink/60">
          {{ HOOK_PURPOSES[hook.type] }} {{ HOOK_NOTES[hook.type] }}
        </p>
        <p class="m-0 flex items-start gap-1.5 text-xs leading-5 text-ink">
          <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/45" name="material-symbols:timer-outline" />
          <span>{{ delayLine(hook.type, hook.deadlineMs) }}</span>
        </p>
        <NuxtLink
          v-if="hook.type === 'customize_claims'"
          class="self-start text-xs font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
          to="/tokens/claims"
        >
          Open claim templates
        </NuxtLink>
      </div>

      <v-btn
        aria-label="Close"
        class="-mt-1 -mr-2 flex-none"
        icon="material-symbols:close"
        size="small"
        variant="text"
        @click="emit('close')"
      />
    </header>

    <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
      <section class="flex flex-col gap-2">
        <h3 class="m-0 text-xs font-medium text-ink">Where it runs</h3>
        <HookPipeline :hooks="hooks" :type="hook.type" />
      </section>

      <div class="grid gap-3 md:grid-cols-2">
        <section
          class="flex min-w-0 flex-col gap-1.5 rounded-(--idenzy-radius-small) bg-ink/4 px-3.5 py-3 ring-1 ring-ink/6 ring-inset"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Endpoint</h3>
            <v-btn class="-my-1 text-xs font-medium" color="neutral" size="small" variant="text" @click="emit('endpoint')">
              {{ hook.url ? "Change" : "Set endpoint" }}
            </v-btn>
          </div>
          <p v-if="hook.url" class="m-0 font-mono text-xs break-all text-ink">{{ hook.url }}</p>
          <p v-else class="m-0 text-xs text-ink/55">
            Not set. Nothing is called until it is, and then only once it is enabled.
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            {{
              secret
                ? `Signed with this project's hook secret, made ${formatDate(secret.createdAt)}.`
                : "Signed with a hook secret made with the first endpoint, and shown once then."
            }}
          </p>
        </section>

        <section
          class="flex min-w-0 flex-col gap-1.5 rounded-(--idenzy-radius-small) bg-ink/4 px-3.5 py-3 ring-1 ring-ink/6 ring-inset"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="m-0 text-xs font-medium text-ink">Deadline</h3>
            <v-btn class="-my-1 text-xs font-medium" color="neutral" size="small" variant="text" @click="emit('deadline')">
              Change
            </v-btn>
          </div>
          <p class="m-0 flex items-baseline gap-1.5">
            <span
              :class="late ? 'text-warning' : 'text-ink'"
              class="font-mono text-lg leading-6 font-medium tabular-nums"
            >
              {{ formatDuration(hook.deadlineMs) }}
            </span>
            <span class="text-[11px] text-ink/55">at most</span>
          </p>
          <template v-if="latency">
            <!-- Two marks on one scale: the tail, then the line it is measured against. -->
            <span class="relative block h-1.5 overflow-hidden rounded-full bg-ink/8">
              <span
                :class="late ? 'bg-warning' : 'bg-primary'"
                :style="{ width: `${latency.tail}%` }"
                class="absolute inset-y-0 left-0 rounded-full"
              />
              <span
                :style="{ left: `calc(${latency.line}% - 1px)` }"
                aria-hidden="true"
                class="absolute inset-y-0 w-px bg-ink/45"
              />
            </span>
            <p class="m-0 text-[11px] leading-4 text-ink/55">
              p99 {{ formatDuration(latency.p99) }}<template v-if="latency.p50 !== null">,
              median {{ formatDuration(latency.p50) }}</template>, over {{ HOOK_FIGURE_DAYS }} days.
            </p>
          </template>
          <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
            {{
              running
                ? "Not called yet, so there is no latency to set it against."
                : "Latency not measured: nothing calls it yet."
            }}
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            {{ deadlineOutcome(hook.type, hook.deadlineMs) }}
          </p>
        </section>
      </div>

      <section class="flex flex-col gap-2">
        <div class="flex flex-col gap-0.5">
          <h3 class="m-0 text-xs font-medium text-ink">The call</h3>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            A signed POST carrying
            <span class="font-mono text-ink/75">{{ HOOK_TYPE_HEADER }}: {{ hook.type }}</span>,
            answered with a 200 inside the deadline.
          </p>
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-[11px] text-ink/55">What arrives</span>
            <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
              <CodeBlock :code="sampleRequest(hook.type)" lang="json" />
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/55">{{ REQUEST_NOTES[hook.type] }}</p>
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-[11px] text-ink/55">What to answer</span>
            <div class="overflow-x-auto rounded-(--idenzy-radius-small) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset">
              <CodeBlock :code="sampleResponse(hook.type)" lang="json" />
            </div>
            <p class="m-0 text-[11px] leading-4 text-ink/55">{{ ANSWER_NOTES[hook.type] }}</p>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h3 class="m-0 text-xs font-medium text-ink">Validation</h3>
          <span v-if="hook.check" class="text-[11px] text-ink/45">
            {{ current ? `Run ${relativeTimeWords(hook.check.at, now)}` : "Run before the last change" }}
          </span>
        </div>
        <ul
          v-if="hook.check"
          :class="current ? '' : 'opacity-60'"
          class="m-0 flex list-none flex-col divide-y divide-line p-0"
        >
          <li v-for="finding in hook.check.findings" :key="finding.id" class="flex items-start gap-2.5 py-2">
            <Icon
              :class="VERDICT_TONES[finding.verdict]"
              :name="VERDICT_ICONS[finding.verdict]"
              aria-hidden="true"
              class="mt-0.5 flex-none text-base"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-xs text-ink">
                <span class="sr-only">{{ VERDICT_WORDS[finding.verdict] }}: </span>{{ finding.label }}
              </span>
              <span class="text-[11px] leading-4 text-ink/55">{{ finding.detail }}</span>
            </span>
          </li>
        </ul>
        <p v-else class="m-0 text-[11px] leading-4 text-ink/55">
          Checks the address, the secret and the budget, then calls your endpoint twice: signed,
          and signed with the wrong secret.
          <template v-if="!running">The calls are not made on this deployment yet.</template>
        </p>
      </section>
    </div>

    <!-- The failure a hook risks, above the footer that enables it (notes/hooks.md). -->
    <div class="flex flex-none flex-col gap-2.5 border-t border-line px-5 py-3">
      <p class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/80">
        <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-warning" name="material-symbols:warning-outline" />
        <span>{{ failureLine(hook.type) }}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <v-btn
          :disabled="hook.url === null"
          :loading="validating"
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:fact-check-outline"
          size="small"
          variant="outlined"
          @click="emit('validate')"
        >
          Validate configuration
        </v-btn>
        <v-btn
          v-if="hook.enabled"
          class="ml-auto text-xs font-medium"
          color="neutral"
          size="small"
          variant="outlined"
          @click="emit('disable')"
        >
          Turn off {{ KIND_NOUNS[kind] }}
        </v-btn>
        <v-btn
          v-else
          :disabled="blocker !== null"
          class="ml-auto text-xs font-medium"
          color="primary"
          size="small"
          variant="flat"
          @click="emit('enable')"
        >
          Review and enable
        </v-btn>
      </div>
      <p v-if="!hook.enabled && blocker" class="m-0 text-[11px] leading-4 text-ink/55 sm:text-right">
        {{ blocker }}
      </p>
    </div>
  </div>
</template>
