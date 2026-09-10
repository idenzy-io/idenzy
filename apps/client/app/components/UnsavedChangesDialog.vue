<script setup lang="ts">
/**
 * The question a screen with a draft asks when the reader leaves it: keep editing, or let
 * the draft go. Staying is the safe answer and the default; discarding is a plain button
 * in the error colour, because it is the one that loses work.
 */
const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  discard: [];
}>();

function discard() {
  emit("discard");
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="400">
    <v-card border flat>
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Leave without saving?</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            The template has changes that are not saved. Tokens keep carrying what was last
            saved until they are.
          </p>
        </header>
        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Keep editing
          </v-btn>
          <v-btn class="text-xs font-medium" color="error" size="small" variant="flat" @click="discard">
            Discard changes
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>
