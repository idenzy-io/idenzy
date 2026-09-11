<script setup lang="ts">
/**
 * A sample of code in the panel's own Shiki palette (app/shiki/theme.ts), plain until the
 * highlighter has loaded.
 *
 * `useHighlighted` awaits nothing and answers null until Shiki's core arrives, which is
 * this component's cue to render the same text unhighlighted: the block is readable from
 * the first frame and gains its colours a moment later, rather than the card suspending
 * and taking the page's Suspense boundary down with it.
 *
 * The face and the size live on the `pre` rather than on the highlighted element, so the
 * fallback and the coloured block are the same block; theme.css tells Shiki's own markup
 * to inherit both, and makes each line a grid row so a long one scrolls sideways instead
 * of wrapping. A language not in `shiki.bundledLangs` is a line to add to nuxt.config.
 */
const props = withDefaults(
  defineProps<{
    code: string;
    /** Anything declared in `shiki.bundledLangs`; a grammar is never fetched. */
    lang?: string;
  }>(),
  { lang: "typescript" },
);

const html = useHighlighted(
  () => props.code,
  () => ({ lang: props.lang, unwrap: true }),
);
</script>

<template>
  <!-- Two elements rather than one with a conditional body: `v-html` replaces the
       children, and the plain fallback is text that must stay escaped. -->
  <pre v-if="html" class="code-block" v-html="html" />
  <pre v-else class="code-block">{{ code }}</pre>
</template>

<style scoped>
.code-block {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.25rem;
  margin: 0;
  overflow-x: auto;
}
</style>
