<script setup lang="ts">
/**
 * The way back in when a password is gone: `/auth/recover`, which is where the sign-in
 * screen's "Can't log in?" has pointed since it was written.
 *
 * Two screens. The first asks for an address; the second says a link is on its way, and
 * says it in exactly the same words whether or not the address is one we hold. That
 * wording is the security property of the page rather than a nicety: this is the one form
 * on the panel anybody can reach without signing in, and an answer that differed would
 * turn it into a way of asking us which addresses have accounts.
 *
 * What it never does is confirm the send by naming what it found. The address on the
 * second screen is the one that was typed, echoed back so a typo is visible, and not a
 * record we looked anything up in.
 *
 * Nothing here posts anywhere yet. `sendResetLink` is shaped like the call that will
 * replace it and answers from a timer instead.
 */
definePageMeta({ layout: "auth" });

const screen = ref<"ask" | "sent">("ask");
const email = ref("");
const sending = ref(false);
const refused = ref(false);

/** When the last link went out, as epoch milliseconds. Zero until one has. */
const sentAt = ref(0);

/**
 * Long enough that a second press is a decision rather than impatience, short enough that
 * somebody whose mail is genuinely slow is not stuck. The server rate-limits this send in
 * any case; the countdown exists so the button says when it will work instead of failing
 * and explaining afterwards.
 */
const RESEND_COOLDOWN_SECONDS = 45;

const SIMULATED_LATENCY_MS = 1200;

const now = useNow({ interval: 1000 });

/**
 * Measured from the moment the link went out rather than ticked down, because a
 * background tab's interval is throttled: a counter would still read thirty seconds when
 * a minute had passed, and the button would go on refusing a send the server would have
 * allowed.
 */
const cooldown = computed(() =>
  Math.max(0, RESEND_COOLDOWN_SECONDS - Math.floor((now.value.getTime() - sentAt.value) / 1000)),
);

// Enough to stop a submit that cannot succeed. Whether the address exists is the server's
// answer, and it is deliberately not one we repeat back.
const sendable = computed(() => /.+@.+/.test(email.value.trim()));

/**
 * Stands in for `POST /v1/auth/password-reset/start` until the panel builds an SDK client.
 * An address containing "down" is refused, so the path that is not the happy one can be
 * reached by hand.
 */
async function sendResetLink(address: string): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));

  return !address.includes("down");
}

/**
 * A refusal here is ours, never the address's. Anything the send could say about who the
 * address belongs to stays on the server, so the only thing this can report is that we
 * could not do our half of it.
 */
async function send() {
  sending.value = true;
  refused.value = false;

  const sent = await sendResetLink(email.value.trim());

  sending.value = false;

  if (!sent) {
    refused.value = true;
    return;
  }

  sentAt.value = Date.now();
  screen.value = "sent";
}

function amend() {
  refused.value = false;
  screen.value = "ask";
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-md flex-col items-center text-center">
    <div class="flex w-full flex-col items-center" role="status">
      <!-- Plain, because a colour and a rule are how this family reports an answer and
           this screen has none to report. It is a title over a form. -->
      <AuthHeading
        v-if="screen === 'ask'"
        :marked="false"
        keyword="password"
        lead="Reset your"
        tone="neutral"
      />

      <AuthHeading v-else keyword="your inbox" lead="Check" tone="success" />

      <p v-if="screen === 'ask'" class="mt-6 text-sm opacity-70 text-balance">
        Give us the address on your account and we will send a link that sets a new
        password. It works once and expires shortly after it arrives.
      </p>

      <!-- The address is set as code because that is what it is: a string to be read back
           character by character for the typo that is the likeliest reason nothing turns
           up. Dimmed by mixing the colour rather than with `opacity`, which applies to a
           whole subtree and would take the address down with it. -->
      <p v-else class="mt-6 text-sm text-current/70 text-balance">
        If
        <code
          :style="{ color: 'rgb(var(--v-theme-primary))' }"
          class="rounded-md bg-current/10 px-1.5 py-0.5 font-mono text-[0.8125rem]"
        >{{ email.trim() }}</code>
        has an account, a link is on its way. Look in spam before asking for another.
      </p>
    </div>

    <div class="mt-8 flex w-full flex-col items-center gap-3">
      <form
        v-if="screen === 'ask'"
        class="flex w-full flex-col gap-2 text-start"
        @submit.prevent="send"
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
          Send reset link
        </v-btn>
      </form>

      <!-- Outlined rather than filled, because the thing to do next is read an email and
           no button on this screen can do that. -->
      <v-btn
        v-else
        :disabled="cooldown > 0"
        :loading="sending"
        block
        class="text-sm"
        color="neutral"
        variant="outlined"
        @click="send"
      >
        {{ cooldown > 0 ? `Send another link in ${cooldown}s` : "Send another link" }}
      </v-btn>

      <!-- Ours to own, and worded so it cannot be read as anything about the address. -->
      <p
        v-if="refused"
        :style="{ color: HEADING_TONES.warning.text }"
        class="text-xs text-balance"
      >
        We could not send that just now. Nothing is wrong with your account, and it is
        worth another try in a moment.
      </p>

      <!-- A typo is the likeliest way this fails and the one failure nothing else on the
           screen can report, so the way back to the field stays. -->
      <v-btn
        v-if="screen === 'sent'"
        class="text-xs font-medium"
        variant="plain"
        @click="amend"
      >
        Use a different address
      </v-btn>
    </div>

    <v-btn class="mt-10 text-xs font-medium" to="/auth/login" variant="plain">
      Back to log in
    </v-btn>
  </div>
</template>
