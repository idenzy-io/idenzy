<script setup lang="ts">
/**
 * The stages a revocation passes through, from the row being written to a verifier
 * refusing the token, on a vertical rail.
 *
 * Vertical rather than the left-to-right pipeline this wants to be, and that is a
 * decision about width: four stages each needing a sentence do not fit across a card, and
 * a horizontal version either truncates the sentences or scrolls sideways, which is the
 * one thing a page must not do. Down the page each stage keeps its full width at every
 * viewport and the rail still says "then".
 *
 * A stage's backstop hangs off it on a dashed rail of its own, because the durable path
 * is not the next step: it is what happens instead, when that step is lost.
 */
import type { RevocationStage } from "~/utils/revocation";

defineProps<{
  stages: readonly RevocationStage[];
}>();
</script>

<template>
  <ol class="m-0 flex list-none flex-col p-0">
    <li v-for="(stage, index) in stages" :key="stage.id" class="flex gap-3.5">
      <!-- The rail: a node for the stage and the line down to the next one, which the
           last stage does not draw. -->
      <div aria-hidden="true" class="flex flex-none flex-col items-center">
        <span
          class="flex size-6 flex-none items-center justify-center rounded-full border border-line bg-canvas font-mono text-[10px] leading-none font-medium text-ink/70 tabular-nums"
        >
          {{ index + 1 }}
        </span>
        <span v-if="index < stages.length - 1" class="w-px flex-1 bg-line" />
      </div>

      <div :class="index < stages.length - 1 ? 'pb-5' : ''" class="flex min-w-0 flex-col gap-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="m-0 text-sm font-medium text-ink">{{ stage.title }}</h3>
          <span
            class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
          >
            {{ stage.cost }}
          </span>
        </div>
        <p class="m-0 text-xs leading-5 text-ink/60">{{ stage.detail }}</p>

        <div
          v-if="stage.backstop"
          class="mt-2 flex flex-col gap-0.5 border-l border-dashed border-line py-0.5 pl-3.5"
        >
          <p class="m-0 flex items-center gap-1.5 text-xs font-medium text-ink/80">
            <Icon
              aria-hidden="true"
              class="flex-none text-sm text-ink/50"
              name="material-symbols:alt-route"
            />
            {{ stage.backstop.title }}
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">{{ stage.backstop.detail }}</p>
        </div>
      </div>
    </li>
  </ol>
</template>
