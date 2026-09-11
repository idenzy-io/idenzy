<script setup lang="ts">
/**
 * The answer to one address, directly under the field it was typed into.
 *
 * It is one block rather than a row in a table because the operator asked about a person,
 * not about a list: the verdict, what the block says, what to do about it and the release
 * are the same reading, and splitting them across a table and a drawer is what made this
 * screen answer "which customer needs help" with a column of hashes.
 *
 * Four states, and the third is the one the wording is for. Blocked and released are
 * definite. "Not blocked" is only as good as the pipeline behind it, so where nothing
 * writes a block the tone drops to neutral and the words say unknown rather than
 * deliverable: a green tick over an unread recorder is a promise the panel cannot keep.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  checkedLine,
  type LookupAnswer,
  nextStepFor,
  type ReleaseRecord,
  reasonInfo,
  reasonLabel,
  releaseDecision,
  SUPPRESSION_CHANNEL_LABELS,
  shortDigest,
  sourceLabel,
} from "~/utils/suppressions";
import { formatDateTime, relativeTime, relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  answer: LookupAnswer;
  projectName: string;
  /** Whether a bounce reaches the list at all, which decides how much "clear" is worth. */
  ingestion: boolean;
  /** The release just made from this answer, where one was made. */
  released: ReleaseRecord | null;
  now: Date;
}>();

defineEmits<{
  release: [];
  evidence: [];
  recheck: [];
  another: [];
}>();

type ResultState = "blocked" | "clear" | "unknown" | "unavailable" | "released";

const state = computed<ResultState>(() => {
  if (props.released !== null) return "released";
  if (props.answer.verdict === "unavailable") return "unavailable";
  if (props.answer.verdict === "blocked") return "blocked";
  return props.ingestion ? "clear" : "unknown";
});

/* Written out in full so @nuxt/icon bundles them. */
const MARKS: Record<ResultState, { icon: string; ink: string; frame: string; badge: string }> = {
  blocked: {
    icon: "material-symbols:do-not-disturb-on-outline",
    ink: "text-warning",
    frame: "border-warning/40 bg-warning/6",
    badge: "Blocked",
  },
  clear: {
    icon: "material-symbols:check-circle-outline",
    ink: "text-success",
    frame: "border-success/40 bg-success/6",
    badge: "Not blocked",
  },
  unknown: {
    icon: "material-symbols:help-outline",
    ink: "text-ink/60",
    frame: "border-line bg-ink/3",
    badge: "Not found",
  },
  unavailable: {
    icon: "material-symbols:cloud-off-outline",
    ink: "text-ink/60",
    frame: "border-line bg-ink/3",
    badge: "Lookup unavailable",
  },
  released: {
    icon: "material-symbols:mark-email-read-outline",
    ink: "text-success",
    frame: "border-success/40 bg-success/6",
    badge: "Released",
  },
};

const TONES: Record<ResultState, BadgeTone> = {
  blocked: "warning",
  clear: "success",
  unknown: "neutral",
  unavailable: "neutral",
  released: "success",
};

const mark = computed(() => MARKS[state.value]);

const headline = computed(() => {
  switch (state.value) {
    case "released":
      return "can be sent to again";
    case "blocked":
      return "is blocked from delivery";
    case "clear":
      return "is not blocked";
    case "unknown":
      return "is not on the block list";
    default:
      return "was not checked";
  }
});

const blockInfo = computed(() =>
  props.answer.email === null ? undefined : reasonInfo(props.answer.email.reason),
);

const step = computed(() => nextStepFor(props.answer, props.ingestion));
const decision = computed(() =>
  props.answer.email === null ? null : releaseDecision(props.answer.email),
);
const scope = computed(() => checkedLine(props.answer, props.projectName));

