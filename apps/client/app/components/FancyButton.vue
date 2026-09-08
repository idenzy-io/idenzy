<script setup lang="ts">
/**
 * The button for the one thing on a screen that is meant to be pressed more than
 * anything else, and looks it: the accent, a hairline of light along its upper edge, and
 * a wash of white over its top half that brightens under the pointer. Everything else
 * keeps the flat button, because a surface with two of these on it has none.
 *
 * The ground is `primary-sharp` rather than `primary`: deeper and more saturated, because
 * the wash brings it back up, and at the accent's own value the lit button reads as pale
 * beside the flat one.
 *
 * A bare button rather than `v-btn`, because both layers are pseudo-elements and `v-btn`
 * already spends `::after` on its focus ring. The layers are in the style block below
 * rather than in utilities: a masked gradient border is one idea, and spelling it as
 * nine arbitrary-value classes turns it into nine.
 */
defineProps<{
  disabled?: boolean;
}>();
</script>

<template>
  <button
    :disabled="disabled"
    class="fancy relative inline-flex h-8 items-center justify-center gap-2 rounded-(--idenzy-radius-small) px-3 text-xs font-medium whitespace-nowrap text-on-primary transition duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98] disabled:pointer-events-none disabled:bg-ink/6 disabled:text-ink/26"
    type="button"
  >
    <slot />
  </button>
</template>

<style scoped>
/*
 * The ground, then a hairline shadow to sit it on the page and a ring in the ground's
 * own colour to keep the edge crisp where the wash meets the surface.
 */
.fancy {
  --fancy-ground: rgb(var(--v-theme-primary-sharp));

  background: var(--fancy-ground);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.32),
    0 0 0 1px var(--fancy-ground);
}

/*
 * The hairline: a gradient painted over the whole button, then masked to its outermost
 * pixel. Two masks, one clipped to the padding box and one to the border box, excluded
 * from each other, leave exactly the one-pixel ring between them.
 */
.fancy::before {
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.12), transparent);
  border-radius: inherit;
  content: "";
  inset: 0;
  mask-clip: content-box, border-box;
  mask-composite: exclude;
  mask-image: linear-gradient(#fff 0 0), linear-gradient(#fff 0 0);
  padding: 1px;
  pointer-events: none;
  position: absolute;
  z-index: 1;
}

/* The wash: white fading downward, faint at rest and a shade stronger under the pointer,
   which is what makes the button look lit rather than merely coloured. */
.fancy::after {
  background: linear-gradient(to bottom, #fff, transparent);
  border-radius: inherit;
  content: "";
  inset: 0;
  opacity: 0.16;
  pointer-events: none;
  position: absolute;
  transition: opacity 200ms ease-out;
}

.fancy:hover::after {
  opacity: 0.24;
}

/* Disabled is grey and flat: the light is what says "press me", so it goes with it. */
.fancy:disabled {
  box-shadow: none;
}

.fancy:disabled::before,
.fancy:disabled::after {
  display: none;
}
</style>
