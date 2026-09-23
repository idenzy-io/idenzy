<script setup lang="ts">
/** Where Google sign-in returns: spends the one-time code, then asks the API who this is. */
const idenzy = useIdenzy();
const failed = ref(false);

onMounted(async () => {
  try {
    await idenzy.oauth.completeFromRedirect();
    await navigateTo("/", { replace: true });
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <section style="max-width: 420px; margin: 64px auto; text-align: center">
    <p v-if="!failed" class="muted">Signing in…</p>
    <p v-else class="warn">
      Sign-in did not complete. Only idenzy.io Google Workspace accounts can sign in here.
      <NuxtLink to="/auth/sign-in">Try again</NuxtLink>
    </p>
  </section>
</template>
