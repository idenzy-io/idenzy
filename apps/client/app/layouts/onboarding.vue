<script setup lang="ts">
/**
 * The shell for somebody who has an account and nowhere to be yet.
 *
 * Neither of the other two fits, and the gap is the reason this exists. The default
 * layout's drawer is a list of places that all need a project, so every one of them would
 * be a dead link. The auth layout offers "Log in" in its bar, which is the one thing a
 * person who is already signed in cannot do.
 *
 * What it does offer is the way out: the account that is signed in, named, with a way to
 * leave it. Somebody who registered with the wrong address, or who meant to accept an
 * invitation instead, is otherwise stuck on a page with no exit — and a flow with no exit
 * is how a person ends up creating an organisation they did not want.
 */
const user = useUser();
const idenzy = useIdenzy();

/** The real signed-in address. A placeholder here named somebody who was not signed in. */
const email = computed(() => user.value?.email ?? "—");

/** Actually ends the session. This used to be a link to the sign-in page, which left the
    session alive — so "log out" returned somebody to a screen they were still signed in
    behind, and the way out of a flow with no other exit did not work. */
async function signOut() {
  try {
    await idenzy.signOut();
  } finally {
    await navigateTo("/auth/login");
  }
}
</script>

<template>
  <!-- `flow-shell`, shared with the signed-out screens: this is the other shell that is one
       column with one thing to do, and it is set to match.
       Deliberately not `auth-shell`, which would also repaint `color="primary"` as ink —
       right where the only accent is the sign-in button, wrong on the first screen behind
       it, where the panel's own blue is what the rest of the product uses. -->
  <v-app class="flow-shell">
    <v-app-bar color="transparent" flat>
      <div class="flex items-center gap-2.5 pl-4">
        <Icon aria-hidden="true" class="text-xl" name="material-symbols:fingerprint" />
        <span class="text-sm font-semibold tracking-tight">Idenzy</span>
      </div>

      <v-spacer />

      <div class="flex items-center gap-1 pr-2">
        <span class="hidden text-xs opacity-60 sm:inline">{{ email }}</span>
        <v-btn class="text-xs font-medium" variant="text" @click="signOut">Log out</v-btn>
      </div>
    </v-app-bar>

    <!--
      Centred in what is left below the bar rather than in the viewport, the way the auth
      layout is, and for the same reason: `v-main` already carries the bar's height as its
      own padding, so a `100dvh` of our own would measure past it and sit everything low.
    -->
    <v-main class="flex flex-col justify-center">
      <div class="mx-auto w-full max-w-2xl px-6 py-14">
        <slot />
      </div>
    </v-main>
  </v-app>
</template>
