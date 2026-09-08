<script setup lang="ts">
/**
 * Sign-in for the panel: a password form on the left, everything passwordless on the
 * right, one divider between them.
 *
 * Both columns are offered at once rather than behind a "more options" disclosure,
 * because a provider button is the fastest path for somebody who has one and invisible
 * to somebody who does not know to look. The handlers are shaped and unwired: they call
 * `@idenzy/js` once the panel builds a client, and nothing here posts anywhere yet.
 */
definePageMeta({ layout: "auth" });

const { mdAndUp } = useDisplay();

const email = ref("");
const password = ref("");
const revealed = ref(false);

// Enough to stop a submit that cannot succeed. Real validation is the server's answer,
// which is the only one that knows whether the address exists.
const submittable = computed(() => email.value.trim().length > 0 && password.value.length > 0);

function signIn() {
  // POST /v1/auth/password through the SDK, which finishes through `establish`.
}

function continueWith(_provider: string) {
  // POST /v1/auth/oauth/:provider/start, then navigate to the URL it answers with. The
  // panel is on the shared API host, so the JSON twin is the only route that resolves.
}

function sendMagicLink() {
  // POST /v1/auth/otp/start with the address above, channel "email".
}
</script>

<template>
  <div class="flex flex-col items-center">
    <Icon class="text-4xl" name="material-symbols:fingerprint" />

    <h1 class="mt-4 text-3xl font-semibold tracking-tight">Log in to Idenzy</h1>

    <!-- One breakpoint drives both the columns and the divider's orientation. Tailwind's
         `md` is 768px and Vuetify's is 960px, and between the two the page would show
         three columns with a horizontal rule lying across the middle one. -->
    <div class="mt-10 grid w-full" :class="mdAndUp ? 'grid-cols-[1fr_auto_1fr] gap-10' : 'gap-8'">
      <form class="flex flex-col gap-2 self-center" @submit.prevent="signIn">
        <label class="text-xs font-medium opacity-70" for="email">
          Email address
        </label>
        <v-text-field
          id="email"
          v-model="email"
          autocomplete="email"
          autofocus
          hide-details
          name="email"
          placeholder="name@example.com"
          type="email"
          variant="underlined"
        />

        <label class="mt-4 text-xs font-medium opacity-70" for="password">
          Password
        </label>
        <v-text-field
          id="password"
          v-model="password"
          :append-inner-icon="revealed ? 'lucide:eye-off' : 'lucide:eye'"
          :type="revealed ? 'text' : 'password'"
          autocomplete="current-password"
          hide-details
          name="password"
          placeholder="Password"
          variant="underlined"
          @click:append-inner="revealed = !revealed"
        />

        <v-btn
          :disabled="!submittable"
          class="mt-6 text-sm"
          color="primary"
          type="submit"
          variant="flat"
        >
          Log in
        </v-btn>
      </form>

      <!-- `*:w-full` reaches the wrapper the slot makes: stacked, it has to span the
           column, and upright it is sized by the column instead. -->
      <div class="flex justify-center" :class="mdAndUp ? '' : 'w-full *:w-full'">
        <v-divider :vertical="mdAndUp">
          <span class="text-xs font-medium opacity-60">Or</span>
        </v-divider>
      </div>

      <AuthProviderList
        class="self-center"
        link-label="Email me a magic link"
        @link="sendMagicLink"
        @provider="continueWith"
      />
    </div>

    <v-btn class="mt-10 text-xs font-medium" to="/auth/recover" variant="plain">
      Can't log in?
    </v-btn>
  </div>
</template>
