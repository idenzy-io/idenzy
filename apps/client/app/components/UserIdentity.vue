<script setup lang="ts">
/**
 * The cell a row is recognised by: a picture or initials, the name, and the address
 * under it. Two lines rather than two columns because a reader scans for a person and
 * finds one by whichever of the two they remember.
 *
 * A tombstone has none of these, on purpose (PROJECT.md 4.13.6), so it says so rather
 * than showing an empty cell that looks like a bug. The verified mark sits on the
 * address and not the name, because it is the address that was verified.
 *
 * `below` is for what a narrow screen has to keep beside the person when the columns that
 * carry it have scrolled away.
 */
import { initialsOf, nameOf, type ProjectUser } from "~/utils/users";

const props = defineProps<{
  user: ProjectUser;
}>();

const deleted = computed(() => props.user.deletedAt !== null);
const handle = computed(() => props.user.email ?? props.user.phone);
/* The name line falls back to the address, so the address is not said twice. */
const secondary = computed(() => (props.user.displayName && handle.value ? handle.value : null));
</script>

<template>
  <div class="flex min-w-0 items-center gap-2.5">
    <span
      :class="deleted ? 'border border-dashed border-line text-ink/35' : 'bg-ink/6 text-ink/70'"
      aria-hidden="true"
      class="flex size-7 flex-none items-center justify-center overflow-hidden rounded-full text-[11px] font-medium"
    >
      <img
        v-if="user.avatarUrl && !deleted"
        :src="user.avatarUrl"
        alt=""
        class="size-full object-cover"
      />
      <Icon v-else-if="deleted" class="text-sm" name="material-symbols:person-off-outline" />
      <template v-else>{{ initialsOf(user) }}</template>
    </span>

    <div class="flex min-w-0 flex-col gap-px leading-4">
      <!-- The underline is the whole of the hover where this cell is a link: a wash over
           the row reads as a second selected state next to the checkbox. Inert wherever
           no `group/user` sits above it, which is every screen that only lists people. -->
      <span
        :class="deleted ? 'text-ink/45 italic' : 'text-ink'"
        class="truncate text-xs font-medium decoration-ink/40 underline-offset-2 group-hover/user:underline"
      >
        {{ deleted ? "Deleted user" : nameOf(user) }}
      </span>
      <span v-if="deleted" class="truncate text-[11px] text-ink/45">Personal data erased</span>
      <span
        v-else-if="secondary"
        class="inline-flex min-w-0 items-center gap-1 text-[11px] text-ink/55"
      >
        <span class="truncate">{{ secondary }}</span>
        <Icon
          v-if="user.email && user.emailVerified"
          aria-label="Verified"
          class="flex-none text-[13px] text-success"
          name="material-symbols:verified-outline"
          role="img"
        />
        <Icon
          v-else-if="user.email"
          aria-label="Unverified"
          class="flex-none text-[13px] text-ink/35"
          name="material-symbols:mail-outline"
          role="img"
        />
      </span>
      <slot name="below" />
    </div>
  </div>
</template>
