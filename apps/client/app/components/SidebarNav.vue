<script setup lang="ts">
/**
 * The drawer's list: sections under a heading, groups that fold, and the project's own
 * group under a rule at the foot. The tree it draws is `NAV_SECTIONS`.
 *
 * Which groups are open is the drawer's state and not the route's. A person unfolds
 * what they are working in and it stays unfolded as they move about, which is how
 * Cloudflare's behaves and how a list that snapped shut on every navigation would not.
 * The group holding the current screen is opened on arrival and never closed for them.
 * Kept per browser, like the rail, because it is a preference about this screen.
 *
 * In the rail a heading has no room, so the rule that would have sat under it stands in
 * for it: the sections still read as sections, at the width of a glyph.
 */
defineProps<{
  rail: boolean;
}>();

const route = useRoute();

const opened = useLocalStorage<string[]>("idenzy.nav.opened", []);

watch(
  () => route.path,
  (path) => {
    const group = groupOf(path);
    if (group && !opened.value.includes(group.id)) {
      opened.value = [...opened.value, group.id];
    }
  },
  { immediate: true },
);
</script>

<template>
  <v-list v-model:opened="opened" nav>
    <template v-for="(section, index) in NAV_SECTIONS" :key="index">
      <template v-if="section.heading">
        <v-divider v-if="rail" class="my-2" />
        <v-list-subheader v-else>{{ section.heading }}</v-list-subheader>
      </template>

      <template v-for="entry in section.entries" :key="entry.title">
        <SidebarNavGroup v-if="isGroup(entry)" :group="entry" :rail="rail" />

        <!-- The label is hidden in the rail, so the tooltip is what says where a link
             goes and the aria-label is what a screen reader says. -->
        <v-list-item
          v-else
          :aria-label="rail ? entry.title : undefined"
          :prepend-icon="entry.icon"
          :title="entry.title"
          :to="entry.to"
        >
          <v-tooltip
            v-if="rail"
            :text="entry.title"
            activator="parent"
            location="end"
            open-delay="300"
          />
        </v-list-item>
      </template>
    </template>

    <v-divider class="my-2" />

    <!-- Settings is one item here and three tabs inside the page. The rail on that screen
         is what moves between them, so listing its children in the drawer as well would
         be the same three destinations offered twice. Billing is its own item because it
         is the organisation's money rather than a project's configuration, and it is one
         item and four tabs for the same reason. -->
    <v-list-item
      :aria-label="rail ? NAV_SETTINGS.title : undefined"
      :prepend-icon="NAV_SETTINGS.icon"
      :title="NAV_SETTINGS.title"
      to="/settings"
    >
      <v-tooltip
        v-if="rail"
        :text="NAV_SETTINGS.title"
        activator="parent"
        location="end"
        open-delay="300"
      />
    </v-list-item>

    <v-list-item
      :aria-label="rail ? NAV_BILLING.title : undefined"
      :prepend-icon="NAV_BILLING.icon"
      :title="NAV_BILLING.title"
      to="/billing"
    >
      <v-tooltip
        v-if="rail"
        :text="NAV_BILLING.title"
        activator="parent"
        location="end"
        open-delay="300"
      />
    </v-list-item>
  </v-list>
</template>
