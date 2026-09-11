<script setup lang="ts">
/**
 * What is stopping a method today, at the top of its screen, gone the moment nothing is.
 *
 * It states the gap and what closing it costs, and leaves the doing to the screen: the
 * strip's own control comes in through `actions` and a per-row one through the scoped
 * slot, because what settles a blocker is a dialog on one screen and a switch on the
 * next. A screen with nothing blocking renders none of this rather than a green card
 * saying so, which is what the badge in the header is for.
 */
import type { SetupBlocker } from "~/utils/setup-check";

withDefaults(
  defineProps<{
    blockers: readonly SetupBlocker[];
    title?: string;
    description?: string;
  }>(),
  {
    title: "Setup blockers",
    description: "",
  },
);
</script>

<template>
  <LayerCard :description="description" :padded="false" :title="title">
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>

    <ul class="m-0 list-none divide-y divide-line p-0">
      <li
        v-for="blocker in blockers"
        :key="blocker.id"
        class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3.5"
      >
        <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
          <Icon class="text-base text-warning" name="material-symbols:error-outline" />
        </span>
        <span class="flex min-w-0 flex-col gap-1">
          <span class="text-sm leading-4 font-medium text-ink">{{ blocker.title }}</span>
          <span class="text-xs leading-5 text-ink/60">{{ blocker.detail }}</span>
        </span>
        <slot :blocker="blocker" name="action" />
      </li>
    </ul>
  </LayerCard>
</template>
