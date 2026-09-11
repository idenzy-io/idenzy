<script setup lang="ts">
/**
 * The settings shell: the rail on the left, the screen it opened on the right.
 *
 * A parent route rather than one page with a query parameter, so every tab is a URL. The
 * two screens that already link here link to `/settings/members`, a person sent a tab
 * arrives on it, and the breadcrumb can say "Settings / Members" because the navigation
 * tree still names each one. A single route holding a `?tab=` would have made all three
 * one crumb and turned both existing links into redirects.
 *
 * There is no page header here and that is deliberate: each screen owns its own, because
 * the three want different things in it. General carries a link to its guide, Members
 * carries the scope and the invite action, Account carries whose account it is. A header
 * here would either duplicate theirs or take the room their own has to have.
 *
 * The three are grouped because they are the things a person changes rather than the
 * things they operate, and they are kept apart from Billing because that one is the
 * organisation's money rather than its configuration and has a screen of its own.
 */
import type { SettingsTab } from "~/components/SettingsTabs.vue";

/**
 * The scopes are the point of the rail as much as the titles.
 *
 * These three screens sit next to each other and own different things: the project's own
 * row, the organisation's team, and the reader's own sign-in. Saying so on the way in is
 * what stops somebody removing a colleague from an organisation while believing they are
 * removing them from one project (notes/settings-members.md P1).
 */
const TABS: readonly SettingsTab[] = [
  {
    to: "/settings",
    title: "General",
    scope: "This project",
    icon: "material-symbols:tune",
  },
  {
    to: "/settings/members",
    title: "Members",
    scope: "Organisation",
    icon: "material-symbols:group-outline",
  },
  {
    to: "/settings/account",
    title: "Account",
    scope: "You",
    icon: "material-symbols:person-outline",
  },
];
</script>

<template>
  <!--
    `items-start` so the rail stays at the top of a tall screen rather than stretching,
    and the column is the blueprint's: stacked under the desktop breakpoint instead of a
    rail squeezed to nothing.
  -->
  <div class="grid gap-6 lg:grid-cols-[196px_minmax(0,1fr)] lg:items-start lg:gap-8">
    <!-- Sticky under the app bar, which is 56px, so the rail is still reachable from the
         foot of a long screen. Below `lg` it is a strip above the content and scrolls
         with it. -->
    <div class="lg:sticky lg:top-20">
      <SettingsTabs :tabs="TABS" label="Settings" />
    </div>

    <div class="min-w-0">
      <NuxtPage />
    </div>
  </div>
</template>
