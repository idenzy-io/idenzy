/**
 * Highlighted markup for a block of code, or null until the highlighter has loaded.
 *
 * `useShikiHighlighted` from the module is awaited in `setup`, which turns the component
 * that calls it into an async one: it suspends on every mount, and a component that
 * suspends after the page has painted drops its whole Suspense boundary back to a
 * fallback. That is a page blinking because a card in it wanted colour. So this awaits
 * nothing. The highlighter is fetched on mount and the answer is null until it arrives,
 * which is the caller's cue to render the same code as plain text: the block is readable
 * from the first frame and gains its colours a moment later, rather than the page
 * disappearing while Shiki's core is fetched.
 *
 * The highlighter itself is cached globally by the module, so the wait is once per
 * session and every later block is coloured in the same tick it is asked about.
 *
 * The theme, the language and the CSS-variable output all come from `shiki` in
 * nuxt.config.ts, so a caller passes what varies and nothing else.
 */
import type { CodeToHastOptions, HighlighterCore } from "shiki";

/*
 * nuxt-shiki publishes one export and its runtime types are not on it, so the two shapes
 * this file needs are transcribed from `nuxt-shiki/dist/runtime/types`. Both are thin:
 * `unwrap` is the module's own addition, and `highlight` is the pre-configured
 * `codeToHtml` it hangs on the highlighter.
 */
export type HighlightOptions = Partial<CodeToHastOptions> & { unwrap?: boolean };

export type ShikiHighlighter = HighlighterCore & {
  highlight: (code: string, options: HighlightOptions) => string;
};

export function useHighlighted(
  code: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<HighlightOptions> = {},
): ComputedRef<string | null> {
  /* Shallow: a highlighter holds a grammar registry and nothing in it is worth tracking. */
  const highlighter = shallowRef<ShikiHighlighter | null>(null);

  onMounted(() => {
    void getShikiHighlighter().then((ready) => {
      highlighter.value = ready;
    });
  });

  return computed(() => {
    const ready = highlighter.value;
    return ready === null ? null : ready.highlight(toValue(code), toValue(options));
  });
}
