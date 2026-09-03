import {
  FrameworkTemplate,
  type ScaffoldContext,
  type ScaffoldFile,
} from "../framework-template.js";

/**
 * Vue on Vite: a browser-only application, so there is no seed and no server half.
 *
 * The plugin is installed once with the client, and the composables read the session from
 * there. Nothing scaffolded here builds a client of its own, because two of them on a page
 * rotate the same refresh token and the second rotation ends every session the user holds.
 */
export class VueTemplate extends FrameworkTemplate {
  readonly id = "vue";
  readonly title = "Vue (Vite)";
  readonly packages = ["@idenzy/vue", "@idenzy/js"];
  readonly markers = ["vue"];
  readonly envFile = ".env";
  readonly envPrefix = "VITE_";

  protected routes(_context: ScaffoldContext): readonly ScaffoldFile[] {
    return [
      { path: "src/idenzy.ts", contents: CLIENT },
      { path: "src/auth/auth-errors.ts", contents: ERRORS },
      { path: "src/auth/SignIn.vue", contents: SIGN_IN },
      { path: "src/auth/SignUp.vue", contents: SIGN_UP },
      { path: "src/auth/OAuthCallback.vue", contents: CALLBACK },
    ];
  }

  protected steps(): readonly string[] {
    return [
      'Install the plugin in src/main.ts: app.use(createIdenzy({ client: idenzy })), importing createIdenzy from "@idenzy/vue" and idenzy from "./idenzy".',
      "Route /auth/callback to OAuthCallback.vue, however your application does routing.",
      "Register http://localhost:5173/auth/callback as a redirect URI, and http://localhost:5173 as a browser origin, for this project.",
      "Everything under src/auth is yours now. Restyle it, rename it, delete what you do not use.",
    ];
  }
}

const CLIENT = `import { Idenzy } from "@idenzy/js";

/**
 * One client for the whole browser session, built once and outside any component.
 *
 * An Idenzy owns the session, the refresh token and the single-flight refresh that keeps one
 * rotation from becoming two. Two clients on a page rotate the same token, and the second
 * rotation ends every session the user holds.
 */
export const idenzy = new Idenzy({
  publishableKey: import.meta.env.VITE_IDENZY_PUBLISHABLE_KEY ?? "",
  apiUrl: import.meta.env.VITE_IDENZY_API_URL ?? "",
});
`;

const ERRORS = `import { IdenzyApiError } from "@idenzy/js/errors";

/**
 * Every message your users read, in one file you own.
 *
 * Idenzy ships no UI and therefore no copy. What it promises instead is that these codes are
 * stable: they are part of the API, and renaming one would be a breaking change. So branch on
 * the code and write the sentence yourself, in your product's voice and your user's language.
 */
export function describeAuthError(failure: unknown): string {
  if (!(failure instanceof IdenzyApiError)) {
    return "We could not reach the server. Check your connection and try again.";
  }
  switch (failure.code) {
    case "invalid_credentials":
      return "That email and password do not match.";
    case "challenge_invalid":
      return "That code is not right. Check it and try again.";
    case "challenge_expired":
      return "That code has expired. Send yourself a new one.";
    case "challenge_attempts_exhausted":
      return "Too many attempts on that code. Send a new one.";
    case "rate_limited":
      return "Too many attempts. Wait a moment and try again.";
    case "password_breached":
      return "That password has appeared in a public breach. Please choose another.";
    case "password_too_weak":
      return "Please choose a longer password.";
    case "email_not_verified":
      return "Confirm your email address before signing in.";
    default:
      return "Something went wrong. Please try again.";
  }
}
`;

const SIGN_IN = `<script setup lang="ts">
/**
 * Your sign-in screen: your markup, your design system, our protocol.
 *
 * Three ways in, and the order is deliberate. A one-time code needs no password, no redirect
 * and no deep link, and it signs up an address that has no account yet, so the same form
 * covers both. Nothing navigates afterwards: the session changes, everything reading it
 * updates, and where the user goes next is your application's decision.
 */
import { useIdenzy } from "@idenzy/vue";
import { ref } from "vue";
import { describeAuthError } from "./auth-errors";

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
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
}

async function signInWithPassword(): Promise<void> {
  error.value = null;
  try {
    await idenzy.signIn.withPassword({ email: email.value, password: password.value });
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
`;

const SIGN_UP = `<script setup lang="ts">
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
`;

const CALLBACK = `<script setup lang="ts">
/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so only the tab that started the flow can finish it. Null means there was no code
 * in the URL at all, which is somebody opening this route directly.
 */
import { useIdenzy } from "@idenzy/vue";
import { onMounted, ref } from "vue";
import { describeAuthError } from "./auth-errors";

const idenzy = useIdenzy();
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const session = await idenzy.oauth.completeFromRedirect();
    window.location.replace(session === null ? "/sign-in" : "/");
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
});
</script>

<template>
  <main>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else>Signing you in...</p>
  </main>
</template>
`;
