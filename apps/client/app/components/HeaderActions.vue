<script setup lang="ts">
/**
 * The right-hand end of the app bar: what the organisation has to spend, and the ways to
 * read up, ask, and be told.
 *
 * The balance is the organisation's, because the wallet is: two projects under one
 * organisation draw on one balance, and a figure scoped to the project in the corner
 * would disagree with the billing screen the moment somebody switched project.
 *
 * There is no Top up button here any more, and its absence is the point. A funding action
 * in the bar competes with the billing screen's own, which is what
 * notes/settings-billing.md asks to remove, and at 390px it and the balance crowded out
 * the one thing the bar has to keep: which project is being read
 * (notes/shared-experience.md). The figure links to Billing instead, so funding is one
 * click away and lives in one place.
 *
 * The figure itself is desktop only. On a phone the breadcrumb needs the whole row, and a
 * balance is something somebody goes to Billing for rather than something they need while
 * reading a user's sessions.
 */
import { formatCents } from "~/utils/billing";

const { mdAndUp } = useDisplay();
const projects = useProjectStore();
const billing = useBillingStore();

/* The theme, and the one control that changes it. Kept beside the notifications bell
   rather than in the user menu because it is the only preference in the panel a person
   changes for the room they are in rather than for the account they are on, and a
   preference somebody reaches for twice in an afternoon belongs on the bar. It shows on a
   phone too, unlike the figure above: there is no other way to it. */
const { isDark, toggle: toggleScheme } = useColorScheme();

/* The same figure the billing screen shows, read from the same store and keyed by the
   same organisation. In cents, the way the billing API hands it over: a float would round
   the wrong way, and a bar quoting a different balance from the page it links to is worse
   than a bar quoting none. */
const balance = computed(() => formatCents(billing.balanceFor(projects.currentOrg.id)));

/** The docs shell on the landing site (PROJECT.md 10.1). The host is a placeholder. */
const DOCS_URL = "https://idenzy.io/docs";
</script>

<template>
  <div class="flex items-center gap-1">
    <template v-if="mdAndUp">
      <!-- Monospaced and tabular so the digits sit still as the figure changes, and a
           shade quieter for the word than for the number, which is the part that matters.
           A link rather than a figure alone, because the next thing somebody wants after
           reading a low balance is the screen that does something about it. -->
      <NuxtLink
        class="mr-2 flex items-baseline gap-1.5 rounded-(--idenzy-radius-x-small) px-1 py-0.5 text-xs no-underline transition-colors duration-150 hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        to="/billing"
      >
        <span class="text-ink/55">Balance</span>
        <span class="font-mono text-ink tabular-nums">{{ balance }}</span>
      </NuxtLink>
      <span aria-hidden="true" class="mr-1 h-4 w-px bg-shell-line" />
    </template>

    <!-- The glyph is the theme the click lands on, not the one being left, which is how
         the collapse control in the drawer reads too: an icon button with no label says
         what pressing it does. The label beside it says the same thing in words, so a
         reader who cannot see the sun is not told "dark mode" and given light. -->
    <v-btn
      :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
      class="text-ink/70 hover:text-ink"
      icon
      size="small"
      variant="text"
      @click="toggleScheme()"
    >
      <Icon
        :name="
          isDark
            ? 'material-symbols:sunny-outline-rounded'
            : 'material-symbols:moon-stars-outline-rounded'
        "
        aria-hidden="true"
        class="text-lg"
      />
      <v-tooltip
        :text="isDark ? 'Light mode' : 'Dark mode'"
        activator="parent"
        location="bottom"
      />
    </v-btn>

    <v-btn
      aria-label="Notifications"
      class="text-ink/70 hover:text-ink"
      icon
      size="small"
      variant="text"
    >
      <Icon aria-hidden="true" class="text-lg" name="material-symbols:notifications-outline" />
      <v-menu :offset="6" activator="parent" location="bottom end">
        <v-list min-width="256" nav>
          <p class="px-3 py-6 text-center text-xs text-ink/55">Nothing to show yet.</p>
        </v-list>
      </v-menu>
    </v-btn>

    <template v-if="mdAndUp">
      <v-btn
        :href="DOCS_URL"
        class="text-xs font-medium text-ink/70 hover:text-ink"
        rel="noreferrer"
        size="small"
        target="_blank"
        variant="text"
      >
        Docs
      </v-btn>

      <v-btn class="text-xs font-medium text-ink/70 hover:text-ink" size="small" variant="text">
        Help
        <v-menu :offset="6" activator="parent" location="bottom end">
          <v-list min-width="208" nav>
            <v-list-item prepend-icon="material-symbols:support-agent" title="Contact support" />
            <v-list-item
              prepend-icon="material-symbols:monitor-heart-outline"
              title="System status"
            />
            <v-list-item prepend-icon="material-symbols:campaign-outline" title="What's new" />
          </v-list>
        </v-menu>
      </v-btn>
    </template>
  </div>
</template>
