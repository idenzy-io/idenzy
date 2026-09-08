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
 *
 * Signing up is offered from the sign-in screen alone, and logging in from everywhere
 * else. The screens a link drops somebody on belong to an account that already exists,
 * so "create account" is the one thing the visitor there is not trying to do.
 */
const alternative = computed(() =>
  route.path === "/auth/login"
    ? { label: "Create account", to: "/auth/register" }
    : { label: "Log in", to: "/auth/login" },
);

/**
 * Whether there is anything behind this screen to go back to.
 *
 * A screen reached from an email opens a tab of its own, where the button would be
 * furniture that does nothing when pressed. Vue Router records the entry it navigated
 * from in history state, and that is null on the first page of a session. Read through a
 * watcher rather than a computed because history state is not reactive.
 */
const returnable = ref(false);

watch(
  () => route.fullPath,
  () => {
    returnable.value = router.options.history.state["back"] != null;
  },
  { immediate: true },
);
</script>

<template>
  <v-app>
    <v-app-bar color="transparent" flat>
      <v-btn
        v-if="returnable"
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
