<script setup lang="ts">
/**
 * A rotation somebody started: the old key, its replacement, and what has been observed of
 * each, side by side (notes/keys.md). Drawn only for a rotation that exists, because two
 * live keys are not one.
 *
 * The heading states what was observed and never a verdict. A replacement nothing has
 * presented is "Deploy the replacement", however long ago it was made, which is the note's
 * acceptance check; an old key silent since the replacement is "no observed use", with the
 * limitation under it, and never "safe to finish". Review revocation is offered at every
 * step, because the operator may know something the observation cannot, and it becomes the
 * primary action only once the evidence points that way. The review is where consumers are
 * confirmed.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  KEY_KIND_LABELS,
  maskedKey,
  OBSERVATION_LIMIT,
  type ProjectApiKey,
  ROTATION_STEPS,
  type Rotation,
  rotationEvidence,
  rotationHeadline,
  rotationInstructions,
} from "~/utils/keys";
import { formatDate } from "~/utils/time";

const props = defineProps<{
  rotation: Rotation;
  projectName: string;
}>();

const emit = defineEmits<{
  view: [key: ProjectApiKey];
  review: [];
}>();

const now = useNow({ interval: 30_000 });
const { copy, copied } = useClipboard({ copiedDuring: 1600, legacy: true });

const evidence = computed(() => rotationEvidence(props.rotation, now.value));
const headline = computed(() => rotationHeadline(props.rotation));

const badge = computed<{ label: string; tone: BadgeTone }>(() => {
  const { replacementObserved, oldObservedSince } = props.rotation;
  if (!replacementObserved) return { label: "Replacement not observed", tone: "warning" };
  if (oldObservedSince) return { label: "Old key still observed", tone: "warning" };
  return { label: "Ready for review", tone: "neutral" };
});

/** The evidence points at revoking: the replacement is in use and the old key is not. */
const recommended = computed(
  () => props.rotation.replacementObserved && !props.rotation.oldObservedSince,
);

const started = computed(() => {
  const { replacement } = props.rotation;
  const by = replacement.createdBy ? ` by ${replacement.createdBy}` : "";
  return `started ${formatDate(replacement.createdAt)}${by}.`;
});

/* A step behind is a button in `Steps`; here it opens the key it names. */
function select(id: string) {
  if (id === "old") emit("view", props.rotation.old);
  if (id === "replacement") emit("view", props.rotation.replacement);
}

const halves = computed(() => [
  {
    id: "old",
    label: "Old key",
    key: props.rotation.old,
    words: evidence.value.old,
    warn: props.rotation.oldObservedSince,
  },
  {
    id: "replacement",
    label: "Replacement",
    key: props.rotation.replacement,
    words: evidence.value.replacement,
    warn: !props.rotation.replacementObserved,
  },
]);
</script>

<template>
  <v-card border flat>
    <div class="flex flex-col gap-4 p-4">
      <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h3 class="m-0 text-sm font-medium text-ink">{{ headline }}</h3>
          <p class="m-0 text-xs leading-5 text-ink/55">
            Rotating the {{ KEY_KIND_LABELS[rotation.kind].toLowerCase() }}
            <span class="font-mono">{{ rotation.old.prefix }}…</span> to
            <span class="font-mono">{{ rotation.replacement.prefix }}…</span>, {{ started }}
          </p>
        </div>
        <StatusBadge :label="badge.label" :tone="badge.tone" />
      </div>

      <div class="overflow-x-auto">
        <Steps :current="rotation.step" :steps="ROTATION_STEPS" @select="select" />
      </div>

      <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
        <template v-for="(half, index) in halves" :key="half.id">
          <span
            v-if="index === 1"
            aria-hidden="true"
            class="hidden items-center justify-center text-ink/35 md:flex"
          >
            <Icon class="text-lg" name="material-symbols:arrow-forward" />
          </span>
          <div
            class="flex min-w-0 flex-col gap-1.5 rounded-(--idenzy-radius-small) bg-ink/4 p-3 ring-1 ring-ink/6 ring-inset"
          >
            <span class="flex items-center justify-between gap-2">
              <span class="text-[11px] leading-4 font-medium text-ink/55">{{ half.label }}</span>
              <span class="text-[11px] leading-4 text-ink/45">
                Made {{ formatDate(half.key.createdAt) }}
              </span>
            </span>
            <span class="truncate font-mono text-xs text-ink">{{ maskedKey(half.key) }}</span>
            <span class="flex items-start gap-1.5 text-xs leading-5 text-ink/70">
              <span
                :class="half.warn ? 'bg-warning' : 'bg-ink/30'"
                aria-hidden="true"
                class="mt-2 size-1.5 flex-none rounded-full"
              />
              {{ half.words }}
            </span>
          </div>
        </template>
      </div>

      <p class="m-0 text-[11px] leading-4 text-ink/50">{{ OBSERVATION_LIMIT }}</p>
    </div>

    <div
      class="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/60 px-4 py-3"
    >
      <v-btn
        :prepend-icon="copied ? 'material-symbols:check' : 'material-symbols:content-copy-outline'"
        class="text-xs font-medium"
        color="neutral"
        size="small"
        variant="text"
        @click="copy(rotationInstructions(rotation, projectName))"
      >
        {{ copied ? "Copied" : "Copy setup instructions" }}
      </v-btn>
      <v-btn
        class="text-xs font-medium"
        color="neutral"
        size="small"
        variant="text"
        @click="emit('view', rotation.old)"
      >
        View observed use
      </v-btn>
      <v-btn
        :color="recommended ? 'primary' : 'neutral'"
        :variant="recommended ? 'flat' : 'outlined'"
        class="text-xs font-medium"
        size="small"
        @click="emit('review')"
      >
        Review revocation
      </v-btn>
    </div>
  </v-card>
</template>
