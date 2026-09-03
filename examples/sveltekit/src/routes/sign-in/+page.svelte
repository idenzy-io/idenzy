<script lang="ts">
  import type { AuthResult, MfaChallenge } from "@idenzy/js/mfa/auth-result";
  import { getIdenzy } from "@idenzy/svelte";
  import { goto } from "$app/navigation";
  import { describeAuthError } from "$lib/auth-errors";

  /**
   * Your sign-in page: your markup, your design system, our protocol.
   *
   * A one-time code needs no password, no redirect and no deep link, and it signs up an
   * address that has no account yet, so the same form covers both.
   *
   * Either can end at a second factor rather than a session, which is what `finish` is
   * for. A page that navigated anyway would land a half-signed-in visitor on your home page.
   */
  const { client } = getIdenzy();

  let email = $state("");
  let code = $state("");
  let password = $state("");
  let codeSent = $state(false);
  let challenge = $state<MfaChallenge | null>(null);
  let factorCode = $state("");
  let error = $state<string | null>(null);

  async function finish(result: AuthResult): Promise<void> {
    if (result.status === "mfa_required") {
      challenge = result.challenge;
      return;
    }
    await goto("/");
  }

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = $derived(challenge?.factors.includes("totp") ? "totp" : "recovery");

  async function submitSecondFactor(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    const pending = challenge;
    if (pending === null) return;
    try {
      await pending.submit({ factor: codeFactor, code: factorCode });
      await goto("/");
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  /** Runs the WebAuthn ceremony for you. A cancelled prompt is the browser's own error. */
  async function submitPasskey(): Promise<void> {
    error = null;
    const pending = challenge;
    if (pending === null) return;
    try {
      await pending.submitPasskey();
      await goto("/");
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function sendCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await client.signIn.withEmailOtp({ email });
      codeSent = true;
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function verifyCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await finish(await client.signIn.verifyOtp({ code }));
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function signInWithPassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await finish(await client.signIn.withPassword({ email, password }));
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function continueWithGoogle(): Promise<void> {
    // This URI has to be registered for the project. It is checked at the start of the flow
    // and again at the callback, and an unregistered one is refused rather than followed.
    await client.signIn.withOAuth({
      provider: "google",
      redirectUri: window.location.origin + "/auth/callback",
    });
  }
</script>

<main>
  <h1>Sign in</h1>
  {#if error}<p role="alert">{error}</p>{/if}

  {#if challenge}
    <section>
      <h2>One more step</h2>
      {#if challenge.factors.includes("passkey")}
        <button type="button" onclick={submitPasskey}>Use your passkey</button>
      {/if}
      <form onsubmit={submitSecondFactor}>
        <label for="factorCode">
          {codeFactor === "recovery"
            ? "A recovery code"
            : "The code from your authenticator app"}
        </label>
        <input id="factorCode" bind:value={factorCode} autocomplete="one-time-code" />
        <button type="submit">Continue</button>
      </form>
    </section>
  {/if}

  {#if codeSent}
    <form onsubmit={verifyCode}>
      <label for="code">The code we emailed you</label>
      <input id="code" bind:value={code} inputmode="numeric" autocomplete="one-time-code" />
      <button type="submit">Continue</button>
    </form>
  {:else}
    <form onsubmit={sendCode}>
      <label for="email">Email</label>
      <input id="email" type="email" bind:value={email} autocomplete="email" />
      <button type="submit">Email me a code</button>
    </form>
  {/if}

  <form onsubmit={signInWithPassword}>
    <h2>Or use a password</h2>
    <label for="password">Password</label>
    <input id="password" type="password" bind:value={password} autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>

  <button type="button" onclick={continueWithGoogle}>Continue with Google</button>
</main>
