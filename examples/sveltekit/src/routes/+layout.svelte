<script lang="ts">
  import { browser } from "$app/environment";
  import { setIdenzy } from "@idenzy/svelte";
  import { createIdenzyClient } from "$lib/idenzy";

  const { data, children } = $props();

  // Both arguments are load-bearing. restore: browser keeps this layout from rotating a
  // refresh cookie during the server render, which is a request to the auth API per page,
  // answered signed-out, for nothing. initial is what makes that safe, and it goes in even
  // when it is null, because null is a server saying it looked and could not tell.
  setIdenzy({ client: createIdenzyClient(), restore: browser, initial: data.session });
</script>

{@render children()}
