<script setup lang="ts">
/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * On the client only, and that is not an optimisation: the code in the URL is exchanged with a
 * verifier held in this browser's own session storage, so a server render has nothing to
 * complete the flow with. Null means there was no code in the URL at all.
 *
 * A provider's sign-in can still owe a second factor, and it is asked for here: the challenge
 * lives in this page's memory, so a page that navigated away first would lose it.
 */
import type { MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { describeAuthError } from "~/utils/auth-errors";

const idenzy = useIdenzy();
const error = ref<string | null>(null);
const challenge = ref<MfaChallenge | null>(null);
const factorCode = ref("");

/** The offered factor that takes a typed code. A passkey has its own button below. */
const codeFactor = computed(() =>
  challenge.value?.factors.includes("totp") ? ("totp" as const) : ("recovery" as const),
);

onMounted(async () => {
  try {
    const result = await idenzy.oauth.completeFromRedirect();
    if (result?.status === "mfa_required") {
      challenge.value = result.challenge;
      return;
    }
    await navigateTo(result === null ? "/sign-in" : "/", { replace: true });
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
    await navigateTo("/", { replace: true });
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
    await navigateTo("/", { replace: true });
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
