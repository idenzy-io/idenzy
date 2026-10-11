<script setup lang="ts">
/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so only the tab that started the flow can finish it. Null means there was no code
 * in the URL at all, which is somebody opening this route directly.
 */
import type { MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { useIdenzy } from "@idenzy/vue";
import { computed, onMounted, ref } from "vue";
import { describeAuthError } from "./auth-errors";

const idenzy = useIdenzy();
const error = ref<string | null>(null);
const challenge = ref<MfaChallenge | null>(null);
const factorCode = ref("");

/** The offered factor that takes a typed code. A passkey has its own button below. */
const codeFactor = computed(() =>
  challenge.value?.factors.includes("totp") ? ("totp" as const) : ("recovery" as const),
);

/**
 * A provider's sign-in can still owe a second factor, and it is asked for here: the challenge
 * lives in this page's memory, and the reload below would lose it.
 */
onMounted(async () => {
  try {
    const result = await idenzy.oauth.completeFromRedirect();
    if (result?.status === "mfa_required") {
      challenge.value = result.challenge;
      return;
    }
    window.location.replace(result === null ? "/sign-in" : "/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
});

async function submitSecondFactor(): Promise<void> {
  error.value = null;
  const pending = challenge.value;
  if (pending === null) return;
  try {
    await pending.submit({ factor: codeFactor.value, code: factorCode.value });
    window.location.replace("/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

async function submitPasskey(): Promise<void> {
  error.value = null;
  const pending = challenge.value;
  if (pending === null) return;
  try {
    await pending.submitPasskey();
    window.location.replace("/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}
</script>

<template>
  <main>
    <p v-if="error" role="alert">{{ error }}</p>

    <section v-if="challenge">
      <h1>One more step</h1>
      <button v-if="challenge.factors.includes('passkey')" type="button" @click="submitPasskey">
        Use your passkey
      </button>
      <form @submit.prevent="submitSecondFactor">
        <label for="factorCode">
          {{ codeFactor === "recovery"
            ? "A recovery code"
            : "The code from your authenticator app" }}
        </label>
        <input id="factorCode" v-model="factorCode" autocomplete="one-time-code" />
        <button type="submit">Continue</button>
      </form>
    </section>
    <p v-else-if="!error">Signing you in...</p>
  </main>
</template>
