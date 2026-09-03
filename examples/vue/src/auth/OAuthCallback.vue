<script setup lang="ts">
/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so only the tab that started the flow can finish it. Null means there was no code
 * in the URL at all, which is somebody opening this route directly.
 */
import { useIdenzy } from "@idenzy/vue";
import { onMounted, ref } from "vue";
import { describeAuthError } from "./auth-errors";

const idenzy = useIdenzy();
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const session = await idenzy.oauth.completeFromRedirect();
    window.location.replace(session === null ? "/sign-in" : "/");
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
