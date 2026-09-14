<script setup lang="ts">
/**
 * The one funding control, with its reason for being unavailable beside it.
 *
 * Shown disabled rather than hidden where the deployment takes no payments: a billing screen
 * with no way to add money reads as a fault in the page, and a disabled button whose
 * refusal is only discoverable by hovering is a puzzle, so the reason is in a tooltip and
 * said again in the note at the top of every screen that carries this.
 *
 * One component rather than the same span, tooltip and button on two tabs, because the
 * reason text and the disabled rule must not drift between the overview and the wallet.
 */
import { PAYMENTS_UNAVAILABLE } from "~/utils/billing";

/* Whether a card can be charged is the server's answer about this deployment, so it is
   read from the store rather than from a constant this file used to hold. */
const billing = useBillingStore();

defineEmits<{ click: [] }>();
</script>

<template>
  <v-tooltip
    :disabled="billing.running"
    :text="PAYMENTS_UNAVAILABLE"
    location="bottom"
    max-width="320"
  >
    <template #activator="{ props: tip }">
      <span v-bind="tip">
        <FancyButton :disabled="!billing.running" @click="$emit('click')">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add credit
        </FancyButton>
      </span>
    </template>
  </v-tooltip>
</template>