/** The four facts the mockup puts under the verdict, in its order. */
const facts = computed(() => {
  const row = props.answer.email;
  if (row === null) return [];
  return [
    { id: "reason", label: "Reason", value: reasonLabel(row.reason) },
    { id: "channel", label: "Channel", value: SUPPRESSION_CHANNEL_LABELS[row.channel] },
    { id: "recorded", label: "Recorded", value: relativeTime(row.createdAt, props.now) },
    { id: "source", label: "Source", value: sourceLabel(row.reason) },
  ];
});
</script>

<template>
  <div :class="mark.frame" class="flex flex-col rounded-(--idenzy-radius-small) border">
    <!-- The verdict, with the address in it. It is shown back rather than assumed, so an
         answer is never read against an address the reader did not actually type. -->
    <div class="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 items-start gap-2.5">
        <Icon
          :class="mark.ink"
          :name="mark.icon"
          aria-hidden="true"
          class="mt-px flex-none text-lg"
        />
        <div class="flex min-w-0 flex-col gap-1">
          <p class="m-0 text-sm leading-5 font-medium text-ink">
            <!-- `break-all` on the address alone: an address has no spaces to wrap at,
                 and the sentence after it does. -->
            <span class="font-mono break-all">{{ answer.asked }}</span>
            <!-- The space is inside the interpolation: the compiler eats a leading one
                 written as text, and the address ran into its own verdict. -->
            <span class="font-normal text-ink/70">{{ ` ${headline}` }}</span>
          </p>
          <p class="m-0 text-xs leading-5 text-ink/60">
            {{ scope }}
            <template v-if="answer.verdict !== 'unavailable'">
              Checked {{ relativeTimeWords(answer.checkedAt, now) }}.
            </template>
          </p>
        </div>
      </div>

      <StatusBadge :label="mark.badge" :tone="TONES[state]" class="flex-none self-start" />
    </div>

    <!-- Reason, channel, recorded and source: what the block says, before what to do
         about it. A grid rather than a sentence, because a support agent copies these. -->
    <dl
      v-if="facts.length > 0 && state !== 'released'"
      class="m-0 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/70 px-4 py-3 sm:grid-cols-4"
    >
      <div v-for="fact in facts" :key="fact.id" class="flex min-w-0 flex-col gap-0.5">
        <dt class="text-[11px] leading-4 text-ink/50">{{ fact.label }}</dt>
        <dd class="m-0 text-xs leading-5 font-medium text-ink">
          {{ fact.value }}
        </dd>
      </div>
    </dl>

    <p
      v-if="blockInfo && state !== 'released'"
      class="m-0 border-t border-line/70 px-4 py-3 text-xs leading-5 text-ink/60"
    >
      {{ blockInfo.note }}
    </p>

    <!-- The same address on another channel. Context, and the reason the release names
         its own channel: an email release leaves an SMS block exactly where it was. -->
    <div
      v-if="answer.others.length > 0"
      class="flex flex-col gap-1 border-t border-line/70 px-4 py-3"
    >
      <p class="m-0 text-xs leading-5 text-ink/70">
        <span class="font-medium text-ink">Also blocked on another channel.</span>
        <template v-for="other in answer.others" :key="other.id">
          {{ ` ${SUPPRESSION_CHANNEL_LABELS[other.channel]}, ${reasonLabel(other.reason).toLowerCase()}, recorded ${relativeTimeWords(other.createdAt, now)}.` }}
        </template>
      </p>
      <p class="m-0 text-[11px] leading-4 text-ink/55">
        Each channel is its own record. Nothing on this screen touches them, and allowing
        email again leaves them blocked.
      </p>
    </div>

    <!-- The release confirmation. It says what was not done as well as what was: nobody
         is sent a test message to prove it, because a silent send is a send. -->
    <div v-if="released" class="flex flex-col gap-1 border-t border-line/70 px-4 py-3">
      <p class="m-0 text-xs leading-5 text-ink/70">
        The {{ SUPPRESSION_CHANNEL_LABELS[released.channel].toLowerCase() }} block recorded as
        <span class="font-medium text-ink">{{ reasonLabel(released.reason).toLowerCase() }}</span>
        was removed {{ relativeTimeWords(released.releasedAt, now) }}. The next message to
        this address is attempted normally.
      </p>
      <p class="m-0 text-[11px] leading-4 text-ink/55">
        Nothing was sent to check. Your reason was kept with the release, so the decision
        stays readable after the block itself is gone.
      </p>
    </div>

    <!-- What to do, before the button that overrules a mailbox provider. -->
    <div v-else class="flex flex-col gap-3 border-t border-line/70 px-4 py-3.5">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="text-[11px] leading-4 font-medium tracking-wide text-ink/50 uppercase">
            Recommended next step
          </span>
          <span class="text-sm leading-5 font-medium text-ink">{{ step.title }}</span>
        </div>
        <v-btn
          class="w-full flex-none text-xs font-medium sm:w-auto"
          color="neutral"
          prepend-icon="material-symbols:receipt-long-outline"
          size="small"
          variant="outlined"
          @click="$emit('evidence')"
        >
          View delivery evidence
        </v-btn>
      </div>

      <p class="m-0 text-xs leading-5 text-ink/65">{{ step.detail }}</p>

      <ol class="m-0 flex list-none flex-col gap-1.5 p-0">
        <li
          v-for="(line, index) in step.steps"
          :key="line"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2"
        >
          <span
            class="mt-px flex h-4 w-5 flex-none items-center justify-center rounded-full bg-ink/8 font-mono text-[10px] text-ink/60"
          >
            {{ index + 1 }}
          </span>
          <span class="text-xs leading-5 text-ink/65">{{ line }}</span>
        </li>
      </ol>
    </div>

    <!-- The conditional action. It exists only where a block does, and it names the
         channel it releases rather than promising the address is unblocked everywhere. -->
    <div
      class="flex flex-col gap-2.5 border-t border-line/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p class="m-0 min-w-0 text-[11px] leading-4 text-ink/55">
        <template v-if="released">
          Ask again to see the address answered against the list as it is now.
        </template>
        <template v-else-if="decision">{{ decision.note }}</template>
        <template v-else-if="answer.verdict === 'unavailable'">
          Nothing was released and nothing was recorded.
        </template>
        <template v-else>
          There is nothing to release: a release removes a block, and this address has none.
        </template>
      </p>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <template v-if="released">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:refresh"
            size="small"
            variant="outlined"
            @click="$emit('recheck')"
          >
            Ask again
          </v-btn>
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            prepend-icon="material-symbols:search"
            size="small"
            variant="tonal"
            @click="$emit('another')"
          >
            Check another address
          </v-btn>
        </template>

        <v-btn
          v-else-if="decision?.allowed"
          class="text-xs font-medium"
          color="warning"
          prepend-icon="material-symbols:undo"
          size="small"
          variant="flat"
          @click="$emit('release')"
        >
          Allow email again
        </v-btn>

        <v-btn
          v-else
          class="text-xs font-medium"
          color="neutral"
          prepend-icon="material-symbols:search"
          size="small"
          variant="outlined"
          @click="$emit('another')"
        >
          Check another address
        </v-btn>
      </div>
    </div>

    <!-- The digest, last: it is the proof of what left the browser rather than a fact
         about the person, and it is the only string on this block worth copying. -->
    <div
      v-if="answer.digest !== ''"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line/70 px-4 py-2 text-[11px] text-ink/50"
    >
      <span>Asked as</span>
      <span class="font-mono text-ink/70">{{ shortDigest(answer.digest) }}</span>
      <span class="text-ink/35">·</span>
      <span>the address itself was not sent, logged or put in the URL</span>
      <span class="ml-auto font-mono tabular-nums">{{ formatDateTime(answer.checkedAt) }}</span>
    </div>
  </div>
</template>
