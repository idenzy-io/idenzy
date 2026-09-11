<script setup lang="ts">
/**
 * One domain's setup, as a dialog: the four steps, its DNS records and the two actions
 * that move it along.
 *
 * A dialog rather than a block on the page, the way the revocation setup opens: the list
 * is what the screen is about, and a block under it pushed delivery off the fold and left
 * a reader scrolling back up to change which domain they were reading. What the note asks
 * for is that the records are worked through with a DNS console open, and a capped dialog
 * that scrolls its own records does that without the page moving underneath it.
 *
 * Below `lg` it is a full-height sheet, which is the note's mobile arrangement. It holds
 * no second layout for that: `SendingDomainSetup` is a flex column with `flex-none` ends
 * and a scrolling middle, so it fills a phone and sits inside a cap unchanged.
 */
import type { SendingDomain } from "~/utils/sending-domains";

defineProps<{
  domain: SendingDomain | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  check: [];
  use: [];
  remove: [];
}>();

const { lgAndUp } = useDisplay();

const titleId = `${useId()}-title`;
</script>

<template>
  <!-- `width` as well as `max-width`: a cap alone lets the dialog size itself to its
       narrowest record and rewrap around every other one. -->
  <v-dialog
    v-model="open"
    :aria-labelledby="titleId"
    :fullscreen="!lgAndUp"
    :max-width="lgAndUp ? 1040 : undefined"
    :transition="lgAndUp ? undefined : 'dialog-bottom-transition'"
    scrollable
    width="100%"
  >
    <v-card v-if="domain" border flat>
      <div :class="lgAndUp ? 'max-h-[86vh]' : 'h-full'" class="flex flex-col">
        <SendingDomainSetup
          :busy="busy"
          :domain="domain"
          :title-id="titleId"
          @check="emit('check')"
          @close="open = false"
          @remove="emit('remove')"
          @use="emit('use')"
        />
      </div>
    </v-card>
  </v-dialog>
</template>
