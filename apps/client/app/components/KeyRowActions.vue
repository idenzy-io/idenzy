<script setup lang="ts">
/**
 * The menu at the end of a key's row. Two things to take away and one thing to do.
 *
 * There is no "copy the key" and no "reveal", and their absence is the row's whole story:
 * only a digest was kept, so what can be copied is the prefix that identifies the key and the
 * id an audit entry names it by. A menu item that offered the value would be offering
 * something the database does not have.
 *
 * A revoked key keeps the copy items, because matching an old log line to a row is exactly
 * what a revoked row is still for.
 */
import { isLive, KEY_KIND_LABELS, type ProjectApiKey } from "~/utils/keys";

const props = defineProps<{
  keyRow: ProjectApiKey;
}>();

const emit = defineEmits<{
  "copy-prefix": [];
  "copy-id": [];
  revoke: [];
}>();

const live = computed(() => isLive(props.keyRow));
</script>

<template>
  <v-menu :offset="4" location="bottom end">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        :aria-label="`Actions for ${KEY_KIND_LABELS[keyRow.kind]} ${keyRow.prefix}`"
        class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
      </button>
    </template>

    <v-list density="compact" min-width="240" nav>
      <v-list-item
        prepend-icon="material-symbols:content-copy-outline"
        subtitle="What names this key in a log"
        title="Copy prefix"
        @click="emit('copy-prefix')"
      />
      <v-list-item
        prepend-icon="material-symbols:tag"
        subtitle="What the audit trail calls it"
        title="Copy key ID"
        @click="emit('copy-id')"
      />

      <template v-if="live">
        <v-divider class="my-1" />
        <v-list-item
          class="key-actions__danger"
          prepend-icon="material-symbols:block"
          subtitle="Stops working on the next request"
          title="Revoke"
          @click="emit('revoke')"
        />
      </template>
    </v-list>
  </v-menu>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.key-actions__danger,
.v-list--nav .v-list-item.key-actions__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
