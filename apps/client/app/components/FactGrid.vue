<script setup lang="ts">
/**
 * The things about a subject that are true rather than adjustable, read across the page
 * instead of down it.
 *
 * A fact is a label and a value. Stacked as rows with a paragraph each, six of them are
 * four hundred pixels of reading before the first control; laid in a band they are one
 * glance, and the sentence that explained each one goes behind the glyph on its label,
 * where it is still reachable and no longer in the way. That trade is the whole component.
 *
 * It is a real `<dl>`, because that is what it is: the mosaic every page here draws by
 * hand is a definition list wearing `div`s, and a screen reader was being handed a run of
 * unrelated spans. `label` names the list, since a page carries more than one.
 *
 * No frame of its own beyond the hairline mosaic. A fact grid is state, and state is not a
 * task: the frame on the page belongs to the thing the reader came to change.
 */
export interface Fact {
  key: string;
  label: string;
  /** Already formatted. A fact grid renders; it does not decide how a date reads. */
  value: string;
  /** Identifiers, endpoints and figures. Words are not mono. */
  mono?: boolean;
  /** The sentence behind the glyph: what this is, and what it is not. */
  info?: string;
  /** One short line under the value. Not a paragraph, and never a second sentence. */
  note?: string;
  /** The screen that owns this fact. Renders the value as a link. */
  to?: string;
  /** What the copy button puts on the clipboard, which is never the display value. */
  copy?: string;
  /** A status dot's colour class, as `users/[id].vue` already spells them. */
  dot?: string;
}

withDefaults(
  defineProps<{
    facts: readonly Fact[];
    /** Names the list for a screen reader: "Project facts". */
    label: string;
    /**
     * How many across on a wide screen. Written out rather than interpolated, because
     * Tailwind reads the source for class names and a built one is not in the bundle.
     */
    columns?: 2 | 3 | 4 | 5 | 6;
  }>(),
  { columns: 4 },
);

const TRACKS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};
</script>

<template>
  <!-- The rules are borders on the cells pulled a pixel into their neighbours, not a
       `gap-px` over a darker ground. A gap only draws a clean mosaic while the facts fill
       every row: eleven facts in four tracks leave three cells of bare backing, which reads
       as a hole in the band. Borders plus `overflow-hidden` leave the surface showing. -->
  <dl
    :aria-label="label"
    :class="TRACKS[columns]"
    class="m-0 grid overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface"
  >
    <div
      v-for="fact in facts"
      :key="fact.key"
      class="-mt-px -ml-px flex min-w-0 flex-col gap-1.5 border-t border-l border-line px-4 py-3.5"
    >
      <dt class="flex min-w-0 items-center gap-1 text-xs text-ink/55">
        <span class="truncate">{{ fact.label }}</span>
        <!-- A button and not a focusable span, and the same one `Statistic` draws: the
             tooltip is the only place this sentence exists now, so the thing that opens it
             has to have a name and a focus ring of its own. -->
        <button
          v-if="fact.info"
          :aria-label="`About ${fact.label}`"
          class="flex size-4 flex-none items-center justify-center rounded-full text-ink/40 transition-colors duration-150 hover:text-ink/80 focus-visible:text-ink/80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          type="button"
        >
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:info-outline" />
          <v-tooltip
            :text="fact.info"
            activator="parent"
            location="top"
            max-width="260"
            open-delay="200"
          />
        </button>
      </dt>

      <dd class="m-0 flex min-w-0 items-center gap-2">
        <span
          v-if="fact.dot"
          :class="fact.dot"
          aria-hidden="true"
          class="size-1.5 flex-none rounded-full"
        />

        <NuxtLink
          v-if="fact.to"
          :to="fact.to"
          class="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-ink no-underline transition-colors duration-150 hover:text-primary"
        >
          <span class="truncate">{{ fact.value }}</span>
          <Icon
            aria-hidden="true"
            class="flex-none text-base text-ink/40"
            name="material-symbols:chevron-right"
          />
        </NuxtLink>

        <span
          v-else
          :class="fact.mono ? 'font-mono text-[13px]' : 'text-sm'"
          class="min-w-0 truncate font-medium text-ink"
        >
          {{ fact.value }}
        </span>

        <!-- The label as written, not lowercased: every value worth copying here is an
             identifier or an endpoint, so the label is an acronym as often as not. -->
        <CopyButton v-if="fact.copy" :label="`Copy the ${fact.label}`" :value="fact.copy" />
      </dd>

      <p v-if="fact.note" class="m-0 truncate text-xs leading-4 text-ink/45">{{ fact.note }}</p>
    </div>
  </dl>
</template>
