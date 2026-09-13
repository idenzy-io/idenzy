<script setup lang="ts">
/**
 * Who is signed in, and the menu for the things that are about them rather than about
 * the project: their account, and the way out.
 *
 * At the foot of the drawer rather than the head, because the project is what the
 * screens depend on and the person is not: they change project a dozen times a day and
 * themselves never. The address is the user on `Session` from `@idenzy/js` and the way
 * out is the client's own `signOut` — both were placeholders until the panel held a
 * session, and it does now.
 *
 * The mark is initials from the address, because the panel has no picture to show and a
 * fetched one would be a third-party origin, which PROJECT.md 10.3 rules out here.
 */
defineProps<{
  /** Folded to the mark alone, with the address in a tooltip. */
  rail: boolean;
}>();

const user = useUser();
const idenzy = useIdenzy();

/**
 * The signed-in address, or a dash.
 *
 * Null has two causes and the tile cannot tell them apart: the session is still loading,
 * or the account has no address because it signed in some other way. Neither is worth
 * inventing a name for, and the placeholder that used to sit here read as a real person
 * — which is worse than reading as nothing.
 */
const email = computed(() => user.value?.email ?? "—");

/**
 * Two letters from the part before the `@`: the first of each of its first two words
 * when a separator splits it, otherwise its first two. `jane.doe` files as JD and
 * `hasan` as HA, which is what a person expects to see on a tile that stands for them.
 */
function initials(address: string): string {
  const local = address.split("@")[0] ?? address;
  const words = local.split(/[._+-]+/).filter((word) => word.length > 0);
  const letters =
    words.length >= 2 ? `${words[0]?.charAt(0)}${words[1]?.charAt(0)}` : local.slice(0, 2);
  return letters.toUpperCase();
}

/** The address, the password and the factors the signed-in person holds, none of which
    belongs to a project. A tab of the settings screen rather than a route of its own,
    so the three things a person changes sit together, and still a URL somebody can be
    linked to. */
function openAccount() {
  void navigateTo("/settings/account");
}

/**
 * End the session, then the sign-in screen.
 *
 * The navigation happens whatever the call did. A refusal here means the server did not
 * hear us, but the client has already dropped its tokens, so staying on a dashboard that
 * can no longer load anything would be the worse answer — and the one thing a person who
 * pressed this must not see is the application still behaving as though they had not.
 */
async function signOut() {
  try {
    await idenzy.signOut();
  } finally {
    await navigateTo("/auth/login");
  }
}
</script>

<template>
  <!-- The tile sits in a box the width of the rail, so folding the drawer moves nothing
       but the address. -->
  <button
    :aria-label="rail ? email : undefined"
    :class="rail ? 'justify-center' : ''"
    class="group flex h-10 w-full items-center overflow-hidden rounded-(--idenzy-radius) text-ink transition-[background-color,transform] hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98]"
    type="button"
  >
    <span class="flex size-10 flex-none items-center justify-center">
      <span
        aria-hidden="true"
        class="flex size-7 items-center justify-center rounded-lg border border-line bg-ink/4 text-[10px] font-semibold text-primary transition-colors group-hover:bg-ink/6"
      >
        {{ initials(email) }}
      </span>
    </span>

    <span v-if="!rail" class="min-w-0 flex-1 truncate pr-3 text-left text-[13px]">
      {{ email }}
    </span>

    <v-tooltip v-if="rail" :text="email" activator="parent" location="end" open-delay="300" />

    <v-menu :offset="6" activator="parent" location="top start">
      <v-list min-width="232" nav>
        <p class="truncate px-3 pt-1 pb-2 text-xs text-ink/60">{{ email }}</p>

        <v-list-item
          prepend-icon="material-symbols:person-outline"
          title="Account"
          @click="openAccount"
        />
        <v-list-item prepend-icon="material-symbols:logout" title="Sign out" @click="signOut" />
      </v-list>
    </v-menu>
  </button>
</template>
