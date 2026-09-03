<script setup lang="ts">
/**
 * Registration with a password, which is the only way in that needs its own screen.
 *
 * Every other route creates the account as it signs somebody in: a code sent to an address
 * nobody has claimed, a first Google profile, a passkey enrolled during onboarding.
 */
import { useIdenzy } from "@idenzy/vue";
import { ref } from "vue";
import { describeAuthError } from "./auth-errors";

const idenzy = useIdenzy();
const email = ref("");
const password = ref("");
const displayName = ref("");
const error = ref<string | null>(null);

async function signUp(): Promise<void> {
  error.value = null;
  try {
    await idenzy.signUp.withPassword({
      email: email.value,
      password: password.value,
      displayName: displayName.value,
    });
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}
</script>

<template>
  <main>
    <h1>Create an account</h1>
    <p v-if="error" role="alert">{{ error }}</p>

    <form @submit.prevent="signUp">
      <label for="displayName">Name</label>
      <input id="displayName" v-model="displayName" autocomplete="name" />

      <label for="email">Email</label>
      <input id="email" v-model="email" type="email" autocomplete="email" />

      <label for="password">Password</label>
      <input id="password" v-model="password" type="password" autocomplete="new-password" />

      <button type="submit">Create account</button>
    </form>
  </main>
</template>
