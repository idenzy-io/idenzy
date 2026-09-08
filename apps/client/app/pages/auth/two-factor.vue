<script setup lang="ts">
/**
 * The second factor, where a sign-in that verified a password lands when the account has
 * an authenticator enrolled.
 *
 * It is a screen rather than a step inside the sign-in page because the challenge is a
 * separate call: `POST /v1/auth/mfa/verify` answers the challenge that `POST
 * /v1/auth/password` returned in place of a session. An authentication ends in a session
 * or a challenge and never an error (ADR-0010), so nothing that happens here is a
 * failure of the password the visitor already got right.
 *
 * The challenge itself is handed over by the sign-in screen once the panel builds an SDK
 * client, not read from the URL: a challenge id is a credential for the few minutes it
 * lives, and a URL is the least private thing on the page. A visitor who lands here
 * holding nothing goes back to log in, which is the same redirect that will bring them.
 *
 * Nothing here posts anywhere yet. `submitCode` is shaped like the call that replaces it
 * and answers from a timer instead.
 */
definePageMeta({ layout: "auth" });

/** Pinned by the protocol: a TOTP proof is `/^\d{6}$/` and nothing else. */
const CODE_LENGTH = 6;

/**
 * What the server allows before it locks the challenge. Kept here only so the simulation
 * below can reach `exhausted`; the count that matters is the server's, and this screen
 * reads it off the refusal rather than deciding it.
 */
const MAX_ATTEMPTS = 5;

const CHALLENGE_LIFETIME_MS = 5 * 60_000;
const SIMULATED_LATENCY_MS = 900;

/** Below this the deadline is worth saying out loud. Above it, it is a ticking clock. */
const EXPIRY_NOTICE_SECONDS = 60;

/**
 * The two states that end the challenge, and the one that is still waiting on the
 * visitor. A wrong code is not one of them: it leaves the screen exactly as it was, with
 * a sentence under the field, because the next code is thirty seconds away.
 */
type Screen = "entry" | "expired" | "exhausted";

/** What can be said under the field without replacing the screen. */
type Refusal = "invalid" | "unavailable";

type Verdict = "accepted" | Refusal | "expired" | "exhausted";

interface ChallengeView {
  lead: string;
  keyword: string;
  tail: string;
  body: string;
  tone: HeadingTone;
}

/**
 * `entry` is a plain title, unmarked and neutral, because colour on a heading is an
 * answer and nobody has typed a code yet.
 *
 * The two endings are told apart the way the recovery screens tell a bad link from an
 * unreadable one. `expired` is amber: nothing was refused, a deadline passed. `exhausted`
 * is red, because every code it holds was read and refused.
 */
const VIEWS: Record<Screen, ChallengeView> = {
  entry: {
    lead: "Enter your",
    keyword: "authenticator code",
    tail: "",
    body: "Open the app you set this account up with and type the six digits it is showing. They change every thirty seconds.",
    tone: "neutral",
  },
  expired: {
    lead: "This request has",
    keyword: "expired",
    tail: "",
    body: "A second factor is owed for a few minutes, not for as long as a tab stays open. Log in again and you will be asked once more.",
    tone: "warning",
  },
  exhausted: {
    lead: "Too many",
    keyword: "wrong codes",
    tail: "",
    body: "This request is locked and nothing more can be answered against it. Your account is untouched, and logging in again starts a new one.",
    tone: "error",
  },
};

/**
 * One sentence each, and neither of them says which digit was wrong.
 *
 * `unavailable` asks for the next code rather than offering to retry this one. A request
 * whose answer we never saw may well have arrived, and a TOTP code is spent by writing
 * its step back: re-sending one the server has already read gets it refused as used,
 * which would read as a second wrong code to somebody who typed it correctly twice.
 */
const REFUSALS: Record<Refusal, string> = {
  invalid: "That code is not right. Use the one your app is showing now.",
  unavailable: "We could not reach the server. Wait for the next code, then try that one.",
};

const code = ref("");
const screen = ref<Screen>("entry");
const refusal = ref<Refusal | null>(null);
const verifying = ref(false);
const attemptsLeft = ref(MAX_ATTEMPTS);

/**
 * Only the two methods this page calls. Typing the component instance would mean
 * importing from `vuetify/components`, which is the one thing the module's auto-import
 * exists to save every page from doing.
 */
const field = ref<{ focus: () => void } | null>(null);

/**
 * The challenge's own deadline, which is `MfaChallenge.expiresAt` once the panel holds
 * one. Started here so the countdown and the expiry below can be seen working.
 */
const expiresAt = ref(new Date(Date.now() + CHALLENGE_LIFETIME_MS));

const now = useNow({ interval: 1000 });

const secondsLeft = computed(() =>
  Math.max(0, Math.ceil((expiresAt.value.getTime() - now.value.getTime()) / 1000)),
);

const view = computed(() => VIEWS[screen.value]);

const submittable = computed(
  () => code.value.length === CODE_LENGTH && !verifying.value && screen.value === "entry",
);

/**
 * Said only in the last minute. A deadline five minutes out is a clock ticking at
 * somebody who is reading a code off a phone, and hurrying them is the one thing this
 * screen must not do.
 */
const expiryNotice = computed(() => {
  if (screen.value !== "entry" || secondsLeft.value > EXPIRY_NOTICE_SECONDS) return "";

  return `This request expires in ${secondsLeft.value} ${secondsLeft.value === 1 ? "second" : "seconds"}.`;
});

