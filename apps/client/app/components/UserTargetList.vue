<script setup lang="ts">
/**
 * Exactly who a confirmation is about. One account is named in the heading and needs no
 * list; several are listed here, because "3 users" is not a scope somebody can check and
 * a bulk action taken over a filter is where the wrong row gets picked up.
 *
 * A long selection is not printed in full: the first few, then a count of the rest, which
 * is honest about the scope without turning a dialog into a page.
 */
import { initialsOf, nameOf, type ProjectUser } from "~/utils/users";

const props = withDefaults(
  defineProps<{
    users: readonly ProjectUser[];
    /** How many are written out before the rest become a count. */
    limit?: number;
  }>(),
  { limit: 5 },
);

const shown = computed(() => props.users.slice(0, props.limit));
const rest = computed(() => Math.max(0, props.users.length - props.limit));
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded-(--idenzy-radius) bg-ink/4 px-3 py-2.5 ring-1 ring-ink/6 ring-inset"
  >
    <span class="text-[11px] font-medium text-ink/70">
      <span class="font-mono tabular-nums">{{ users.length }}</span>
      {{ users.length === 1 ? "account" : "accounts" }} selected
    </span>
    <ul class="m-0 flex list-none flex-col gap-1 p-0">
      <li
        v-for="user in shown"
        :key="user.id"
        class="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 text-[11px] leading-4"
      >
        <span
          aria-hidden="true"
          class="flex size-5 items-center justify-center rounded-full bg-ink/8 text-[9px] font-medium text-ink/70"
        >
          {{ initialsOf(user) }}
        </span>
        <span class="flex min-w-0 items-baseline gap-1.5">
          <span class="truncate text-ink">{{ nameOf(user) }}</span>
          <span class="truncate font-mono text-[10px] text-ink/40">{{ user.id }}</span>
        </span>
      </li>
    </ul>
    <span v-if="rest > 0" class="text-[11px] text-ink/45">
      and <span class="font-mono tabular-nums">{{ rest }}</span> more
    </span>
  </div>
</template>
