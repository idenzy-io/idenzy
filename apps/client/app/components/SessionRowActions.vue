<script setup lang="ts">
/**
 * The menu at the end of a session's row. It offers only what the row can take: a
 * session that has already ended has identifiers to copy and nothing to revoke.
 *
 * The two narrowing items are what make this a screen for investigating rather than
 * reading. Given one suspicious device, the questions that follow are "what else is this
 * account signed in on" and "what else has come from this machine", and both are one
 * click rather than a search term typed out by hand.
 */
import { countryName, type SessionRow } from "~/utils/sessions";

const props = defineProps<{
  session: SessionRow;
  revocable: boolean;
  /** ISO alpha-2, where the address could be placed. */
  country: string | null;
}>();

const emit = defineEmits<{
  "copy-id": [];
  "copy-ip": [];
  "copy-user": [];
  "only-user": [];
  "only-device": [];
  "only-country": [];
  revoke: [];
}>();

const deviceId = computed(() => props.session.deviceId);
</script>

<template>
  <v-menu :offset="4" location="bottom end">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        :aria-label="`Actions for session ${session.id}`"
        class="row-actions__trigger inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
      </button>
    </template>

    <v-list density="compact" min-width="224" nav>
      <v-list-item
        prepend-icon="material-symbols:content-copy-outline"
        title="Copy session ID"
        @click="emit('copy-id')"
      />
      <v-list-item
        prepend-icon="material-symbols:person-outline"
        title="Copy user ID"
        @click="emit('copy-user')"
      />
      <v-list-item
        v-if="session.ip"
        prepend-icon="material-symbols:language"
        title="Copy IP address"
        @click="emit('copy-ip')"
      />

      <v-divider class="my-1" />
      <v-list-item
        prepend-icon="material-symbols:filter-alt-outline"
        title="Only this user"
        @click="emit('only-user')"
      />
      <v-list-item
        v-if="deviceId"
        prepend-icon="material-symbols:devices-other-outline-rounded"
        title="Only this device"
        @click="emit('only-device')"
      />
      <v-list-item
        v-if="country"
        :title="`Only ${countryName(country)}`"
        prepend-icon="material-symbols:public"
        @click="emit('only-country')"
      />

      <template v-if="revocable">
        <v-divider class="my-1" />
        <v-list-item
          class="row-actions__danger"
          prepend-icon="material-symbols:logout"
          title="Revoke session"
          @click="emit('revoke')"
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
