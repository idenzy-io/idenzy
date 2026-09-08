<script setup lang="ts">
/**
 * The panel shell: rail drawer, app bar, and a centred content column.
 *
 * Kept here rather than in a component so every page gets it without opting in, which
 * is what stops a route rendering outside `v-app` and losing Vuetify's layout context.
 */

// Per browser, not per account. Collapsing the rail is a preference about this screen,
// so it belongs in local storage and never in a profile the server has to carry.
//
// `useLocalStorage` rather than VueUse's `useStorage`: Nitro owns that name, so
// @vueuse/nuxt leaves it out of the auto-imports and it resolves to nothing here.
const rail = useLocalStorage("idenzy.nav.rail", false);

// Icon names are written out in full because @nuxt/icon bundles only what it finds by
// scanning: `material-symbols:${name}` would compile and draw nothing at all.
const sections = [
  { title: "Overview", icon: "material-symbols:space-dashboard-outline", to: "/" },
  { title: "Users", icon: "material-symbols:group-outline", to: "/users" },
  { title: "Sessions", icon: "material-symbols:devices-outline", to: "/sessions" },
  { title: "Audit log", icon: "material-symbols:history", to: "/audit" },
  { title: "Settings", icon: "material-symbols:settings-outline", to: "/settings" },
];
</script>

<template>
  <v-app>
    <v-app-bar border flat>
      <v-app-bar-nav-icon
        :aria-label="rail ? 'Expand navigation' : 'Collapse navigation'"
        @click="rail = !rail"
      />
      <v-app-bar-title class="font-semibold tracking-tight">Idenzy</v-app-bar-title>
    </v-app-bar>

    <v-navigation-drawer :rail="rail" permanent>
      <v-list density="comfortable" nav>
        <v-list-item
          v-for="section in sections"
          :key="section.to"
          :prepend-icon="section.icon"
          :title="section.title"
          :to="section.to"
        />
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <div class="mx-auto w-full max-w-7xl p-6">
        <slot />
      </div>
    </v-main>
  </v-app>
</template>
