<script setup lang="ts">
/**
 * Your sign-in page: your markup, your design system, our protocol.
 *
 * Three ways in, and the order is deliberate. A one-time code needs no password, no redirect
 * and no deep link, and it signs up an address that has no account yet, so the same form
 * covers both.
 */
import { describeAuthError } from "~/utils/auth-errors";

const idenzy = useIdenzy();
const email = ref("");
const code = ref("");
const password = ref("");
const codeSent = ref(false);
const error = ref<string | null>(null);

async function sendCode(): Promise<void> {
  error.value = null;
  try {
    await idenzy.signIn.withEmailOtp({ email: email.value });
    codeSent.value = true;
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

async function verifyCode(): Promise<void> {
  error.value = null;
  try {
    await idenzy.signIn.verifyOtp({ code: code.value });
    await navigateTo("/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

async function signInWithPassword(): Promise<void> {
  error.value = null;
  try {
    await idenzy.signIn.withPassword({ email: email.value, password: password.value });
    await navigateTo("/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

async function continueWithGoogle(): Promise<void> {
  // This URI has to be registered for the project. It is checked at the start of the flow and
  // again at the callback, and an unregistered one is refused rather than followed.
  await idenzy.signIn.withOAuth({
    provider: "google",
    redirectUri: window.location.origin + "/auth/callback",
  });
}
</script>

<template>
  <main>
    <h1>Sign in</h1>
    <p v-if="error" role="alert">{{ error }}</p>

    <form v-if="codeSent" @submit.prevent="verifyCode">
      <label for="code">The code we emailed you</label>
      <input id="code" v-model="code" inputmode="numeric" autocomplete="one-time-code" />
      <button type="submit">Continue</button>
    </form>

    <form v-else @submit.prevent="sendCode">
      <label for="email">Email</label>
      <input id="email" v-model="email" type="email" autocomplete="email" />
      <button type="submit">Email me a code</button>
    </form>

    <form @submit.prevent="signInWithPassword">
      <h2>Or use a password</h2>
      <label for="password">Password</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>

    <button type="button" @click="continueWithGoogle">Continue with Google</button>
  </main>
</template>
