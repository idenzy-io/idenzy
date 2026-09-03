import {
  FrameworkTemplate,
  type ScaffoldContext,
  type ScaffoldFile,
} from "../framework-template.js";

/**
 * Nuxt, where the module does the wiring and the pages are all that is left.
 *
 * Nothing here builds a client. The module's plugin builds one per Nuxt app, which on a server
 * means one per request: a client shared between requests is a session shared between people.
 * Given `projectId` it also verifies the session cookie during the render and seeds the
 * payload, so the browser hydrates from the snapshot the HTML was rendered from.
 */
export class NuxtTemplate extends FrameworkTemplate {
  readonly id = "nuxt";
  readonly title = "Nuxt";
  readonly packages = ["@idenzy/nuxt", "@idenzy/js"];
  readonly markers = ["nuxt"];
  readonly envFile = ".env";
  readonly envPrefix = "NUXT_PUBLIC_";

  protected override envEntries(context: ScaffoldContext) {
    return [
      ...super.envEntries(context),
      {
        key: "NUXT_PUBLIC_IDENZY_PROJECT_ID",
        value: "",
        comment:
          "Lets the server verify the cookie and seed the render. Public: it is the audience of every token we sign.",
      },
    ];
  }

  protected routes(_context: ScaffoldContext): readonly ScaffoldFile[] {
    return [
      { path: "app/utils/auth-errors.ts", contents: ERRORS },
      { path: "app/pages/sign-in.vue", contents: SIGN_IN },
      { path: "app/pages/sign-up.vue", contents: SIGN_UP },
      { path: "app/pages/auth/callback.vue", contents: CALLBACK },
    ];
  }

  protected steps(): readonly string[] {
    return [
      'Add the module in nuxt.config.ts: modules: ["@idenzy/nuxt"], idenzy: { publishableKey: "", apiUrl: "" }. Leave both empty and let the environment fill them: Nuxt only overrides runtime config keys that already exist, so a key left out of the config is one the env var is silently discarded for.',
      "Register http://localhost:3000/auth/callback as a redirect URI, and http://localhost:3000 as a browser origin, for this project.",
      "Optional: set NUXT_IDENZY_SECRET_KEY to have the server poll the revocation set, so a session revoked minutes ago is refused before its access token expires. It is server-only and must never reach the public half of runtime config.",
      "Everything under app/ is yours now. Restyle it, rename the routes, delete what you do not use.",
    ];
  }
}

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

async function submitSecondFactor(): Promise<void> {
  error.value = null;
  const pending = challenge.value;
  if (pending === null) return;
  try {
    await pending.submit({ factor: pending.factors[0], code: factorCode.value });
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

    <form v-if="challenge" @submit.prevent="submitSecondFactor">
      <h2>One more step</h2>
      <label for="factorCode">
        {{ challenge.factors[0] === "recovery"
          ? "A recovery code"
          : "The code from your authenticator app" }}
      </label>
      <input id="factorCode" v-model="factorCode" autocomplete="one-time-code" />
      <button type="submit">Continue</button>
    </form>

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
 * Registration with a password, which is the only way in that needs its own page.
 *
 * Every other route creates the account as it signs somebody in: a code sent to an address
 * nobody has claimed, a first Google profile, a passkey enrolled during onboarding.
 */
import { describeAuthError } from "~/utils/auth-errors";

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
    await navigateTo("/");
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
 * On the client only, and that is not an optimisation: the code in the URL is exchanged with a
 * verifier held in this browser's own session storage, so a server render has nothing to
 * complete the flow with. Null means there was no code in the URL at all.
 */
import { describeAuthError } from "~/utils/auth-errors";

const idenzy = useIdenzy();
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const session = await idenzy.oauth.completeFromRedirect();
    await navigateTo(session === null ? "/sign-in" : "/", { replace: true });
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
