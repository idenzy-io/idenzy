<script setup lang="ts">
/**
 * Where the link in a verification email lands: `/auth/account-verification?token=...`.
 *
 * The visitor has nothing to contribute to the answer, so there is nothing to fill in
 * until it arrives. The page verifies on mount, holds the shape of the answer while it
 * waits, and settles into one of six outcomes.
 *
 * Two of those are worth separating even though both leave the visitor signed out. A
 * token we read and refused is theirs to fix, and a new link fixes it. A token we could
 * not judge at all is ours, and telling somebody holding a perfectly good link that it is
 * invalid sends them round a loop that cannot end: they ask for another, it works no
 * better, and the thing that was broken was never the link. Same distinction the SSR
 * helpers draw between a null seed and a throw.
 *
 * Nothing here posts anywhere yet. `verifyToken` and `sendNewLink` are shaped like the
 * calls that will replace them and answer from a timer instead.
 */
definePageMeta({ layout: "auth" });

const route = useRoute();
const router = useRouter();

type Outcome = "verified" | "already" | "expired" | "invalid" | "unavailable";
type Status = "verifying" | "missing" | Outcome;

/**
 * A sent link is a screen rather than a status, because the token's verdict has not
 * changed and a retry would still have to answer for it. It replaces the whole screen all
 * the same: leaving "this link has expired" above a confirmation reports a problem the
 * visitor has already dealt with.
 */
type Screen = Status | "sent";

interface VerificationView {
  /** The heading, split so the words carrying the outcome can be marked. */
  lead: string;
  keyword: string;
  /** Usually empty. `AuthHeading` supplies the spaces between the three. */
  tail: string;
  body: string;
  /**
   * Colours the keyword and the rule under it, and nothing else. The sentence says the
   * same thing without it, because a state a colour-blind visitor cannot tell apart is a
   * state we did not communicate.
   */
  tone: HeadingTone;
}

/**
 * One entry per screen, including the one that is still waiting, so the heading is built
 * the same way throughout and the template never handles a null view.
 *
 * `unavailable` is amber rather than red, which is the whole distinction this page draws
 * said in a colour: red is a link we read and refused, amber is one we could not read at
 * all. `already` carries no colour, because nothing about it needs acting on.
 */
const VIEWS: Record<Screen, VerificationView> = {
  verifying: {
    lead: "Verifying",
    keyword: "your account",
    tail: "",
    body: "",
    tone: "neutral",
  },
  verified: {
    lead: "Your account",
    keyword: "is verified",
    tail: "",
    body: "Your email address is confirmed and the account is ready. Log in and the panel is yours.",
    tone: "success",
  },
  already: {
    lead: "This account is",
    keyword: "already verified",
    tail: "",
    body: "The link has been used once and that was enough. There is nothing left to do here.",
    tone: "neutral",
  },
  expired: {
    lead: "This link has",
    keyword: "expired",
    tail: "",
    body: "Verification links are short-lived, which is what stops an old email being a way in. Tell us the address you signed up with and a new one is on its way.",
    tone: "warning",
  },
  invalid: {
    lead: "This link is",
    keyword: "not valid",
    tail: "",
    body: "It may have been replaced by a newer one, or copied without its last few characters. A fresh link costs nothing.",
    tone: "error",
  },
  missing: {
    lead: "This link is",
    keyword: "incomplete",
    tail: "",
    body: "The address carries no token at all, which usually means an email client wrapped the link across two lines. Copy the whole thing, or ask for a new one.",
    tone: "error",
  },
  unavailable: {
    lead: "We could",
    keyword: "not check",
    tail: "your link",
    body: "Something on our side did not answer. Your link is untouched and this is worth another try in a moment.",
    tone: "warning",
  },
  // The two screens whose body is not a fixed sentence: one is a skeleton, the other
  // names the address and is written in the template.
  sent: {
    lead: "Check",
    keyword: "your inbox",
    tail: "",
    body: "",
    tone: "success",
  },
};

const status = ref<Status>("verifying");
const email = ref("");
const sending = ref(false);
const linkSent = ref(false);

const screen = computed<Screen>(() => (linkSent.value ? "sent" : status.value));
const view = computed(() => VIEWS[screen.value]);

/** The three states a new link can repair. Everything else has nothing to send. */
const offersNewLink = computed(
  () => status.value === "expired" || status.value === "invalid" || status.value === "missing",
);

/** Suppressed where the primary button is already the way to log in. */
const showsLoginLink = computed(
  () => screen.value !== "verifying" && screen.value !== "verified" && screen.value !== "already",
);

// Enough to stop a submit that cannot succeed. Whether the address exists is the server's
// answer, and it is deliberately not one we repeat back.
const sendable = computed(() => /.+@.+/.test(email.value.trim()));

/**
 * Read once, at setup, and deliberately not reactive: the token is scrubbed from the URL
 * below and a retry has to keep working after that.
 */
const rawToken = route.query["token"];
const token = typeof rawToken === "string" ? rawToken.trim() : "";

const SIMULATED_LATENCY_MS = 1200;

/**
 * Stands in for `POST /v1/auth/verify-account` until the panel builds an SDK client.
 *
 * The outcome is read off the token so every state below can be reached by hand: one
 * containing "expired", "used" or "down" gives those, anything under 24 characters is
 * treated as truncated, and everything else verifies.
 */
