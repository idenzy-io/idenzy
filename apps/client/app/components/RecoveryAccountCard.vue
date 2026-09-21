<script setup lang="ts">
/**
 * One account picked out of the recovery queue: what it holds, and the safe way to fix it.
 *
 * The queue's whole problem was that it identified people it could not help. Clearing
 * somebody's codes is not the remedy for somebody who has none, so what leads here is the
 * account's own context and the steps its owner takes, written for pasting into a ticket
 * (`notes/mfa-recovery.md` P1). Invalidating what is left is real and stays, folded under
 * Advanced, one click further away than the thing that actually helps.
 *
 * Nothing in here reveals or mints a code. The panel holds a count and a pair of
 * timestamps, and that is all the server publishes about a set.
 */
import {
  CODE_SET,
  factorLabel,
  nextStepFor,
  REPLACEMENT_STEPS,
  type RecoverySet,
  type RecoveryState,
  remainingLabel,
  replacementText,
  STATE_TEXT,
} from "~/utils/recovery";
import { formatDateTime, relativeTime } from "~/utils/time";
import { nameOf, type ProjectUser } from "~/utils/users";

const props = withDefaults(
  defineProps<{
    user: ProjectUser;
    set: RecoverySet;
    state: RecoveryState;
    /** A clear is in flight for this account. */
    busy?: boolean;
    /** Draws a close button, for the sheet a phone opens this in. */
    closable?: boolean;
    guideUrl: string;
  }>(),
  { busy: false, closable: false },
);

const emit = defineEmits<{
  clear: [];
  close: [];
}>();

const { copy, copied } = useClipboard({ legacy: true });

/* Half a minute is finer than any figure here: the coarsest relative time is the minute. */
const now = useNow({ interval: 30_000 });

const person = computed(() => nameOf(props.user));
const factors = computed(() => factorLabel(props.set));

/** The three timestamps and the factor, which is the account's whole context here. */
const facts = computed(() => [
  { label: "Second factor", value: factors.value, title: "" },
  {
    label: "Codes last generated",
    value: props.set.issuedAt === null ? "Never" : relativeTime(props.set.issuedAt, now.value),
    title: props.set.issuedAt === null ? "" : formatDateTime(props.set.issuedAt),
  },
  {
    label: "Code last used",
    value: props.set.lastUsedAt === null ? "Never" : relativeTime(props.set.lastUsedAt, now.value),
    title: props.set.lastUsedAt === null ? "" : formatDateTime(props.set.lastUsedAt),
  },
]);

/* Folded, because the thing above it is what a reader came for and this is not a repair. */
const advanced = ref(false);

/* A different account is a different decision: the fold closes with it. */
watch(
  () => props.user.id,
  () => {
    advanced.value = false;
  },
);
</script>

