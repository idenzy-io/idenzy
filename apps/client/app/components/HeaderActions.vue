<script setup lang="ts">
/**
 * The right-hand end of the app bar: what the account has to spend, and the ways to
 * spend it, read up, ask, and be told.
 *
 * Ordered by what each thing is. Top up is the one action here and sits at the edge,
 * where a primary control belongs; Docs and Help are words beside it; the bell is the
 * one thing that speaks first rather than when asked; and the balance is a figure, not
 * a control, so it stands apart behind a rule.
 *
 * The figure is the billing screen's, read from the same store, and Top up goes there
 * rather than opening anything of its own. Two places showing a balance is one place too
 * many for them to disagree in, and the checkout when there is one is the payment
 * provider's page, so there is nothing for this button to open here anyway.
 */
import { formatCents } from "~/utils/billing";

const { mdAndUp } = useDisplay();
const projects = useProjectStore();
const billing = useBillingStore();

/* The same figure the billing screen shows, read from the same store. In cents, the way
   the billing API hands it over: a float would round the wrong way, and a bar quoting a
   different balance from the page it links to is worse than a bar quoting none. */
const balance = computed(() => formatCents(billing.balanceFor(projects.current.id)));

/** The docs shell on the landing site (PROJECT.md 10.1). The host is a placeholder. */
const DOCS_URL = "https://idenzy.dev/docs";
</script>

<template>
  <div class="flex items-center gap-1">
    <!-- Monospaced and tabular so the digits sit still as the figure changes, and a
         shade quieter for the word than for the number, which is the part that matters. -->
    <p class="mr-2 flex items-baseline gap-1.5 text-xs">
      <span class="text-ink/55">Balance</span>
      <span class="font-mono text-ink tabular-nums">{{ balance }}</span>
    </p>
    <span aria-hidden="true" class="mr-1 h-4 w-px bg-shell-line" />

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

    <FancyButton class="ml-1" @click="navigateTo('/settings/billing')">
      <Icon aria-hidden="true" class="text-base" name="carbon:purchase" />
      Top up
    </FancyButton>
  </div>
</template>
