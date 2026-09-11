<script setup lang="ts">
/**
 * The menu at the end of a key's row.
 *
 * Rotate lives here and nowhere else, so a rotation is always something somebody started on
 * one key rather than something the screen inferred from two (notes/keys.md). It is offered
 * only on a key that is in no rotation already: rotating either half of an unfinished one
 * would leave three live keys and nobody sure which is current.
 *
 * Revoke is two items. The ordinary one reviews the key's consumers first; the compromised
 * one is the urgent path, revoke first and deploy second, and it is set apart because the
 * two are opposite procedures that happen to end in the same write.
 *
 * There is no "copy the key" and no "reveal": only a digest was kept, so what can be copied
 * is the prefix a log names it by and the id the audit trail does.
 */
import { isLive, keyName, type ProjectApiKey } from "~/utils/keys";

const props = defineProps<{
  keyRow: ProjectApiKey;
  /** Already one half of an unfinished rotation. */
  rotating: boolean;
}>();

const emit = defineEmits<{
  view: [];
  rotate: [];
  "copy-prefix": [];
  "copy-id": [];
  revoke: [];
  compromised: [];
}>();

const live = computed(() => isLive(props.keyRow));
</script>

<template>
  <v-menu :offset="4" location="bottom end">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        :aria-label="`Actions for ${keyName(keyRow)}`"
        class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
      </button>
    </template>

    <v-list density="compact" min-width="260" nav>
      <v-list-item
        prepend-icon="material-symbols:history"
        subtitle="Last observation and who made it"
        title="View observed use"
        @click="emit('view')"
      />
      <v-list-item
        v-if="live"
        :disabled="rotating"
        :subtitle="rotating ? 'Already in a rotation' : 'Replace it without downtime'"
        prepend-icon="material-symbols:swap-horiz"
        title="Rotate"
        @click="emit('rotate')"
      />

      <v-divider class="my-1" />
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
          prepend-icon="material-symbols:block"
          subtitle="After checking what still uses it"
          title="Revoke"
          @click="emit('revoke')"
        />
        <v-list-item
          class="key-actions__danger"
          prepend-icon="material-symbols:bolt"
          subtitle="Compromised: revoke first, deploy after"
          title="Revoke now"
          @click="emit('compromised')"
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
