<script lang="ts">
  import { getIdenzy } from "@idenzy/svelte";
  import { goto } from "$app/navigation";
  import { describeAuthError } from "$lib/auth-errors";

  /**
   * Registration with a password, which is the only way in that needs its own page. Every
   * other route creates the account as it signs somebody in.
   */
  const { client } = getIdenzy();

  let email = $state("");
  let password = $state("");
  let displayName = $state("");
  let error = $state<string | null>(null);

  async function signUp(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await client.signUp.withPassword({ email, password, displayName });
      await goto("/");
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }
</script>

<main>
  <h1>Create an account</h1>
  {#if error}<p role="alert">{error}</p>{/if}

  <form onsubmit={signUp}>
    <label for="displayName">Name</label>
    <input id="displayName" bind:value={displayName} autocomplete="name" />

    <label for="email">Email</label>
    <input id="email" type="email" bind:value={email} autocomplete="email" />

    <label for="password">Password</label>
    <input id="password" type="password" bind:value={password} autocomplete="new-password" />

    <button type="submit">Create account</button>
  </form>
</main>
