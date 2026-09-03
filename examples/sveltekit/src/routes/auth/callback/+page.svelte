<script lang="ts">
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
   */
  const { client } = getIdenzy();
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const session = await client.oauth.completeFromRedirect();
      await goto(session === null ? "/sign-in" : "/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  });
</script>

<main>
  {#if error}<p role="alert">{error}</p>{:else}<p>Signing you in...</p>{/if}
</main>
