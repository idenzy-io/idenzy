<script setup lang="ts">
/**
 * The confirmation before a generated plain-text part replaces one somebody wrote.
 *
 * It only appears where there is something to lose, which the workspace decides: an empty
 * text part, or one that is already exactly what the HTML strips to, is overwritten with
 * no question at all. Asking every time teaches the reader to click through the one time
 * it mattered.
 *
 * **Before and after, as the text.** A mechanical strip of markup reads like a mechanical
 * strip of markup, and this is the part a screen reader and a spam filter read, so the
 * cost of the trade has to be visible rather than described. The two panes are the
 * argument for keeping what is there.
 */

defineProps<{
  /** The text part as it stands. */
  current: string;
  /** What the HTML strips to, which is what would replace it. */
  generated: string;
  busy?: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-plain-title`;
</script>

<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <v-card :aria-labelledby="titleId" border flat role="dialog">
      <div class="flex max-h-[80vh] flex-col">
        <header class="flex flex-col gap-1 border-b border-line px-5 py-4">
          <h2 :id="titleId" class="m-0 text-sm font-medium text-ink">
            Replace the plain-text part with a draft from the HTML?
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            You have written this part yourself. Generating over it keeps the links, because
            an anchor's href is put beside its text, and loses everything else you chose:
            the order, the line breaks and any sentence that only made sense without markup
            around it.
          </p>
        </header>

        <div class="grid min-h-0 flex-1 gap-px overflow-y-auto bg-line sm:grid-cols-2">
          <section class="flex min-w-0 flex-col bg-surface">
            <h3
              class="m-0 border-b border-line px-3 py-2 text-[10px] leading-4 font-medium text-ink/55"
            >
              What you have now
            </h3>
            <pre
              class="m-0 max-h-64 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink"
            >{{ current }}</pre>
          </section>
          <section class="flex min-w-0 flex-col bg-surface">
            <h3
              class="m-0 border-b border-line px-3 py-2 text-[10px] leading-4 font-medium text-ink/55"
            >
              What the HTML strips to
            </h3>
            <pre
              class="m-0 max-h-64 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-ink"
            >{{ generated }}</pre>
          </section>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p class="m-0 max-w-md text-[11px] leading-4 text-ink/50">
            Nothing is published by this. The draft is replaced in the editor and you can
            undo it there.
          </p>
          <span class="flex items-center gap-2">
            <v-btn
              :disabled="busy"
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Keep mine
            </v-btn>
            <v-btn
              :loading="busy"
              class="text-xs font-medium"
              color="primary"
              size="small"
              variant="flat"
              @click="emit('confirm')"
            >
              Replace with the draft
            </v-btn>
          </span>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
