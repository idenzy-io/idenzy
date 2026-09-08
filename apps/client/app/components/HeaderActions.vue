<script setup lang="ts">
/**
 * The right-hand end of the app bar: what the account has to spend, and the ways to
 * spend it, read up, ask, and be told.
 *
 * Ordered by what each thing is. Top up is the one action here and sits at the edge,
 * where a primary control belongs; Docs and Help are words beside it; the bell is the
 * one thing that speaks first rather than when asked; and the balance is a figure, not
 * a control, so it stands apart behind a rule. Everything is a placeholder shape until
 * the management API answers: the balance is a constant and the bell has nothing to
 * show.
 */
const { mdAndUp } = useDisplay();

/** In cents, the way the billing API will hand it over. A float would round the wrong way. */
const balanceCents = 12_840;

const balance = computed(() =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(balanceCents / 100),
);

/** The docs shell on the landing site (PROJECT.md 10.1). The host is a placeholder. */
const DOCS_URL = "https://idenzy.dev/docs";

function topUp() {
  // The billing checkout, once there is one: a page hosted by the payment provider and
  // never a form of ours, so no card number reaches this bundle.
}
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

    <FancyButton class="ml-1" @click="topUp">
      <Icon aria-hidden="true" class="text-base" name="carbon:purchase" />
      Top up
    </FancyButton>
  </div>
</template>
