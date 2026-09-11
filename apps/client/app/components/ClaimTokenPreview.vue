<script setup lang="ts">
/**
 * The payload a token would carry for one user, as the issuer would write it, coloured
 * by Shiki in the panel's own palette (app/shiki/theme.ts).
 *
 * The whole block is tokenised at once, and that is a constraint rather than a
 * convenience: a lone `"plan": "pro",` is not JSON, and a grammar handed one line at a
 * time reads its key as an ordinary string and loses the only distinction a reader of a
 * token cares about. So the marks this preview adds ride on Shiki's own line elements
 * through a transformer, and the CSS below draws them from the attributes it leaves.
 *
 * One mark, and it is the change. Every custom line is compared against what the
 * published template renders for the same user and tinted the colour of what publishing
 * would do to it: green and `+` for a line it adds, amber and `~` for one whose value it
 * moves, red and a struck-through `−` for one it takes away, which is a line the token
 * still carries today. A diff is read this way everywhere else, and the glyph carries
 * the same statement as the tint for a reader who cannot tell three tints apart.
 *
 * Nothing marks which lines are the template's and which the issuer assembles. Both
 * attempts at it were worse than the absence: dimming the issuer's lines held most of
 * the payload under an opacity and read as a block somebody had disabled, and a bar in
 * the accent down the custom lines was a blue stripe beside the only colours on the
 * screen that mean something.
 *
 * Until Shiki's core has loaded the same text is rendered plain. The block is readable
 * from the first frame and gains its colours a moment later; the alternative is a
 * component that suspends and a page that blinks because a card in it wanted colour.
 *
 * When a required claim resolves to nothing there is no token, and the preview says so
 * in place of pretending: the refusal replaces the payload rather than sitting over it,
 * and names the claim and the error code the SDK would report.
 */
import type { ShikiTransformer } from "shiki";
import type { RenderedTemplate, TokenLine } from "~/utils/claims";

const props = defineProps<{
  lines: readonly TokenLine[];
  rendered: RenderedTemplate;
}>();

/* The payload as text. Line 1 is the opening brace, so entry n is source line n + 2. */
const code = computed(() => `{\n${props.lines.map((line) => `  ${line.text}`).join("\n")}\n}`);

const transformers = computed<ShikiTransformer[]>(() => [
  {
    name: "idenzy-claim-diff",
    line(node, line) {
      const entry = props.lines[line - 2];
      if (entry === undefined) return;
      node.properties["data-change"] = entry.change;
    },
  },
]);

const html = useHighlighted(code, () => ({
  lang: "json",
  unwrap: true,
  transformers: transformers.value,
}));

const refused = computed(() => props.rendered.refusedBy);
</script>

<template>
  <div>
    <!-- A refused sign-in has no token, so there is no payload to draw. The refusal takes
         the block rather than floating over a greyed-out copy of what it would have been:
         a dimmed payload under an alert reads as a thing that is loading, and in a dialog
         there is not the height to float anything over anything. -->
    <div v-if="refused" class="flex items-start gap-2.5 bg-error/5 px-4 py-3.5" role="status">
      <Icon
        aria-hidden="true"
        class="mt-0.5 flex-none text-base text-error"
        name="material-symbols:block"
      />
      <div class="flex min-w-0 flex-col gap-1">
        <p class="m-0 text-xs font-medium text-error">No token: this user could not sign in</p>
        <p class="m-0 text-[11px] leading-4 text-ink/70">
          <span class="font-mono text-ink/85">{{ refused.name.trim() || "(unnamed)" }}</span> is
          required and there is nothing to carry. The sign-in answers
          <span class="font-mono text-ink/85">claim_template_unsatisfied</span>, and the claim's
          name reaches your logs and never the response.
        </p>
      </div>
    </div>

    <!-- Two elements rather than one with a conditional body: `v-html` replaces the
         children, and the plain fallback is text that must stay escaped. -->
    <pre v-else-if="html" class="claim-payload" v-html="html" />
    <pre v-else class="claim-payload">{{ code }}</pre>
  </div>
</template>

<style scoped>
/*
 * `:deep` throughout, because Shiki's markup arrives through `v-html` and carries none
 * of this component's scope attribute. The face and the size live here rather than on
 * the highlighted element, so the plain fallback and the coloured block are the same
 * block; theme.css tells Shiki's own `pre` to inherit both.
 */
.claim-payload {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.45;
  margin: 0;
  overflow-x: auto;
  /* No inset of its own: the inset is on the lines, so a tinted one runs edge to edge
     rather than stopping a rule short of the block's own border. */
  padding: 0.75rem 0;
}

/* The left inset, plus a gutter of one character for the change mark. */
.claim-payload :deep(.line) {
  padding-left: 1.75rem;
  padding-right: 1rem;
  position: relative;
}

.claim-payload :deep(.line[data-change])::before {
  color: rgba(var(--v-theme-on-surface), 0.45);
  content: " ";
  left: 1rem;
  position: absolute;
}

.claim-payload :deep(.line[data-change="added"])::before {
  color: rgb(var(--v-theme-success));
  content: "+";
}

.claim-payload :deep(.line[data-change="changed"])::before {
  color: rgb(var(--v-theme-warning));
  content: "~";
}

.claim-payload :deep(.line[data-change="removed"])::before {
  color: rgb(var(--v-theme-error));
  content: "−";
}

/*
 * A changed line is tinted the colour of its own change, the way a diff is read
 * everywhere else, and the glyph in the gutter says the same thing for a reader who
 * cannot tell the three tints apart. Low alpha, because the line's own syntax colours
 * have to survive being sat on: a tint that competes with them turns the payload back
 * into decoration.
 */
.claim-payload :deep(.line[data-change="added"]) {
  background: color-mix(in srgb, rgb(var(--v-theme-success)) 14%, transparent);
}

.claim-payload :deep(.line[data-change="changed"]) {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 14%, transparent);
}

/* The one line that is not in the payload any more also takes a rule through it. */
.claim-payload :deep(.line[data-change="removed"]) {
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 12%, transparent);
  opacity: 0.75;
  text-decoration: line-through;
}
</style>
