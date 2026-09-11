<script setup lang="ts">
/**
 * One sample user's answer to the draft: whether they get a token, what it carries, and
 * what the published template gives them today.
 *
 * Three of these are the closest this screen comes to a fleet-wide statement, and that
 * is the point of them. A required claim is refused per user, so a template judged
 * against a complete profile is a template nobody has checked: the account that signed
 * up a minute ago and the one that signed up by SMS are ordinary, and they are who a
 * required email claim locks out.
 *
 * The whole card is the control that points the preview at this user, because the reader
 * who has just been told a sample is refused wants to see that token next.
 */
import type { ProfileOutcome } from "~/utils/claims";

const props = defineProps<{
  outcome: ProfileOutcome;
  /** Whether the preview beside it is showing this user. */
  active: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const rendered = computed(() => props.outcome.rendered);
const before = computed(() => props.outcome.before);

/** What is carried, in the panel's own words. Both halves of the sentence are counted. */
function summarise(render: ProfileOutcome["rendered"]): string {
  if (render.refusedBy !== null) return "No token";
  const count = render.present.length;
  return `${count === 1 ? "1 claim" : `${count} claims`} · ${render.bytes.toLocaleString("en")} bytes`;
}

/* Shown only where publishing actually moves this user, which is the interesting case. */
const wasDifferent = computed(() => {
  const previous = before.value;
  if (previous === null) return null;
  const now = rendered.value;
  const same =
    previous.refusedBy?.name === now.refusedBy?.name &&
    previous.bytes === now.bytes &&
    previous.present.length === now.present.length;
  return same ? null : summarise(previous);
});
</script>

<template>
  <button
    :aria-pressed="active"
    :class="
      active
        ? 'border-primary/50 bg-primary/4'
        : 'border-line bg-surface hover:border-ink/25 hover:bg-ink/3'
    "
    class="flex flex-col gap-1.5 rounded-(--idenzy-radius) border p-3.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    type="button"
    @click="emit('select')"
  >
    <span class="flex min-w-0 items-center gap-2">
      <Icon
        :name="outcome.profile.icon"
        aria-hidden="true"
        class="flex-none text-base text-ink/50"
      />
      <span class="min-w-0 truncate text-[13px] font-medium text-ink">
        {{ outcome.profile.label }}
      </span>
      <Icon
        v-if="active"
        aria-hidden="true"
        class="ml-auto flex-none text-sm text-primary"
        name="material-symbols:visibility-outline"
      />
    </span>

    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        :class="rendered.refusedBy ? 'text-error' : 'text-ink'"
        class="font-mono text-xs tabular-nums"
      >
        {{ summarise(rendered) }}
      </span>
      <span v-if="wasDifferent" class="font-mono text-[11px] text-ink/45 line-through">
        {{ wasDifferent }}
      </span>
    </span>

    <span
      :class="rendered.refusedBy ? 'text-error' : 'text-ink/55'"
      class="text-[11px] leading-4"
    >
      <template v-if="rendered.refusedBy">
        <span class="font-mono">{{ rendered.refusedBy.name.trim() || "(unnamed)" }}</span> is
        required and this account has nothing to carry.
      </template>
      <template v-else-if="rendered.absent.length > 0">
        {{ rendered.absent.length === 1 ? "One claim is" : `${rendered.absent.length} claims are` }}
        left out: <span class="font-mono">{{ rendered.absent.map((claim) => claim.name.trim() || "(unnamed)").join(", ") }}</span>
      </template>
      <template v-else>{{ outcome.profile.note }}</template>
    </span>
  </button>
</template>