async function verifyToken(candidate: string): Promise<Outcome> {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));

  if (candidate.includes("expired")) return "expired";
  if (candidate.includes("used")) return "already";
  if (candidate.includes("down")) return "unavailable";
  if (candidate.length < 24) return "invalid";

  return "verified";
}

async function verify() {
  if (token.length === 0) {
    status.value = "missing";
    return;
  }

  status.value = "verifying";
  status.value = await verifyToken(token);
}

/**
 * Anything the call throws lands on `unavailable` rather than on a bad-token state. A
 * network that dropped and a token we rejected are different answers, and only one of
 * them is the visitor's to fix.
 */
function start() {
  verify().catch(() => {
    status.value = "unavailable";
  });
}

async function sendNewLink() {
  // POST /v1/auth/otp/start with the address above, channel "email".
  sending.value = true;
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));
  sending.value = false;
  linkSent.value = true;
}

onMounted(() => {
  /**
   * The token leaves the address bar as soon as it has been read. It is a credential that
   * signs somebody in to an account, and a URL is the least private thing on the page: it
   * sits in history, in a screen share and in whatever the browser syncs. Replacing rather
   * than pushing keeps the back button pointing where the visitor came from.
   */
  if (token.length > 0) {
    void router.replace({ path: route.path });
  }

  start();
});
</script>

<template>
  <div class="mx-auto flex w-full max-w-md flex-col items-center text-center">
    <!-- The outcome is announced rather than only drawn: a visitor using a screen reader
         gets no signal from a word changing colour, and this page's entire content is the
         answer. -->
    <div class="flex w-full flex-col items-center" role="status">
      <!-- Unmarked while we wait, because there is no outcome yet to mark. The skeleton
           below is the whole of what that screen has to say. -->
      <AuthHeading
        :keyword="view.keyword"
        :lead="view.lead"
        :marked="screen !== 'verifying'"
        :tail="view.tail"
        :tone="view.tone"
      />

      <!-- The heading is real from the first frame and only the answer is a placeholder,
           which is what makes the skeleton honest: a screen with every word greyed out
           leaves the visitor guessing what the wait is even for.

           The tint is an alpha on the colour rather than an `opacity`, because
           `animate-pulse` animates opacity itself and would overwrite it: the bars come
           out at half white on a dark surface, which reads as content that has loaded. -->
      <div
        v-if="screen === 'verifying'"
        aria-hidden="true"
        class="mt-6 flex w-full animate-pulse flex-col items-center gap-3.5 motion-reduce:animate-none"
      >
        <div class="h-3 w-full rounded-full bg-current/15" />
        <div class="h-3 w-4/5 rounded-full bg-current/15" />
      </div>

      <!-- The one line that names a value rather than only reading as copy, so it is
           written here rather than sitting in `VIEWS`. The address is set as code because
           that is what it is: a string to be checked character by character for the typo
           that is the likeliest reason nothing arrives.

           Dimmed by mixing the colour rather than with `opacity`, which applies to a whole
           subtree and would take the address down with it.

           The sentence stays true whether or not the address is one we hold. An answer
           that differed would turn this form into a way of asking us which addresses have
           accounts, which is the oracle the passkey flow refuses to be. -->
      <p v-else-if="screen === 'sent'" class="mt-6 text-sm text-current/70 text-balance">
        If
        <code
          :style="{ color: 'rgb(var(--v-theme-primary))' }"
          class="rounded-md bg-current/10 px-1.5 py-0.5 font-mono text-[0.8125rem]"
        >{{ email.trim() }}</code>
        needs verifying, a new link is on its way. Give it a minute, then look in spam
        before asking for another.
      </p>

      <p v-else class="mt-6 text-sm opacity-70 text-balance">{{ view.body }}</p>
    </div>

    <div class="mt-8 flex w-full flex-col items-center gap-3">
      <!-- The action is a placeholder too, and the same height as the button that replaces
           it, so the answer arrives in place rather than pushing the page around. -->
      <div
        v-if="screen === 'verifying'"
        aria-hidden="true"
        class="h-10 w-40 animate-pulse rounded-[var(--idenzy-radius)] bg-current/15 motion-reduce:animate-none"
      />

      <v-btn
        v-else-if="screen === 'verified' || screen === 'already'"
        class="text-sm"
        color="primary"
        to="/auth/login"
        variant="flat"
      >
        Continue to log in
      </v-btn>

      <v-btn
        v-else-if="screen === 'unavailable'"
        class="text-sm"
        color="primary"
        prepend-icon="material-symbols:refresh"
        variant="flat"
        @click="start"
      >
        Try again
      </v-btn>

      <!-- A typo in the address is the likeliest way this form fails, and it is a failure
           nothing else on the screen can report, so the way back to the field stays. -->
      <v-btn
        v-else-if="screen === 'sent'"
        class="text-xs font-medium"
        variant="plain"
        @click="linkSent = false"
      >
        Use a different address
      </v-btn>

      <form
        v-else-if="offersNewLink"
        class="flex w-full flex-col gap-2 text-start"
        @submit.prevent="sendNewLink"
      >
        <label class="text-xs font-medium opacity-70" for="email">Email address</label>
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

        <v-btn
          :disabled="!sendable"
          :loading="sending"
          class="mt-4 text-sm"
          color="primary"
          type="submit"
          variant="flat"
        >
          Send a new link
        </v-btn>
      </form>
    </div>

    <v-btn v-if="showsLoginLink" class="mt-10 text-xs font-medium" to="/auth/login" variant="plain">
      Back to log in
    </v-btn>
  </div>
</template>
