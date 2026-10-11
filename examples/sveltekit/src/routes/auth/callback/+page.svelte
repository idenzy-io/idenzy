<script lang="ts">
  import type { MfaChallenge } from "@idenzy/js/mfa/auth-result";
  import { getIdenzy } from "@idenzy/svelte";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { describeAuthError } from "$lib/auth-errors";

  /**
   * Where Google, Apple, GitHub and Microsoft send the browser back.
   *
   * In onMount, and that is not an optimisation: the code in the URL is exchanged with a
   * verifier held in this browser's own session storage, so a server render has nothing to
   * finish the flow with. Null means there was no code in the URL at all.
   *
   * A provider's sign-in can still owe a second factor, and it is asked for here: the
   * challenge lives in this page's memory, so a page that navigated away first would lose it.
   */
  const { client } = getIdenzy();
  let error = $state<string | null>(null);
  let challenge = $state<MfaChallenge | null>(null);
  let factorCode = $state("");

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = $derived(challenge?.factors.includes("totp") ? "totp" : "recovery");

  onMount(async () => {
    try {
      const result = await client.oauth.completeFromRedirect();
      if (result?.status === "mfa_required") {
        challenge = result.challenge;
        return;
      }
      await goto(result === null ? "/sign-in" : "/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  });

  async function submitSecondFactor(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    if (challenge === null) return;
    try {
      await challenge.submit({ factor: codeFactor, code: factorCode });
      await goto("/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function submitPasskey(): Promise<void> {
    error = null;
    if (challenge === null) return;
    try {
      await challenge.submitPasskey();
      await goto("/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }
</script>

<main>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if challenge}
    <h1>One more step</h1>
    {#if challenge.factors.includes("passkey")}
      <button type="button" onclick={submitPasskey}>Use your passkey</button>
    {/if}
    <form onsubmit={submitSecondFactor}>
      <label for="factorCode">
        {codeFactor === "recovery" ? "A recovery code" : "The code from your authenticator app"}
      </label>
      <input id="factorCode" bind:value={factorCode} autocomplete="one-time-code" />
      <button type="submit">Continue</button>
    </form>
  {:else if !error}
    <p>Signing you in...</p>
  {/if}
</main>
