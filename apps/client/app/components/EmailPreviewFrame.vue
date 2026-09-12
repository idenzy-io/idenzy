<script setup lang="ts">
/**
 * What the message looks like when it arrives: the inbox header a reader sees first, and
 * the body under it at a real email width.
 *
 * **The viewport is the email's, not the panel's.** A mail is read at 600px on a desktop
 * client and at about 375px on a phone, and neither of those is the width of the pane this
 * preview sits in. So the frame is laid out at the chosen width and scaled to fit, which
 * is the only way a reader here can see the thing that decides whether a table breaks: a
 * body that reflows because the preview pane got narrower has told nobody anything.
 *
 * **The HTML is in a fully sandboxed iframe and that is not decoration.** The body is
 * customer content: `v-html` would run an `onerror` on an image even though it would not
 * run a script tag, and the panel holds a session. `sandbox=""` is the most restrictive
 * value there is, so the frame gets an opaque origin and no scripts, forms, popups or
 * navigation. Nothing in it can reach the page around it.
 *
 * The document wrapper is ours and is three declarations: an iframe body carries an 8px
 * margin and a transparent ground, and a mail client draws neither. Nothing else about the
 * body is touched.
 */

const props = withDefaults(
  defineProps<{
    /** Already substituted, and already escaped where the renderer would escape. */
    body: string;
    mode?: "html" | "text";
    subject: string;
    /** The address the deployment sends from, so the header is the reader's header. */
    from: string;
    /** The language that actually supplied this copy, named rather than assumed. */
    locale: string;
    /** Whose copy it is, so a preview of our built-in never reads as the project's own. */
    source: "yours" | "built_in";
    viewport?: "desktop" | "mobile";
  }>(),
  { mode: "html", viewport: "desktop" },
);

const WIDTHS = { desktop: 600, mobile: 375 } as const;

const stage = useTemplateRef<HTMLElement>("stage");
const { width: stageWidth, height: stageHeight } = useElementSize(stage);

const frameWidth = computed(() => WIDTHS[props.viewport]);

/* Never scaled up: a 375px mail shown at 500px is a lie about the type size. */
const scale = computed(() =>
  stageWidth.value === 0 ? 1 : Math.min(1, stageWidth.value / frameWidth.value),
);

/*
 * The frame is laid out taller than the stage by exactly the factor it is shrunk by, so
 * the scaled result fills the stage and the mail scrolls inside itself.
 *
 * The frame is taken out of the flow for this, and that is not a tidiness choice: a
 * `transform` does not change an element's layout box, so an in-flow frame a third taller
 * than its stage grows the stage, which grows the frame, which grows the stage. The pane
 * climbs off the bottom of the page in a few frames and nothing in the markup says why.
 * Absolutely positioned, the stage's height comes from its own CSS and the loop cannot
 * start.
 */
const frameHeight = computed(() =>
  stageHeight.value === 0 ? 480 : Math.round(stageHeight.value / scale.value),
);

const document = computed(
  () =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:#ffffff}</style></head><body>${props.body}</body></html>`,
);
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-col">
    <!--
      The inbox header. It names the language and whose copy this is, because a preview
      that showed our built-in without saying so is the one way an operator concludes they
      have already written the message.
    -->
    <div class="flex flex-col gap-1 border-b border-line bg-ink/3 px-3 py-2.5">
      <div class="flex min-w-0 items-baseline justify-between gap-3">
        <span class="truncate font-mono text-[10px] leading-4 text-ink/50">{{ from }}</span>
        <span class="flex flex-none items-center gap-1.5">
          <span
            class="inline-flex rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/60"
          >
            {{ locale }}
          </span>
          <span
            :class="source === 'yours' ? 'text-success' : 'text-ink/50'"
            class="text-[10px] leading-4 font-medium"
          >
            {{ source === "yours" ? "Your copy" : "Our built-in" }}
          </span>
        </span>
      </div>
      <span class="truncate text-xs font-medium text-ink">{{ subject || "No subject" }}</span>
    </div>

    <div ref="stage" class="relative min-h-0 flex-1 overflow-hidden bg-white">
      <!-- Sandboxed with the most restrictive value there is: an opaque origin, no
           scripts, no forms, no navigation. The body is customer content. -->
      <iframe
        v-if="mode === 'html'"
        :srcdoc="document"
        :style="{
          width: `${frameWidth}px`,
          height: `${frameHeight}px`,
          transform: `scale(${scale})`,
        }"
        class="absolute top-0 left-0 block origin-top-left border-0"
        sandbox=""
        title="Rendered email"
      />
      <!-- The text part is text and is drawn as text: no frame, because there is no
           markup to isolate and a monospace block is what a text client shows. -->
      <pre
        v-else
        class="absolute inset-0 m-0 overflow-auto bg-surface p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink"
      >{{ body }}</pre>
    </div>
  </div>
</template>
