<script setup lang="ts">
/**
 * The passwordless column: one button per identity provider, then the emailed link.
 *
 * Shared by sign-in and sign-up because a provider button does the same thing on both
 * screens, creating the account on first use and signing in after. Only the wording of
 * the link button differs, which is why that is the one prop.
 */
defineProps<{
  /** What the emailed-link button says. The endpoint behind it is the same either way. */
  linkLabel: string;
}>();

const emit = defineEmits<{
  provider: [id: string];
  link: [];
}>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- The icon is positioned rather than prepended so every label sits on the same
         centre line: a prepended icon is part of the content and shifts the text by its
         own width, which reads as five buttons that do not quite line up. -->
    <v-btn
      v-for="provider in AUTH_PROVIDERS"
      :key="provider.id"
      class="relative justify-center"
      color="neutral"
      variant="outlined"
      @click="emit('provider', provider.id)"
    >
      <Icon
        :class="provider.monochrome ? '[.v-theme--dark_&]:invert' : ''"
        :name="provider.icon"
        class="absolute start-4 text-xl"
      />
      <span class="text-sm font-medium">Continue with {{ provider.label }}</span>
    </v-btn>

    <v-btn class="relative justify-center" color="neutral" variant="outlined" @click="emit('link')">
      <Icon class="absolute start-4 text-xl" name="material-symbols:link" />
      <span class="text-sm font-medium">{{ linkLabel }}</span>
    </v-btn>
  </div>
</template>
