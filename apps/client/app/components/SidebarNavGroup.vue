<script setup lang="ts">
/**
 * One folding group of the drawer's list, in either width.
 *
 * Unfolded, it is Vuetify's list group with the chevron turned by CSS. In the rail it is
 * a single item whose menu holds the same children, because a group that unfolds inside
 * a fifty-six pixel column shows rows with nothing in them. That is the one place a
 * click means something different in the two widths, which is why they are two branches
 * rather than one item styled two ways.
 */
const props = defineProps<{
  group: NavGroup;
  rail: boolean;
}>();

const route = useRoute();

/**
 * Whether the current screen is inside the group. The rail highlights the item for it,
 * and the unfolded header carries a class for it, so theme.css can give the header the
 * ink of an active row: the fold is where the person is, open or not.
 */
const holds = computed(() => props.group.children.some((child) => child.to === route.path));
</script>

<template>
  <v-list-item
    v-if="rail"
    :active="holds"
    :aria-label="group.title"
    :prepend-icon="group.icon"
    link
  >
    <v-menu :offset="8" activator="parent" location="end top">
      <v-list min-width="208" nav>
        <p class="truncate px-3 pt-1 pb-2 text-xs text-ink/60">{{ group.title }}</p>
        <v-list-item
          v-for="child in group.children"
          :key="child.to"
          :title="child.title"
          :to="child.to"
        />
      </v-list>
    </v-menu>
  </v-list-item>

  <!-- One chevron for both states: the open one is turned by theme.css rather than
       swapped for another glyph, so it moves rather than blinks. -->
  <v-list-group
    v-else
    :class="{ 'idenzy-nav-group--current': holds }"
    :value="group.id"
    collapse-icon="material-symbols:chevron-right"
    expand-icon="material-symbols:chevron-right"
  >
    <template #activator="{ props: activator }">
      <v-list-item v-bind="activator" :prepend-icon="group.icon" :title="group.title" />
    </template>

    <v-list-item
      v-for="child in group.children"
      :key="child.to"
      :title="child.title"
      :to="child.to"
    />
  </v-list-group>
</template>
