<script setup lang="ts">
/**
 * The one funding control, with its reason for being unavailable beside it.
 *
 * Shown disabled rather than hidden while `PAYMENTS.running` is false: a billing screen
 * with no way to add money reads as a fault in the page, and a disabled button whose
 * refusal is only discoverable by hovering is a puzzle, so the reason is in a tooltip and
 * said again in the note at the top of every screen that carries this.
 *
 * One component rather than the same span, tooltip and button on two tabs, because the
 * reason text and the disabled rule must not drift between the overview and the wallet.
 */
import { PAYMENTS } from "~/utils/billing";

defineEmits<{ click: [] }>();
</script>

<template>
  <v-tooltip :disabled="PAYMENTS.running" :text="PAYMENTS.reason" location="bottom" max-width="320">
    <template #activator="{ props: tip }">
      <span v-bind="tip">
        <FancyButton :disabled="!PAYMENTS.running" @click="$emit('click')">
          <Icon aria-hidden="true" class="text-sm" name="material-symbols:add" />
          Add credit
        </FancyButton>
      </span>
    </template>
  </v-tooltip>
</template>
