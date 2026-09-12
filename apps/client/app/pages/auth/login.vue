<script setup lang="ts">
/**
 * Sign-in for the panel: a password form on the left, everything passwordless on the
 * right, one divider between them.
 *
 * Both columns are offered at once rather than behind a "more options" disclosure,
 * because a provider button is the fastest path for somebody who has one and invisible
 * to somebody who does not know to look.
 *
 * The password form is real and goes through `@idenzy/js`, which is our own product: we
 * sign in to the panel the way a customer signs in to theirs (PROJECT.md 9.5). Nothing
 * here is an authentication widget we ship — this is the application that owns the screen
 * building its own, which is exactly what ADR-0002 leaves to it.
 *
 * A sign-in can end in two places and both are handled. A session means done; a challenge
 * means a second factor is owed, and the SDK hands back the object that completes it
 * (ADR-0010). The MFA screen is not built yet, so that branch says so plainly rather than
 * dropping somebody on a page that cannot finish.
 *
 * The passwordless column is still unwired and says nothing about being wired.
 */
import { MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { signInMessage } from "~/utils/sign-in-errors";

definePageMeta({ layout: "auth" });

const { mdAndUp } = useDisplay();
const idenzy = useIdenzy();
const route = useRoute();

const email = ref("");
const password = ref("");
const revealed = ref(false);
const busy = ref(false);
const refusal = ref("");

// Enough to stop a submit that cannot succeed. Real validation is the server's answer,
// which is the only one that knows whether the address exists.
const submittable = computed(
  () => email.value.trim().length > 0 && password.value.length > 0 && !busy.value,
);

/**
 * Where to land afterwards.
 *
 * Read from the query the session guard put there, and only ever a path of ours: an
 * open redirect on a sign-in screen hands somebody's fresh session to whatever host the
 * link named, which is the classic way a login page becomes a phishing step.
 */
const destination = computed(() => {
  const redirect = route.query["redirect"];
  if (typeof redirect !== "string") return "/";
  return redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
});

async function signIn() {
  if (!submittable.value) return;
  busy.value = true;
  refusal.value = "";
  try {
    const result = await idenzy.signIn.withPassword({
      email: email.value.trim(),
      password: password.value,
    });
    if (result instanceof MfaChallenge) {
      refusal.value =
        "This account needs a second factor, and that screen is not built yet. Sign in without it for now.";
      return;
    }
    await navigateTo(destination.value);
  } catch (error: unknown) {
    refusal.value = signInMessage(error);
  } finally {
    busy.value = false;
  }
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

    <h1 class="mt-4 text-2xl font-semibold tracking-tight">Log in to Idenzy</h1>

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

        <!-- Above the button, so it sits between the fields somebody would change and the
             control they would press again. Plain error-coloured text rather than a boxed
             note, which is what every other form in the panel does: a tinted panel reads as
             a banner about the page, and this is a sentence about the fields just above it.
             `role="alert"` because it arrives after a submit and nothing else announces it. -->
        <p v-if="refusal !== ''" class="m-0 mt-5 text-xs leading-5 text-error" role="alert">
          {{ refusal }}
        </p>

        <v-btn
          :disabled="!submittable"
          :loading="busy"
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
