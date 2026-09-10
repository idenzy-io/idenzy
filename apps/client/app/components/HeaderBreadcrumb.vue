<script setup lang="ts">
/**
 * Where the screen is, as a path from the project down.
 *
 * The project is the root because everything behind the drawer is scoped to one, and a
 * root that repeats the switcher's name is what tells a person with two projects open
 * in two tabs which one they are looking at. A group in between is a place in the tree
 * and not a screen, so it is written but not linked. The last crumb is where the person
 * is, and is not linked either.
 *
 * A page about one record adds its own last crumb through `usePageCrumb`, and the link the
 * tree found becomes the way back to the list rather than the claim that the reader is
 * still on it.
 */
const route = useRoute();
const project = useProjectStore();
const own = usePageCrumbValue();

const crumbs = computed<Crumb[]>(() => [
  { title: project.current.name, to: "/" },
  ...crumbsOf(route.path),
  ...(own.value === "" ? [] : [{ title: own.value }]),
]);

const last = computed(() => crumbs.value.length - 1);
</script>

<template>
  <nav aria-label="Breadcrumb" class="min-w-0 flex-1">
    <!-- Margin, padding and marker are the browser's list defaults, which no reset here
         removes: preflight is off, and Vuetify's reset stops short of lists. -->
    <ol class="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-[13px]">
      <li
        v-for="(crumb, index) in crumbs"
        :key="`${index}-${crumb.title}`"
        class="flex min-w-0 items-center gap-2"
      >
        <span v-if="index > 0" aria-hidden="true" class="select-none text-ink/25">/</span>

        <!-- A crumb that leads where the person already is stays text: the root does on
             the overview, and a link to the current page would claim `aria-current`
             alongside the last crumb. -->
        <NuxtLink
          v-if="crumb.to && index < last && crumb.to !== route.path"
          :to="crumb.to"
          class="truncate font-medium text-ink/55 no-underline transition-colors hover:text-ink"
        >
          {{ crumb.title }}
        </NuxtLink>
        <span
          v-else
          :aria-current="index === last ? 'page' : undefined"
          :class="index === last ? 'font-semibold text-ink' : 'font-medium text-ink/55'"
          class="truncate"
        >
          {{ crumb.title }}
        </span>
      </li>
    </ol>
  </nav>
</template>
