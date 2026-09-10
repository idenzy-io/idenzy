<script setup lang="ts">
/**
 * Makes a key, and asks which kind first.
 *
 * The choice is the dialog rather than a split button or a menu, because the two kinds are
 * not two flavours of one thing: one is meant to be published and the other must never be,
 * and a dropdown puts those a pixel apart under a chevron. Laid out as two cards with what
 * each is for underneath, the decision is made by reading rather than by aiming.
 *
 * A secret key adds a line the publishable one does not get, and it appears only once secret
 * is chosen. Shown against both, the warning would be furniture by the second visit; shown
 * against the one it is true of, it is the answer to the question the reader is holding.
 *
 * Nothing here names the key, because the row has nowhere to put a name. A key is told apart
 * by its prefix and its dates, and offering a field the server drops would be worse than the
 * gap it papers over.
 */
import {
  API_KEY_KINDS,
  type ApiKeyKind,
  KEY_FORMAT,
  KEY_KIND_ICONS,
  KEY_KIND_LABELS,
  KEY_KIND_NOTES,
  KEY_KIND_PREFIXES,
} from "~/utils/keys";

const props = defineProps<{
  busy: boolean;
  /** Suggested when the dialog opens: whichever kind the project does not have yet. */
  suggested: ApiKeyKind;
  /** Live keys of each kind, so the dialog can say a second one starts a rotation. */
  liveOf: Record<ApiKeyKind, number>;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [kind: ApiKeyKind];
}>();

const chosen = ref<ApiKeyKind>("publishable");
const group = useTemplateRef<HTMLElement>("group");

watch(open, (showing) => {
  if (showing) chosen.value = props.suggested;
});

/** A second live key of a kind is not an error, it is the first half of a rotation. */
const startsRotation = computed(() => props.liveOf[chosen.value] > 0);

function confirm() {
  emit("confirm", chosen.value);
}

/* Wraps at either end, as a native radio group does. */
const KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

function move(event: KeyboardEvent, from: number) {
  const step = KEYS[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const next = (from + step + API_KEY_KINDS.length) % API_KEY_KINDS.length;
  chosen.value = API_KEY_KINDS[next] ?? "publishable";
  group.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
}

/* Closes on the write landing rather than on the click, so the reveal takes its place. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);
</script>

<template>
  <v-dialog v-model="open" max-width="520">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Create an API key</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            {{ KEY_FORMAT.bits }} bits from the system's own generator, kept as a
            {{ KEY_FORMAT.digest }} digest. You will see the value once, on the next screen.
          </p>
        </header>

        <div ref="group" aria-label="Kind of key" class="flex flex-col gap-2" role="radiogroup">
          <button
            v-for="(kind, index) in API_KEY_KINDS"
            :key="kind"
            :aria-checked="chosen === kind"
            :class="
              chosen === kind ? 'border-primary bg-primary/6' : 'border-line bg-surface hover:bg-ink/3'
            "
            :tabindex="chosen === kind ? 0 : -1"
            class="flex cursor-pointer items-start gap-3 rounded-(--idenzy-radius-small) border px-3.5 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            role="radio"
            type="button"
            @click="chosen = kind"
            @keydown="move($event, index)"
          >
            <span
              :class="chosen === kind ? 'bg-primary/12 text-primary' : 'bg-ink/6 text-ink/70'"
              aria-hidden="true"
              class="mt-0.5 flex size-8 flex-none items-center justify-center rounded-(--idenzy-radius-x-small)"
            >
              <Icon :name="KEY_KIND_ICONS[kind]" class="text-lg" />
            </span>
            <span class="flex min-w-0 flex-col gap-1">
              <span class="flex flex-wrap items-baseline gap-2">
                <span class="text-sm font-medium text-ink">{{ KEY_KIND_LABELS[kind] }}</span>
                <span class="font-mono text-[11px] text-ink/50">{{ KEY_KIND_PREFIXES[kind] }}…</span>
              </span>
              <span class="text-[11px] leading-4 text-ink/60">{{ KEY_KIND_NOTES[kind] }}</span>
            </span>
          </button>
        </div>

        <p
          v-if="chosen === 'secret'"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/30 bg-warning/6 px-3 py-2.5 text-[11px] leading-4 text-ink/80"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-warning"
            name="material-symbols:warning-outline"
          />
          <span>
            This one never goes in a browser bundle, an app binary, or a repository. Our own
            scaffolder will not write it into an environment file for that reason: what a
            bundle publishes at build time, nothing unpublishes afterwards.
          </span>
        </p>

        <p
          v-if="startsRotation"
          class="m-0 flex items-start gap-2 text-[11px] leading-4 text-ink/60"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-ink/40"
            name="material-symbols:swap-horiz"
          />
          <span>
            This project already has a live {{ KEY_KIND_LABELS[chosen].toLowerCase() }}. Both
            will work, which is how a rotation is done here: deploy the new one, wait for the
            old one to go quiet, then revoke it.
          </span>
        </p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
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
            Create {{ KEY_KIND_LABELS[chosen].toLowerCase() }}
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
