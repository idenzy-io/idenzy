<script setup lang="ts">
/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * On the client only, and that is not an optimisation: the code in the URL is exchanged with a
 * verifier held in this browser's own session storage, so a server render has nothing to
 * complete the flow with. Null means there was no code in the URL at all.
 */
import { describeAuthError } from "~/utils/auth-errors";

const idenzy = useIdenzy();
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const session = await idenzy.oauth.completeFromRedirect();
    await navigateTo(session === null ? "/sign-in" : "/", { replace: true });
  } catch (failure) {
    error.value = describeAuthError(failure);
  }
});
</script>

<template>
  <main>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-else>Signing you in...</p>
  </main>
</template>
