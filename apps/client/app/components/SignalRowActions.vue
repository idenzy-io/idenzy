<script setup lang="ts">
/**
 * The menu at the end of a signal's row: what somebody can honestly do about a piece of
 * evidence.
 *
 * Two of the three are bookkeeping. Acknowledging says a person read it, dismissing says
 * they read it and it was nothing, and the dialog asks which nothing so the audit entry
 * is worth reading later. Neither changes anything about the account.
 *
 * The third is the one real action, and it is signing the account's sessions out. It is
 * here because it is the honest answer to a credential that may be known: it ends every
 * live session and costs the owner one sign-in. Suspending is deliberately not offered.
 * A suspension is a decision about a person and belongs on the screen that lists people,
 * and taking it from a row that says "this password is also somebody else's" is exactly
 * the reading this whole screen argues against.
 *
 * A signal with no account behind it has neither: a list being tried against forty
 * addresses is about the address, and there is nobody here to sign out.
 */
import { kindOf, type SecuritySignal } from "~/utils/security";

const props = defineProps<{
  signal: SecuritySignal;
  /** The person the evidence names, for the labels. Absent where it names nobody. */
  person: string | null;
  sessions: number;
}>();

const emit = defineEmits<{
  open: [];
  acknowledge: [];
  reopen: [];
  dismiss: [];
  "sign-out": [];
  "copy-id": [];
  "copy-user": [];
}>();

const label = computed(() => props.person ?? kindOf(props.signal).replace(/_/g, " "));
const decided = computed(() => props.signal.state !== "open");
</script>

<template>
  <v-menu :offset="4" location="bottom end">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        :aria-label="`Actions for this ${label} signal`"
        class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
      </button>
    </template>

    <v-list density="compact" min-width="248" nav>
      <!-- The same thing clicking the row does, for a reader who came to the menu first. -->
      <v-list-item
        prepend-icon="material-symbols:frame-inspect"
        title="Open signal"
        @click="emit('open')"
      />
      <v-divider class="my-1" />
      <v-list-item
        v-if="!decided"
        prepend-icon="material-symbols:check"
        subtitle="Read, and left on the record"
        title="Acknowledge"
        @click="emit('acknowledge')"
      />
      <v-list-item
        v-else
        prepend-icon="material-symbols:undo"
        subtitle="Back onto the open list"
        title="Reopen"
        @click="emit('reopen')"
      />
      <v-list-item
        v-if="signal.state !== 'dismissed'"
        prepend-icon="material-symbols:visibility-off-outline"
        subtitle="Say what it turned out to be"
        title="Dismiss…"
        @click="emit('dismiss')"
      />

      <template v-if="signal.userId">
        <v-divider class="my-1" />
        <v-list-item
          :disabled="sessions === 0"
          :subtitle="
            sessions === 0
              ? 'Nothing live to end'
              : `${sessions} live ${sessions === 1 ? 'session' : 'sessions'}`
          "
          class="signal-actions__danger"
          prepend-icon="material-symbols:logout"
          title="Sign out every session"
          @click="emit('sign-out')"
        />
      </template>

      <v-divider class="my-1" />
      <v-list-item
        prepend-icon="material-symbols:content-copy-outline"
        title="Copy signal ID"
        @click="emit('copy-id')"
      />
      <v-list-item
        v-if="signal.userId"
        prepend-icon="material-symbols:person-outline"
        title="Copy user ID"
        @click="emit('copy-user')"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.signal-actions__danger:not(.v-list-item--disabled),
.v-list--nav .v-list-item.signal-actions__danger:not(.v-list-item--disabled):hover {
  color: rgb(var(--v-theme-error));
}
</style>
