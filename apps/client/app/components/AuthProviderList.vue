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
  <!-- 11px between buttons, which is not on Tailwind's scale and is not meant to be: it
       is the reference's own rhythm for a 55px button, and rounding it to 8 or 12 changes
       how tight the column reads more than a three-pixel change has any right to. -->
  <div class="flex flex-col gap-[11px]">
    <!-- The mark is a flex item at the start and the label takes the rest of the row, so
         every label centres in the same leftover width and the five line up with each
         other. Sizing and the row's full width are in theme.css, on the variant, because
         `.v-btn__content` is Vuetify's element and a template cannot reach it.

         `primary` rather than the `neutral` these carried, because on the signed-out
         shell primary is the ink token (theme.css): the border and the label are then the
         one near-black the form's own button is drawn in, and the pair flips together on
         the dark theme. Neutral is a step lighter and was the column quietly disagreeing
         with the button above it. -->
    <v-btn
      v-for="provider in AUTH_PROVIDERS"
      :key="provider.id"
      block
      color="primary"
      variant="outlined"
      @click="emit('provider', provider.id)"
    >
      <Icon
        :class="provider.monochrome ? '[.v-theme--dark_&]:invert' : ''"
        :name="provider.icon"
        class="auth-mark shrink-0"
      />
      <span class="flex-1 text-center">Continue with {{ provider.label }}</span>
    </v-btn>

    <v-btn block color="primary" variant="outlined" @click="emit('link')">
      <Icon class="auth-mark shrink-0" name="material-symbols:link" />
      <span class="flex-1 text-center">{{ linkLabel }}</span>
    </v-btn>
  </div>
</template>
