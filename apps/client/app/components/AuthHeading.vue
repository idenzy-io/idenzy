<script setup lang="ts">
/**
 * A screen's heading, with the words carrying its answer coloured and ruled.
 *
 * Shared by the recovery screens so the mark is the same weight, the same width and the
 * same distance under the text on every one of them. Taken as three parts rather than one
 * string with markup in it, because copy that has to be written as HTML is copy nobody
 * edits without a build.
 *
 * The rule is an element rather than a `text-decoration` so it keeps its weight and its
 * clearance under a descender at any size.
 */
const props = withDefaults(
  defineProps<{
    /** Everything before the marked words. The template supplies the spaces between. */
    lead: string;
    keyword: string;
    tail?: string;
    tone: HeadingTone;
    /**
     * False on a screen with nothing to mark yet. A rule under words that are about to be
     * replaced is noise rather than emphasis, which is why the one that reads "verifying
     * your account" carries none.
     */
    marked?: boolean;
  }>(),
  { tail: "", marked: true },
);

const colors = computed(() => HEADING_TONES[props.tone]);
</script>

<template>
  <h1 class="text-2xl font-semibold tracking-tight text-balance">
    {{ lead }}
    <span :style="{ color: colors.text }" class="relative inline-block">
      {{ keyword }}
      <span
        v-if="marked"
        :style="{ backgroundColor: colors.rule }"
        class="absolute inset-x-0 -bottom-1 h-[3px] rounded-full"
      />
    </span>
    {{ tail }}
  </h1>
</template>
