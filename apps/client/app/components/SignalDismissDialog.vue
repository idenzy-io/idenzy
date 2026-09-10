<script setup lang="ts">
/**
 * Dismisses a signal, and asks what it turned out to be.
 *
 * The reason is the whole point of the dialog. A dismissal with none writes an audit entry
 * saying somebody made a row go away, which teaches the next reader nothing and teaches
 * this one that the button is a tidy-up. The four answers cover what a dismissal actually
 * is, and the fourth is the honest name for the rest rather than a box to leave blank.
 *
 * What is said in the body is what dismissing does not do. It does not sign anybody out,
 * it does not tell the detector to stop, and it does not delete the evidence: the row
 * stays on the dismissed segment for the project's retention, because a dismissal that
 * looks wrong a month later is exactly the thing a review is for.
 *
 * The reasons are a radio group in ARIA's terms and the keyboard's, like the segmented
 * control, so a screen reader hears one choice rather than four buttons. Nothing is
 * chosen when the dialog opens: a preselected reason is a reason nobody gave.
 */
import {
  DISMISS_REASON_LABELS,
  DISMISS_REASONS,
  type DismissReason,
  KIND_LABELS,
  kindOf,
  type SecuritySignal,
} from "~/utils/security";

const props = defineProps<{
  signal: SecuritySignal | null;
  /** Who the evidence names, for the sentence. Null where it names nobody. */
  person: string | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [reason: DismissReason];
}>();

const NOTES: Record<DismissReason, string> = {
  known_traveller: "The account belongs to somebody whose sign-ins move around.",
  known_network: "The address is a VPN, a proxy or an office you recognise.",
  our_own_test: "Your own team produced it deliberately.",
  not_a_concern: "Read, understood, and nothing follows from it.",
};

const chosen = ref<DismissReason | null>(null);
const group = useTemplateRef<HTMLElement>("group");

watch(open, (showing) => {
  if (showing) chosen.value = null;
});

/* Built here rather than assembled in the template, where the person is conditional and
   the punctuation around them ends up with the template's own whitespace in it. */
const subject = computed(() => {
  if (props.signal === null) return "";
  const kind = KIND_LABELS[kindOf(props.signal)];
  return props.person === null ? kind : `${kind} on ${props.person}`;
});

function confirm() {
  if (chosen.value === null) return;
  emit("confirm", chosen.value);
}

/* Wraps at either end, as a native radio group does. */
const KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

function move(event: KeyboardEvent, from: number) {
  const step = KEYS[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const next = (from + step + DISMISS_REASONS.length) % DISMISS_REASONS.length;
  chosen.value = DISMISS_REASONS[next] ?? null;
  group.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
}

/* Closes on the write landing rather than on the click. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card v-if="signal" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Dismiss this signal</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <span class="font-medium text-ink">{{ subject }}</span>. Say what it turned out
            to be, so the next person reading the trail is not reading a row that only says
            somebody clicked.
          </p>
        </header>

        <div
          ref="group"
          aria-label="Why this signal is being dismissed"
          class="flex flex-col gap-1.5"
          role="radiogroup"
        >
          <button
            v-for="(reason, index) in DISMISS_REASONS"
            :key="reason"
            :aria-checked="chosen === reason"
            :class="
              chosen === reason
                ? 'border-primary bg-primary/6'
                : 'border-line bg-surface hover:bg-ink/3'
            "
            :tabindex="chosen === reason || (chosen === null && index === 0) ? 0 : -1"
            class="flex cursor-pointer items-start gap-2.5 rounded-(--idenzy-radius-small) border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            role="radio"
            type="button"
            @click="chosen = reason"
            @keydown="move($event, index)"
          >
            <span
              :class="chosen === reason ? 'border-primary' : 'border-ink/25'"
              aria-hidden="true"
              class="mt-0.5 flex size-3.5 flex-none items-center justify-center rounded-full border-2"
            >
              <span v-if="chosen === reason" class="size-1.5 rounded-full bg-primary" />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-xs font-medium text-ink">{{ DISMISS_REASON_LABELS[reason] }}</span>
              <span class="text-[11px] leading-4 text-ink/55">{{ NOTES[reason] }}</span>
            </span>
          </button>
        </div>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:visibility-off-outline"
            />
            <span>
              Nothing about the account changes. Dismissing is a note about a row, never an
              action on a person.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:shield-lock-outline"
            />
            <span>
              The detector keeps running. If the same thing happens tomorrow there will be
              another row, because one innocent explanation is not a rule.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:history"
            />
            <span>
              Kept, not deleted, and recorded in the audit log against your name. A
              dismissal that looks wrong next month is what a review is for.
            </span>
          </li>
        </ul>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Leave it open
          </v-btn>
          <v-btn
            :disabled="chosen === null"
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Dismiss
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
