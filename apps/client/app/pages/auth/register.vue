<script setup lang="ts">
/**
 * Account creation for the panel, laid out like sign-in so the two read as one pair.
 *
 * The confirmation field is ours alone: `signUpWithPasswordSchema` takes an address, a
 * password and an optional display name, and nothing else. It exists because a typo in a
 * password nobody can read costs a reset cycle to find, and only the browser is in a
 * position to catch it.
 *
 * The handlers are shaped and unwired: they call `@idenzy/js` once the panel builds a
 * client, and nothing here posts anywhere yet.
 */
definePageMeta({ layout: "auth" });

const { mdAndUp } = useDisplay();

const email = ref("");
const password = ref("");
const confirmation = ref("");
const revealed = ref(false);

// Shown once there is something to compare, rather than on the first keystroke: an
// unfinished confirmation is not yet a mistake.
const mismatch = computed(
  () => confirmation.value.length > 0 && confirmation.value !== password.value,
);

/**
 * The same bounds the server enforces, and nothing more. Strength is advice: a password
 * this meter calls weak still creates an account, and a password it calls strong can
 * still be refused by the breach check, which is the only judgement that runs against
 * what attackers actually have.
 */
const submittable = computed(
  () =>
    email.value.trim().length > 0 &&
    password.value.length >= PASSWORD_MIN_LENGTH &&
    password.value.length <= PASSWORD_MAX_LENGTH &&
    confirmation.value === password.value,
);

function signUp() {
  // POST /v1/auth/sign-up/password through the SDK, which finishes through `establish`.
  // `password_breached` comes back here and belongs on the password field.
}

function continueWith(_provider: string) {
  // POST /v1/auth/oauth/:provider/start, then navigate to the URL it answers with. The
  // panel is on the shared API host, so the JSON twin is the only route that resolves.
}

function sendSignUpLink() {
  // POST /v1/auth/otp/start with the address above, channel "email".
}
</script>

<template>
  <div class="flex flex-col items-center">
    <Icon class="text-4xl" name="material-symbols:fingerprint" />

    <h1 class="mt-4 text-2xl font-semibold tracking-tight">Create your Idenzy account</h1>

    <div class="mt-10 grid w-full" :class="mdAndUp ? 'grid-cols-[1fr_auto_1fr] gap-10' : 'gap-8'">
      <form class="flex flex-col gap-2 self-center" @submit.prevent="signUp">
        <label class="text-xs font-medium opacity-70" for="email">Email address</label>
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

        <label class="mt-4 text-xs font-medium opacity-70" for="password">Password</label>
        <v-text-field
          id="password"
          v-model="password"
          :append-inner-icon="revealed ? 'lucide:eye-off' : 'lucide:eye'"
          :maxlength="PASSWORD_MAX_LENGTH"
          :type="revealed ? 'text' : 'password'"
          autocomplete="new-password"
          hide-details
          name="password"
          placeholder="At least 8 characters"
          variant="underlined"
          @click:append-inner="revealed = !revealed"
        />

        <PasswordStrengthMeter :password="password" />

        <label class="mt-4 text-xs font-medium opacity-70" for="confirmation">
          Confirm password
        </label>
        <v-text-field
          id="confirmation"
          v-model="confirmation"
          :error-messages="mismatch ? 'Both passwords must match.' : []"
          :type="revealed ? 'text' : 'password'"
          autocomplete="new-password"
          hide-details="auto"
          name="confirmation"
          placeholder="Repeat your password"
          variant="underlined"
        />

        <v-btn
          :disabled="!submittable"
          class="mt-6 text-sm"
          color="primary"
          type="submit"
          variant="flat"
        >
          Create account
        </v-btn>
      </form>

      <div class="flex justify-center" :class="mdAndUp ? '' : 'w-full *:w-full'">
        <v-divider :vertical="mdAndUp">
          <span class="text-xs font-medium opacity-60">Or</span>
        </v-divider>
      </div>

      <AuthProviderList
        class="self-center"
        link-label="Sign up with a magic link"
        @link="sendSignUpLink"
        @provider="continueWith"
      />
    </div>

    <v-btn class="mt-10 text-xs font-medium" to="/auth/login" variant="plain">
      Already have an account?
    </v-btn>
  </div>
</template>
