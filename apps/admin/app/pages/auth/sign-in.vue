<script setup lang="ts">
/**
 * Sign-in: Google only, idenzy.io Workspace only (ADR-0018). There is no password field because
 * there is no password: the operator project has one method, and the provider refuses any Google
 * account the idenzy.io Workspace does not manage.
 */
const route = useRoute();
const idenzy = useIdenzy();
const refused = computed(() => route.query["refused"] === "1");
const failed = ref<string | null>(null);

async function google() {
  failed.value = null;
  try {
    await idenzy.oauth.signIn({
      provider: "google",
      redirectUri: `${window.location.origin}/auth/callback`,
    });
  } catch {
    failed.value = "Google sign-in could not start. Is the operator project configured?";
  }
}
</script>

<template>
  <section style="max-width: 420px; margin: 64px auto; text-align: center">
    <h1>Operator console</h1>
    <p class="muted">For Idenzy staff. Sign in with your idenzy.io Google account.</p>
    <p v-if="refused" class="warn">
      That account is signed in but is not on the staff list, or has been deactivated.
    </p>
    <p v-if="failed" class="warn">{{ failed }}</p>
    <button class="primary" type="button" @click="google">Sign in with Google</button>
  </section>
</template>
