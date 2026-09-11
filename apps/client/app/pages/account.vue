<script setup lang="ts">
/**
 * Where the account screen used to live.
 *
 * It is a tab of the settings screen now, so this route redirects rather than 404s: the
 * user menu, the authenticator screen and anything anybody bookmarked all pointed here,
 * and a dead link to somebody's own account is the one that reads as the panel being
 * broken.
 */
definePageMeta({ redirect: "/settings/account" });
</script>
