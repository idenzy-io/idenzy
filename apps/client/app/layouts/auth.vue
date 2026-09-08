<script setup lang="ts">
/**
 * The shell for the screens a signed-out visitor sees.
 *
 * Separate from the default layout rather than a flag on it: the panel's chrome is a
 * list of places to go, and none of them are reachable from here. Keeping the drawer out
 * of the tree also keeps the rail preference from being written by somebody who has not
 * signed in yet.
 *
 * Nothing here is an authentication widget we ship. This is our own dashboard signing
 * in to our own product through the headless SDK, which is what ADR-0002 leaves to the
 * application that owns the screen.
 */
const router = useRouter();
const route = useRoute();

/**
 * The bar always offers the screen the visitor is not on. Derived from the route rather
 * than passed up by each page, because a page that forgot to set it would offer a link
 * to itself, and that is the sort of thing nobody notices in review.
 */
const alternative = computed(() =>
  route.path === "/auth/signup"
    ? { label: "Log in", to: "/auth/login" }
    : { label: "Create account", to: "/auth/signup" },
);
</script>

<template>
  <v-app>
    <v-app-bar color="transparent" flat>
      <v-btn
        class="text-xs font-medium"
        prepend-icon="material-symbols:chevron-left"
        variant="text"
        @click="router.back()"
      >
        Back
      </v-btn>

      <v-spacer />

      <v-btn class="text-xs font-medium" :to="alternative.to" variant="text">
        {{ alternative.label }}
      </v-btn>
    </v-app-bar>

    <!--
      Centred in what is left below the app bar, not in the viewport. `v-main` already
      stretches (`flex: 1 0 auto` inside a wrap of `min-height: 100dvh`) and carries the
      bar's height as its own padding, so centring its contents lands the card in the
      middle of the space a visitor can actually see. A `100dvh` of our own would measure
      past the bar and sit everything slightly low.
    -->
    <v-main class="flex flex-col justify-center">
      <div class="mx-auto w-full max-w-4xl px-6 py-16">
        <slot />
      </div>
    </v-main>
  </v-app>
</template>
