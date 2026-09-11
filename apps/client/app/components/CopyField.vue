<script setup lang="ts">
/**
 * A value the reader has to paste somewhere else: shown whole in the mono face, with the
 * one button that matters beside it. The button reports back by becoming a tick for a
 * second, because a copy leaves no other trace and a button that looks unchanged reads
 * as one that did nothing.
 *
 * Read-only by construction. Nothing here is a field the reader edits; the value comes
 * from the deployment, and the affordance is taking it away.
 *
 * It wears the filled field's tint rather than the page's own ground: a box in the canvas
 * colour cut into a card reads as a hole punched in the surface, and on a dark theme it is
 * the darkest thing on a screen whose whole point is a value somebody has to read. A tint
 * of the ink over whatever it sits on steps the right way in both themes, and it is the
 * same step `SamplePanel` and a filled input take, so a value to copy and a value to type
 * are the same object in one dialog.
 */
const props = withDefaults(
  defineProps<{
    value: string;
    /** What a screen reader hears on the button: "Copy the callback URL". */
    label: string;
    /** For a value that is one word rather than a URL. */
    dense?: boolean;
    /**
     * Wraps instead of truncating. For a value where the display is the record somebody
     * is checking against their own console, and a cut one reads as a different value.
     */
    wrap?: boolean;
  }>(),
  { dense: false, wrap: false },
);

const { copy, copied } = useClipboard({ copiedDuring: 1400, legacy: true });
</script>

<template>
  <div
    :class="[dense ? 'py-1 pr-1 pl-2.5' : 'py-1.5 pr-1.5 pl-3', wrap ? 'items-start' : 'items-center']"
    class="flex min-w-0 gap-2 rounded-(--idenzy-radius-x-small) bg-ink/4 ring-1 ring-ink/6 ring-inset"
  >
    <span
      :class="wrap ? 'py-0.5 break-all' : 'truncate'"
      class="min-w-0 flex-1 font-mono text-[11px] text-ink"
    >
      {{ value }}
    </span>
    <v-tooltip :text="copied ? 'Copied' : label" location="top">
      <template #activator="{ props: tip }">
        <button
          v-bind="tip"
          :aria-label="label"
          class="inline-flex size-6 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/50 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          type="button"
          @click="copy(props.value)"
        >
          <Icon
            :class="copied ? 'text-success' : ''"
            :name="copied ? 'material-symbols:check' : 'material-symbols:content-copy-outline'"
            aria-hidden="true"
            class="text-sm"
          />
        </button>
      </template>
    </v-tooltip>
  </div>
</template>