<template>
  <div class="flex min-w-0 flex-col">
    <!-- Identity, state and the way through to the account: the three things a support
         reader needs before they read a step. -->
    <header class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4">
      <div class="flex min-w-0 flex-col gap-2">
        <UserIdentity :user="user" />
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <RecoveryPips :remaining="set.remaining" :state="state" />
          <span :class="STATE_TEXT[state]" class="text-xs font-medium">
            {{ remainingLabel(set) }}
          </span>
          <!-- The size of a set, not the state again: `remainingLabel` beside it already
               says "No codes remaining", and "No codes left" under it says it twice. -->
          <span class="text-[11px] text-ink/45">{{ CODE_SET.codes }} codes to a set</span>
        </div>
      </div>

      <div class="flex flex-none items-center gap-1">
        <v-btn
          :to="`/users/${user.id}`"
          append-icon="material-symbols:arrow-forward"
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
        >
          Open user
        </v-btn>
        <v-btn
          v-if="closable"
          aria-label="Close"
          class="text-ink/60"
          icon="material-symbols:close"
          size="small"
          variant="text"
          @click="emit('close')"
        />
      </div>
    </header>

    <dl
      class="m-0 grid gap-px border-y border-line bg-line sm:grid-cols-3"
    >
      <div v-for="fact in facts" :key="fact.label" class="flex min-w-0 flex-col gap-1 bg-surface px-4 py-3">
        <dt class="text-[11px] text-ink/55">{{ fact.label }}</dt>
        <dd :title="fact.title || undefined" class="m-0 truncate text-xs font-medium text-ink">
          {{ fact.value }}
        </dd>
      </div>
    </dl>

    <!-- The safe resolution, which is the reason this panel exists. -->
    <section class="flex flex-col gap-3 p-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h3 class="m-0 text-xs font-medium text-ink">What {{ person }} should do</h3>
        <p class="m-0 text-xs leading-5 text-ink/60">{{ nextStepFor(set) }}</p>
      </div>

      <ol class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="(step, index) in REPLACEMENT_STEPS"
          :key="step"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2.5"
        >
          <span
            aria-hidden="true"
            class="flex size-5 items-center justify-center rounded-full bg-ink/8 font-mono text-[10px] leading-none font-medium text-ink/70 tabular-nums"
          >
            {{ index + 1 }}
          </span>
          <span class="text-[11px] leading-4 text-ink/70">{{ step }}</span>
        </li>
      </ol>

      <div class="flex flex-wrap items-center gap-2">
        <v-btn
          :prepend-icon="
            copied ? 'material-symbols:check' : 'material-symbols:content-copy-outline'
          "
          class="text-xs font-medium"
          color="neutral"
          size="small"
          variant="text"
          @click="copy(replacementText())"
        >
          {{ copied ? "Copied" : "Copy instructions" }}
        </v-btn>
        <v-btn
          :href="guideUrl"
          append-icon="material-symbols:arrow-outward"
          class="text-xs font-medium"
          color="neutral"
          rel="noopener"
          size="small"
          target="_blank"
          variant="text"
        >
          Recovery guide
        </v-btn>
        <!-- Shown off rather than left out: an operator looks for it, and a queue that
             hides the one obvious action reads as a queue missing a feature nobody
             explained. The line under the row is the explanation. -->
        <v-btn
          class="text-xs font-medium"
          color="neutral"
          disabled
          prepend-icon="material-symbols:mail-outline"
          size="small"
          variant="text"
        >
          Notify user
        </v-btn>
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/50">
        Notifying somebody from here is not built. There is no audited send behind it yet, so
        the copy above is what to paste into whichever channel you already use, and the send
        stays on your side where it is recorded.
      </p>
    </section>

    <!-- Advanced. Named for what it is, and it is not a repair. -->
    <section class="border-t border-line">
      <button
        :aria-expanded="advanced"
        class="flex w-full cursor-pointer appearance-none items-center justify-between gap-3 border-0 bg-transparent px-4 py-2.5 text-left transition-colors duration-150 hover:bg-ink/3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
        @click="advanced = !advanced"
      >
        <span class="text-xs font-medium text-ink">Advanced</span>
        <Icon
          :class="advanced ? 'rotate-180' : ''"
          aria-hidden="true"
          class="text-lg text-ink/45 transition-transform duration-200"
          name="material-symbols:keyboard-arrow-down"
        />
      </button>

      <div v-if="advanced" class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 pb-4">
        <p class="m-0 min-w-0 flex-1 text-[11px] leading-4 text-ink/55">
          <template v-if="set.remaining > 0">
            Invalidating the
            <span class="font-mono text-ink/80 tabular-nums">{{ set.remaining }}</span>
            unspent {{ set.remaining === 1 ? "code" : "codes" }} leaves the second factor
            enrolled and takes away the fallback behind it. Use it when a printout has gone
            somewhere it should not have.
          </template>
          <template v-else>
            There is nothing unspent to invalidate. Clearing the spent rows tidies the record
            and restores nothing: only {{ person }} can make a new set.
          </template>
        </p>
        <v-btn
          :disabled="set.issuedAt === null"
          :loading="busy"
          class="text-xs font-medium"
          :color="set.remaining > 0 ? 'error' : 'neutral'"
          prepend-icon="material-symbols:key-off-outline"
          size="small"
          variant="text"
          @click="emit('clear')"
        >
          {{ set.remaining > 0 ? `Invalidate ${set.remaining} codes` : "Clear spent codes" }}
        </v-btn>
      </div>
    </section>
  </div>
</template>
