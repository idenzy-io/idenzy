<script setup lang="ts">
/**
 * A session drawn as the line it is: the sign-in, then the three clocks that could end
 * it, in the order they fall, with the first one marked.
 *
 * The three numbers this replaced were three paragraphs, and the only interesting thing
 * about them is which arrives first. That is an ordering question, and a reader should
 * not answer it by comparing prose about a fourteen-day window with prose about a
 * thirty-day one.
 *
 * **Not to scale, and it says so.** Drawn to scale, a one-day idle window against a
 * one-year maximum is a stop sitting on top of the sign-in and the reader learns nothing
 * the figures did not already tell them; drawn evenly, the order survives every
 * combination the controls offer. A chart that lies about proportion to stay legible is
 * worse than one that declines to draw proportion at all.
 *
 * Horizontal from `lg` up and vertical below, which is the note's own instruction and the
 * right call anyway: four stops squeezed into 390px is four truncated labels. One
 * component and one set of markup either way, because the rail is a flex line and its
 * direction is the only thing that changes.
 */
import { shortDuration, type TimelineStop } from "~/utils/lifetimes";

defineProps<{
  stops: readonly TimelineStop[];
  /** True while the figures come off an unsaved draft, so the caption can say so. */
  draft?: boolean;
}>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 class="m-0 text-xs font-medium text-ink">What ends a session</h3>
      <p class="m-0 text-[11px] leading-4 text-ink/50">
        In the order they fall, not to scale.
        <span v-if="draft" class="text-warning">Following the unsaved policy.</span>
      </p>
    </div>

    <ol class="m-0 flex list-none flex-col gap-0 p-0 lg:flex-row">
      <li
        v-for="(stop, index) in stops"
        :key="stop.id"
        class="relative flex min-w-0 gap-3 pb-5 pl-0 last:pb-0 lg:flex-1 lg:flex-col lg:gap-2 lg:pb-0"
      >
        <!--
          The rail, from each dot to the next. Vertically the labels sit beside the dots,
          so a line that stops at the last one reads as finished; horizontally they sit
          under equal columns, so it stops three quarters of the way across and reads as
          unfinished instead. The last stop therefore keeps a segment of its own and fades
          it out: the row is filled, and a line that faded is not a line that continues.
        -->
        <span
          v-if="index < stops.length - 1"
          aria-hidden="true"
          class="absolute top-3 bottom-0 left-[5px] w-px bg-line lg:top-[5px] lg:right-0 lg:bottom-auto lg:left-3 lg:h-px lg:w-auto"
        />
        <span
          v-else
          aria-hidden="true"
          class="timeline__tail absolute top-[5px] right-0 left-3 hidden h-px lg:block"
        />

        <span
          :class="
            stop.earliest
              ? 'border-warning bg-warning'
              : stop.id === 'signin'
                ? 'border-ink/40 bg-ink/40'
                : 'border-line bg-surface'
          "
          aria-hidden="true"
          class="relative z-10 mt-2 size-2.5 flex-none rounded-full border-2 lg:mt-0"
        />

        <div class="flex min-w-0 flex-col gap-0.5 lg:pr-4">
          <span class="flex flex-wrap items-baseline gap-x-2">
            <span
              :class="stop.earliest ? 'text-warning' : 'text-ink'"
              class="text-[13px] leading-5 font-medium"
            >
              {{ stop.label }}
            </span>
            <span
              v-if="stop.seconds > 0"
              class="font-mono text-[11px] whitespace-nowrap text-ink/70 tabular-nums"
            >
              {{ shortDuration(stop.seconds) }}
            </span>
          </span>
          <span class="text-[11px] leading-4 text-ink/55">{{ stop.detail }}</span>
          <!-- The two answers the line exists to give, on the stops that give them. -->
          <span
            v-if="stop.earliest"
            class="mt-0.5 text-[11px] leading-4 font-medium text-warning"
          >
            Left alone, a session ends here.
          </span>
          <span
            v-else-if="stop.heldOpen"
            class="mt-0.5 text-[11px] leading-4 font-medium text-ink/70"
          >
            Used every day, a session ends here.
          </span>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
/* The rail's own colour running out, rather than a second colour: `bg-line` is the
   theme's border and this is that, faded. */
.timeline__tail {
  background: linear-gradient(
    to right,
    rgba(var(--v-border-color), var(--v-border-opacity)),
    transparent
  );
}
</style>
