<script setup lang="ts">
/**
 * What an audit entry is about, drawn as a tag in the category's own colour.
 *
 * The colour is the chart slot the category is assigned in `CATEGORY_SLOTS`, because
 * those six are the panel's only categorical palette checked pair by pair for separation
 * under colour-vision deficiency. The word carries the meaning and the colour is a mark
 * on top of it, so a reader who cannot tell two hues apart loses nothing.
 *
 * The tag itself is `Tag`, which every coloured value on the page draws through.
 */
import { type AuditCategory, CATEGORY_LABELS, CATEGORY_SLOTS } from "~/utils/audit";

defineProps<{ category: AuditCategory }>();
</script>

<template>
  <Tag :label="CATEGORY_LABELS[category]" :tone="CATEGORY_SLOTS[category]" />
</template>
