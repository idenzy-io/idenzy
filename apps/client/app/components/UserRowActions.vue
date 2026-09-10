<script setup lang="ts">
/**
 * The menu at the end of a user's row. It offers only what the row can take: a tombstone
 * has an id to copy and nothing else, an active account can be suspended and a suspended
 * one restored, and signing out everywhere is offered only where there is a session to
 * end. The destructive item is last and set apart, and every item hands the decision up
 * to the page, which owns the dialogs and the store.
 */
import type { ProjectUser, UserStatus } from "~/utils/users";

const props = defineProps<{
  user: ProjectUser;
  status: UserStatus;
}>();

const emit = defineEmits<{
  "copy-id": [];
  "copy-email": [];
  suspend: [];
  restore: [];
  "sign-out": [];
  remove: [];
}>();

const deleted = computed(() => props.status === "deleted");
</script>

<template>
  <v-menu :offset="4" location="bottom end">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        :aria-label="`Actions for ${user.displayName ?? user.email ?? user.id}`"
        class="row-actions__trigger inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
      </button>
    </template>

    <v-list density="compact" min-width="208" nav>
      <!-- The same destination the identity opens, so a keyboard reaching the menu does
           not have to go back for the link. -->
      <v-list-item
        :to="`/users/${user.id}`"
        prepend-icon="material-symbols:person-search-outline"
        title="Open this user"
      />
      <v-divider class="my-1" />
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

      <template v-if="!deleted">
        <v-divider class="my-1" />
        <v-list-item
          v-if="status === 'active'"
          prepend-icon="material-symbols:block"
          title="Suspend"
          @click="emit('suspend')"
        />
        <v-list-item
          v-else
          prepend-icon="material-symbols:lock-open-outline"
          title="Lift suspension"
          @click="emit('restore')"
        />
        <v-list-item
          :disabled="user.activeSessions === 0"
          prepend-icon="material-symbols:logout"
          title="Sign out everywhere"
          @click="emit('sign-out')"
        />

        <v-divider class="my-1" />
        <v-list-item
          class="row-actions__danger"
          prepend-icon="material-symbols:delete-outline"
          title="Delete user"
          @click="emit('remove')"
        />
      </template>
    </v-list>
  </v-menu>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.row-actions__danger,
.v-list--nav .v-list-item.row-actions__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
