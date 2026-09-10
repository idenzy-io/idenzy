<script setup lang="ts">
/**
 * A part of a page: a title, a sentence saying what it holds, and the way out to the
 * screen that owns it. No frame.
 *
 * A card is a thing laid on the page, and five of them in a column say that five
 * unrelated things happen to be here. A detail page is one subject read top to bottom, so
 * what parts these is a rule and a heading, and what makes each one distinguishable is the
 * shape of its own content: a table looks like a table, a feed like a feed, a list of
 * settings like a list of settings.
 */
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** The screen that owns this subject in full. A text link, never a button. */
    to?: string;
    action?: string;
    /** Drawn as a rule above, which every section but the first wants. */
    divided?: boolean;
  }>(),
  { description: "", to: "", action: "", divided: true },
);
</script>

<template>
  <section :class="divided ? 'border-t border-line pt-6' : ''" class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-1">
      <div class="flex min-w-0 flex-col gap-1">
        <h2 class="m-0 text-sm font-medium text-ink">{{ title }}</h2>
        <p v-if="description || $slots.description" class="m-0 text-xs leading-5 text-ink/55">
          <slot name="description">{{ description }}</slot>
        </p>
      </div>

      <div v-if="to || $slots.actions" class="flex flex-none items-center gap-3">
        <slot name="actions" />
        <NuxtLink
          v-if="to"
          :to="to"
          class="inline-flex items-center gap-0.5 text-xs font-medium text-ink/55 no-underline transition-colors duration-150 hover:text-ink"
        >
          {{ action }}
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:chevron-right" />
        </NuxtLink>
      </div>
    </div>

    <slot />
  </section>
</template>
