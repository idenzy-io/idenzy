<script setup lang="ts">
/**
 * The colour preference, handed to Vuetify.
 *
 * Here because this component wraps all three layouts and never unmounts. A watcher in a
 * layout would stop at that layout's edge, and signing out swaps the panel's layout for
 * the flow's: the theme would be whatever the last screen left it at.
 *
 * `theme.change` rather than `theme.global.name`, which Vuetify 4 keeps as a ref and
 * deprecates writing to. Immediate, so the first paint is already the chosen theme rather
 * than the operating system's answer corrected a frame later.
 */
const theme = useTheme();
const { isDark } = useColorScheme();

watch(isDark, (dark) => void theme.change(dark ? "dark" : "light"), { immediate: true });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
