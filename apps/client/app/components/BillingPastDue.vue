<script setup lang="ts">
/**
 * A failed payment, as the one thing on the screen that wants doing now.
 *
 * A tint of the error colour with its repair beside it, in the step `InfoNote` takes for a
 * warning: a wash and a hairline ring rather than a solid ground, because a solid red
 * band shouts at a reader who has already seen the figure and the dot, and this is a
 * standing state they arrive at rather than an interruption. The error colour is kept for
 * the glyph and the action, which is where it says something. Laid out as a title over
 * its sentence, with the glyph in a tile, so it reads as a notice with a heading rather
 * than one more line of small text.
 *
 * It is shown on the overview and on the invoices tab, and it is one component so the two
 * never say different things about the same invoice.
 */
defineProps<{
  /** The repair, as `paymentRepair` writes it: which invoices, and how much. */
  repair: string;
}>();

defineEmits<{ settle: [] }>();
</script>

<template>
  <div
    class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-(--idenzy-radius) bg-error/6 px-4 py-3.5 ring-1 ring-error/20 ring-inset"
    role="status"
  >
    <div class="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        class="flex size-8 flex-none items-center justify-center rounded-(--idenzy-radius-x-small) bg-error/10 text-error"
      >
        <Icon class="text-lg" name="material-symbols:error-outline" />
      </span>
      <div class="flex min-w-0 flex-col gap-0.5">
        <p class="m-0 text-sm font-medium text-ink">Payment failed</p>
        <p class="m-0 text-xs leading-5 text-ink/65">{{ repair }}</p>
      </div>
    </div>

    <v-btn
      append-icon="material-symbols:open-in-new"
      class="flex-none text-xs font-medium"
      color="error"
      size="small"
      variant="outlined"
      @click="$emit('settle')"
    >
      Open billing portal
    </v-btn>
  </div>
</template>
