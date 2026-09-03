<script setup lang="ts">
/**
 * Your sign-in page: your markup, your design system, our protocol.
 *
 * Three ways in, and the order is deliberate. A one-time code needs no password, no redirect
 * and no deep link, and it signs up an address that has no account yet, so the same form
 * covers both.
 */
import type { AuthResult, MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { describeAuthError } from "~/utils/auth-errors";

const idenzy = useIdenzy();
const email = ref("");
const code = ref("");
const password = ref("");
const codeSent = ref(false);
const challenge = ref<MfaChallenge | null>(null);
const factorCode = ref("");
const error = ref<string | null>(null);

/** A session, or the factor still owed. The second is not a failure and not a session. */
function finish(result: AuthResult): void {
  if (result.status === "mfa_required") challenge.value = result.challenge;
}

/** The offered factor that takes a typed code. A passkey has its own button below. */
const codeFactor = computed(() =>
  challenge.value?.factors.includes("totp") ? ("totp" as const) : ("recovery" as const),
);

async function submitSecondFactor(): Promise<void> {
  error.value = null;
  const pending = challenge.value;
  if (pending === null) return;
  try {
    await pending.submit({ factor: codeFactor.value, code: factorCode.value });
    challenge.value = null;
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

/** Runs the WebAuthn ceremony for you. A cancelled prompt is the browser's own error. */
async function submitPasskey(): Promise<void> {
  error.value = null;
  const pending = challenge.value;
  if (pending === null) return;
  try {
    await pending.submitPasskey();
    challenge.value = null;
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

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
    finish(await idenzy.signIn.verifyOtp({ code: code.value }));
    await navigateTo("/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

async function signInWithPassword(): Promise<void> {
  error.value = null;
  try {
    finish(
      await idenzy.signIn.withPassword({ email: email.value, password: password.value }),
    );
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

    <section v-if="challenge">
      <h2>One more step</h2>
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
