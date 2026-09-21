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
 *
 * `auth-shell` on the `v-app` root is what theme.css hooks to repaint `color="primary"`
 * ink instead of the panel's blue on these screens alone, without reaching into a single
 * page. See the rule in theme.css for why the selector has to reach past this element.
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
  <!-- Two classes and not one. `flow-shell` is what these screens share with onboarding,
       which is the other place a person has one column and one thing to do: the size a
       control is labelled at, and nothing else now that the corners are the product's.
       `auth-shell` is what is true of the signed-out screens alone — the ink accent and the
       control language built on it. See both blocks in theme.css. -->
  <v-app class="auth-shell flow-shell">
    <v-app-bar color="transparent" flat>
      <!--
        The bar's own gutter, because it no longer borrows one. theme.css strips the
        padding off every `v-toolbar__content` in the panel, where the bar's contents are
        the page's column and bring their own inset; here the two links sit at the edges
        of the viewport with nothing between them and the window but whatever padding is
        inside the button, which is a link's twelve pixels and not a gutter.

        The page's own gutter rather than the column beneath it: these two mark the
        corners of the screen, and pulled in to the centred column they would read as a
        heading over the form instead.

        Neither button sets its own type. `variant="text"` is what marks a link on these
        screens, and theme.css gives it the capitals and the track it shares with the
        button at the foot of the form.
      -->
      <div class="flex w-full items-center px-6">
        <v-btn
          v-if="returnable"
          prepend-icon="material-symbols:chevron-left"
          variant="text"
          @click="router.back()"
        >
          Back
        </v-btn>

        <v-spacer />

        <v-btn :to="alternative.to" variant="text">
          {{ alternative.label }}
        </v-btn>
      </div>
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
