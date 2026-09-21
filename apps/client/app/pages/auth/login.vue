<script setup lang="ts">
/**
 * Sign-in for the panel: one narrow column, the password form first and everything
 * passwordless below a divider — the same shape as `recover.vue` and `two-factor.vue`
 * rather than the two-column spread this screen used to be. A single compact column reads
 * as centred on its own; a card around it would be answering a problem this layout does
 * not have.
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
  <div class="mx-auto flex w-full max-w-md flex-col items-center text-center">
    <Icon class="text-4xl" name="material-symbols:fingerprint" />

    <AuthHeading :marked="false" class="mt-4" keyword="Idenzy" lead="Log in to" tone="neutral" />

    <div class="mt-8 flex w-full flex-col items-center gap-6">
      <!-- No gap on the form. A label sits directly on its field because the eleven
           pixels between the two are inside the 44px control, and the only space the
           template owns is the one between one row and the next. -->
      <form class="flex w-full flex-col text-start" @submit.prevent="signIn">
        <label class="auth-caps" for="email">
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

        <label class="auth-caps mt-[22px]" for="password">
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

        <!-- 33px above, which is the reference's own measure from the rule under the last
             field to the top of the button. Neither the size nor the type is set here:
             `variant="flat"` is what says "this is the thing the form commits", and
             theme.css sizes it from that. -->
        <v-btn
          :disabled="!submittable"
          :loading="busy"
          block
          class="mt-[33px]"
          color="primary"
          type="submit"
          variant="flat"
        >
          Log in
        </v-btn>
      </form>

      <!-- Two rules with the word between them, rather than `v-divider`'s own content
           slot. The slot renders a wrapper holding two dividers, and the `w-full` a
           template puts on the component lands on those two inner elements instead of on
           the wrapper: the wrapper is then sized by its content, which in a column that
           centres its items is the word alone, and both rules collapse to nothing. The
           word has been floating there with no lines either side since the slot was
           first used. Built by hand, each rule is a flex item and takes half of what the
           word leaves. -->
      <div class="flex w-full items-center gap-4">
        <v-divider />
        <span class="auth-caps">Or</span>
        <v-divider />
      </div>

      <AuthProviderList
        class="w-full"
        link-label="Email me a magic link"
        @link="sendMagicLink"
        @provider="continueWith"
      />
    </div>

    <v-btn class="mt-10" to="/auth/recover" variant="plain">
      Can't log in?
    </v-btn>
  </div>
</template>
