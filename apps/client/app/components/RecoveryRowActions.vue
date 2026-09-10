<script setup lang="ts">
/**
 * The menu at the end of a sheet's row. It offers what an operator can honestly do to
 * somebody else's recovery codes, which is take the ids away with them and clear the
 * sheet. Generating one is not here, and the clear dialog says why.
 *
 * The clear item is off for an account that holds no sheet, because there is nothing to
 * delete and an item that succeeds silently having done nothing reads as a bug.
 */
import type { ProjectUser } from "~/utils/users";

const props = defineProps<{
  user: ProjectUser;
  remaining: number;
  hasSheet: boolean;
}>();

const emit = defineEmits<{
  "copy-id": [];
  "copy-email": [];
  clear: [];
}>();

const label = computed(() => props.user.displayName ?? props.user.email ?? props.user.id);
</script>

<template>
  <v-menu :offset="4" location="bottom end">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        :aria-label="`Actions for ${label}`"
        class="recovery-actions__trigger inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
      </button>
    </template>

    <v-list density="compact" min-width="216" nav>
      <v-list-item
        prepend-icon="material-symbols:content-copy-outline"
        title="Copy user ID"
        @click="emit('copy-id')"
      />
      <v-list-item
        v-if="user.email"
        prepend-icon="material-symbols:alternate-email"
        title="Copy email"
        @click="emit('copy-email')"
      />

      <v-divider class="my-1" />
      <v-list-item
        :disabled="!hasSheet"
        :subtitle="hasSheet ? `${remaining} unspent` : 'Nothing to clear'"
        class="recovery-actions__danger"
        prepend-icon="material-symbols:key-off-outline"
        title="Clear the sheet"
        @click="emit('clear')"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.recovery-actions__danger:not(.v-list-item--disabled),
.v-list--nav .v-list-item.recovery-actions__danger:not(.v-list-item--disabled):hover {
  color: rgb(var(--v-theme-error));
}
</style>