/**
 * Shown once it is nearly out, and not before. A counter that starts at five turns the
 * first typo into a warning about being locked out, which is a threat rather than help.
 */
const attemptsNotice = computed(() => {
  if (refusal.value !== "invalid" || attemptsLeft.value > 2) return "";

  return `${attemptsLeft.value} ${attemptsLeft.value === 1 ? "attempt" : "attempts"} left before this request is locked.`;
});

/**
 * The refusal goes as soon as the next attempt begins, which is the first digit of it
 * rather than the submit. It is keyed on the field becoming non-empty so that clearing
 * the field ourselves, below, does not wipe the message that explains why it was cleared.
 */
watch(code, (value) => {
  if (value.length > 0) refusal.value = null;
});

/**
 * A clock of our own may end a challenge early and must never extend one. A browser
 * running fast retires the screen a little before the server would, which costs a login;
 * one running slow leaves it up, and the server refuses what is submitted against it.
 * Only one of those directions is a way in.
 */
watch(secondsLeft, (value) => {
  if (value === 0 && screen.value === "entry") screen.value = "expired";
});

/**
 * Stands in for `challenge.submit({ factor: "totp", code })` until the panel builds an
 * SDK client.
 *
 * The verdict is read off the code so every state below can be reached by hand: 123456
 * is accepted, 000000 has the challenge expire underneath it, 111111 answers as an
 * outage, and everything else is wrong until the attempts run out.
 */
async function submitCode(candidate: string): Promise<Verdict> {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));

  if (candidate === "123456") return "accepted";
  if (candidate === "000000") return "expired";
  if (candidate === "111111") return "unavailable";

  return attemptsLeft.value <= 1 ? "exhausted" : "invalid";
}

async function verify() {
  if (!submittable.value) return;

  verifying.value = true;
  refusal.value = null;

  /**
   * Anything thrown is our side rather than a wrong code, and the two must not read
   * alike: an outage that says "that code is not right" has somebody checking a phone
   * that was correct all along.
   */
  const verdict = await submitCode(code.value).catch((): Verdict => "unavailable");

  verifying.value = false;

  if (verdict === "accepted") {
    /**
     * A proved second factor answers with a session, which the store publishes and the
     * panel is already watching. There is nothing to hand on from here: the page's whole
     * job was the six digits.
     */
    await navigateTo("/");
    return;
  }

  if (verdict === "expired" || verdict === "exhausted") {
    screen.value = verdict;
    return;
  }

  if (verdict === "invalid") attemptsLeft.value -= 1;

  refusal.value = verdict;
  code.value = "";

  /**
   * The caret is asked for only once the DOM has caught up. The field is disabled while
   * an answer is in flight, and a disabled input cannot take focus, so a `focus()` called
   * before that flush is a call that silently does nothing and leaves somebody typing at
   * a page that is not listening.
   */
  await nextTick();
  field.value?.focus();
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-md flex-col items-center text-center">
    <Icon class="text-4xl" name="material-symbols:fingerprint" />

    <!-- Unmarked while the screen is still asking, because there is no outcome to mark
         and a rule under the words would promise one. -->
    <AuthHeading
      :keyword="view.keyword"
      :lead="view.lead"
      :marked="screen !== 'entry'"
      :tail="view.tail"
      :tone="view.tone"
      class="mt-4"
    />

    <p class="mt-6 text-sm opacity-70 text-balance">{{ view.body }}</p>

    <!-- The field block is narrower than the copy above it, and the button below is the
         width of the six boxes exactly: the component's own 8px content padding is
         removed in theme.css so the two edges line up rather than nearly line up. -->
    <form
      v-if="screen === 'entry'"
      class="mt-8 flex w-full max-w-sm flex-col"
      @submit.prevent="verify"
    >
      <v-otp-input
        ref="field"
        v-model="code"
        :disabled="verifying"
        :error="refusal !== null"
        :length="CODE_LENGTH"
        autofocus
        label="Authenticator code"
        variant="filled"
        @finish="verify"
      />

      <!--
        One line is reserved whether or not there is anything in it, so an answer arrives
        in place rather than pushing the button down under the cursor that is about to
        press it.

        Only the refusal is a live region. The countdown changes every second, and a
        screen reader announcing it would talk over the person reading a code off a phone.
      -->
      <div class="mt-3 min-h-4 text-xs">
        <p
          v-if="refusal !== null"
          :style="{ color: 'rgb(var(--v-theme-error))' }"
          class="text-balance"
          role="alert"
        >
          {{ REFUSALS[refusal] }}
          <span v-if="attemptsNotice">{{ attemptsNotice }}</span>
        </p>

        <p v-else-if="expiryNotice" class="opacity-60">{{ expiryNotice }}</p>
      </div>

      <!-- Six digits auto-submit, so this is rarely the way in. It is here for the one
           case that needs it: a code already typed when the answer never came back. -->
      <v-btn
        :disabled="!submittable"
        :loading="verifying"
        class="mt-5 text-sm"
        color="primary"
        type="submit"
        variant="flat"
      >
        Verify
      </v-btn>
    </form>

    <v-btn v-else class="mt-8 text-sm" color="primary" to="/auth/login" variant="flat">
      Log in again
    </v-btn>

    <!-- One fallback, because one is enrolled. The wired screen offers whatever is left
         in `challenge.factors` after the first, which is where a passkey shows up. -->
    <v-btn
      v-if="screen === 'entry'"
      class="mt-6 text-xs font-medium"
      to="/auth/recovery-code"
      variant="plain"
    >
      Use a recovery code instead
    </v-btn>
  </div>
</template>
