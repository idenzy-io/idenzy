<script setup lang="ts">
/**
 * Whose session this is, on one line.
 *
 * Deliberately not `UserIdentity`, which stacks the name over the address: there the
 * person is the subject of the row, here the device is, and a second two-line block
 * beside the first would give the row two things to read first. The address goes in the
 * tooltip instead, which is where a support agent looks to confirm they have the right
 * account.
 */

import type { SessionUser } from "~/utils/sessions";
import { initialsOf, nameOf } from "~/utils/users";

const props = defineProps<{
  user: SessionUser;
}>();

const label = computed(() => props.user.email ?? props.user.id);
</script>

<template>
  <v-tooltip :text="label" location="top start">
    <template #activator="{ props: tip }">
      <span v-bind="tip" class="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          class="flex size-5 flex-none items-center justify-center overflow-hidden rounded-full bg-ink/6 text-[9px] font-medium text-ink/70"
        >
          <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" class="size-full object-cover" />
          <template v-else>{{ initialsOf(user) }}</template>
        </span>
        <span class="truncate text-xs text-ink/85">{{ nameOf(user) }}</span>
      </span>
    </template>
  </v-tooltip>
</template>
