<script setup lang="ts">
/**
 * The panel shell: a drawer the full height of the window, an app bar beside it, and a
 * centred content column under the bar.
 *
 * Kept here rather than in a component so every page gets it without opting in, which
 * is what stops a route rendering outside `v-app` and losing Vuetify's layout context.
 *
 * The drawer is declared before the bar because Vuetify's layout gives each edge to the
 * component that registered for it first. This order has the drawer own the left edge
 * top to bottom and the bar start where it ends. Swapped, the bar runs the full width
 * with the drawer tucked under it, which is the arrangement the old rail had.
 *
 * The drawer reads top to bottom in the order the screens depend on it: the project,
 * because every item under it is scoped to one; the places to go; then the person and
 * the control that folds the drawer, which are about the panel rather than the project.
 * Every row of chrome carries its own rule and its own inset, so a rule runs the full
 * width of the drawer and the top one continues the bar's across the edge.
 */
const { mdAndUp } = useDisplay();
const route = useRoute();

/**
 * What the tab calls the screen, from the navigation tree, so the tab and the drawer
 * never disagree about a name: a person with six of these open finds the right one by
 * its title. The bar itself shows the way to the screen rather than its name alone.
 */
const title = computed(() => titleOf(route.path) ?? "Idenzy");

useHead({ title: () => (title.value === "Idenzy" ? "Idenzy" : `${title.value} · Idenzy`) });

// Per browser, not per account. Collapsing the rail is a preference about this screen,
// so it belongs in local storage and never in a profile the server has to carry.
//
// `useLocalStorage` rather than VueUse's `useStorage`: Nitro owns that name, so
// @vueuse/nuxt leaves it out of the auto-imports and it resolves to nothing here.
const rail = useLocalStorage("idenzy.nav.rail", false);

/**
 * Whether the drawer is showing, which only means anything below `md`: there it is an
 * overlay the bar's menu button opens and a route change closes. Starts null so Vuetify
 * settles it from the viewport on mount, open on a desktop and closed on a phone. A
 * `true` here would open the overlay over every first paint on a phone.
 */
const open = ref<boolean | null>(null);

// The rail is a desktop arrangement. An overlay drawer is either open or gone, so below
// the breakpoint the preference is kept but not applied.
const collapsed = computed(() => rail.value && mdAndUp.value);
</script>

<template>
  <v-app>
    <v-navigation-drawer
      v-model="open"
      :permanent="mdAndUp"
      :rail="collapsed"
      color="shell"
      mobile-breakpoint="md"
      width="260"
    >
      <!-- The bar's height plus the bar's rule, so the line under this row and the line
           under the bar are one line across the drawer's edge. The rule is on the outer
           box and the inset on the inner one, which is what lets it run edge to edge. -->
      <template #prepend>
        <div class="border-b border-shell-divider">
          <div class="flex h-14 items-center px-(--idenzy-nav-inset)">
            <SidebarProjectSwitcher :rail="collapsed" />
          </div>
        </div>
      </template>

      <SidebarNav :rail="collapsed" />

      <template #append>
        <div class="border-t border-shell-divider p-(--idenzy-nav-inset)">
          <SidebarUserMenu :rail="collapsed" />
        </div>

        <!-- Desktop only: an overlay drawer has nothing to collapse to. The glyph sits
             in a box the width of the rail, so it stays put when the label goes. -->
        <div v-if="mdAndUp" class="border-t border-shell-divider p-(--idenzy-nav-inset)">
          <button
            :aria-expanded="!collapsed"
            :aria-label="collapsed ? 'Expand navigation' : 'Collapse navigation'"
            :class="collapsed ? 'justify-center' : ''"
            class="group flex h-10 w-full items-center overflow-hidden rounded-(--idenzy-radius) bg-ink/4 text-ink/70 transition-[background-color,color,transform] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98]"
            type="button"
            @click="rail = !rail"
          >
            <span class="flex size-10 flex-none items-center justify-center">
              <Icon
                :name="
                  collapsed ? 'material-symbols:chevron-right' : 'material-symbols:chevron-left'
                "
                aria-hidden="true"
                class="text-lg"
              />
            </span>
            <span v-if="!collapsed" class="truncate pr-3 text-[13px] font-medium">Collapse</span>
            <v-tooltip v-if="collapsed" activator="parent" location="end" text="Expand" />
          </button>
        </div>
      </template>
    </v-navigation-drawer>

    <v-app-bar color="shell" flat height="56">
      <!-- The bar's contents sit in the page's own column, so the breadcrumb starts
           where the content starts and the actions end where it ends. -->
      <div class="mx-auto flex w-full max-w-7xl items-center gap-4 px-6">
        <v-app-bar-nav-icon
          v-if="!mdAndUp"
          aria-label="Open navigation"
          class="-ml-2"
          @click="open = !open"
        />
        <HeaderBreadcrumb />
        <HeaderActions />
      </div>
    </v-app-bar>

    <v-main>
      <div class="mx-auto w-full max-w-7xl p-6">
        <slot />
      </div>
    </v-main>
  </v-app>
</template>
