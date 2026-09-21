<script setup lang="ts">
/**
 * The four-or-so things that have to be true before a method works, with what was found
 * against each and a link to the screen that fixes it.
 *
 * The checks are computed by the screen from what the panel already holds, so they are
 * live; the button re-reads them with a visible wait, because a reader who has just
 * changed something elsewhere wants to watch this answer change. Every state is written
 * out beside its mark: three of the six chart-safe inks fail on white and a state must
 * never be told apart by colour alone.
 */
import { CHECK_MARKS, CHECK_WORDS, type SetupCheck } from "~/utils/setup-check";

withDefaults(
  defineProps<{
    checks: readonly SetupCheck[];
    /** A run is in flight: every row shows it, because they are read together. */
    testing?: boolean;
    title?: string;
    description?: string;
    /** The line at the foot: what these checks are read from, and what they are not. */
    note?: string;
  }>(),
  {
    testing: false,
    title: "Setup check",
    description: "",
    note: "",
  },
);

defineEmits<{ test: [] }>();
</script>

<template>
  <LayerCard :description="description" :padded="false" :title="title">
    <template #actions>
      <!-- A screen with its own control for the strip passes one; the rest get the
           re-read, which is what a check card is normally for. -->
      <slot name="actions">
        <ActionButton :loading="testing" @click="$emit('test')">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:play-arrow-outline" />
          Test setup
        </ActionButton>
      </slot>
    </template>

    <ul class="m-0 list-none divide-y divide-line p-0">
      <li
        v-for="check in checks"
        :key="check.id"
        class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.25rem_11rem_minmax(0,1fr)]"
      >
        <span aria-hidden="true" class="flex h-4 w-5 items-center justify-center">
          <Icon
            :class="testing ? 'animate-spin text-ink/40' : CHECK_MARKS[check.state].tone"
            :name="testing ? 'material-symbols:progress-activity' : CHECK_MARKS[check.state].icon"
            class="text-base"
          />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-xs leading-4 font-medium text-ink">{{ check.label }}</span>
          <span :class="CHECK_MARKS[check.state].tone" class="text-[11px] leading-4">
            {{ testing ? "Checking" : CHECK_WORDS[check.state] }}
          </span>
        </span>
        <span class="col-start-2 flex min-w-0 flex-col gap-1 sm:col-start-3">
          <span class="text-xs leading-5 text-ink/60">{{ check.finding }}</span>
          <NuxtLink
            v-if="check.fix"
            :to="check.fix.to"
            class="inline-flex w-fit items-center gap-0.5 text-[11px] font-medium text-ink no-underline hover:underline"
          >
            {{ check.fix.label }}
            <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
          </NuxtLink>
        </span>
      </li>
    </ul>

    <p v-if="note" class="m-0 border-t border-line px-4 py-2.5 text-[11px] leading-4 text-ink/50">
      {{ note }}
    </p>
  </LayerCard>
</template>
