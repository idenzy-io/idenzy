<script setup lang="ts">
/**
 * The project the panel is showing, and the menu that changes it.
 *
 * Every screen behind the drawer is scoped to one project, so the switch sits above the
 * navigation rather than in the app bar: it is the first thing to read and the thing
 * every item under it depends on. The projects themselves live in the project store,
 * which the bar's breadcrumb reads too.
 *
 * The mark is an initial on the accent rather than a logo, because a project is a tenant
 * and not a brand: the panel holds no image for it, and a letter reads at twenty pixels
 * where a logo would not.
 *
 * Making one lives here too, under the list and behind a rule, because the question that
 * reaches for it is the one the list just failed to answer: the project wanted is not in
 * it. `ProjectCreateDialog` asks for the name and this component owns the write, so the
 * menu closes on a project rather than on a click.
 */
defineProps<{
  /** Folded to the mark alone, with the name in a tooltip. */
  rail: boolean;
}>();

const store = useProjectStore();

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

/**
 * The dialog, its wait and whatever the service refused it with.
 *
 * Local rather than the store's `refusal`, which the settings screen reads too: a delete
 * that failed there must not be the sentence this dialog opens carrying.
 */
const createOpen = ref(false);
const creating = ref(false);
const createError = ref("");

function create() {
  createError.value = "";
  createOpen.value = true;
}

/**
 * Closes on a project and not on the request finishing.
 *
 * Creating takes an admin and this menu offers the item to every role, so a refusal is the
 * ordinary outcome rather than the exceptional one; the dialog keeps the typed name and
 * says what the service said. On success the panel moves to it, because a project made from
 * the switcher is the one the reader means to work in, and a drawer still showing the old
 * name reads as a create that did not happen.
 */
async function confirmCreate(name: string) {
  createError.value = "";
  creating.value = true;
  const made = await store.create(name);
  creating.value = false;
  if (made === null) {
    createError.value = store.refusal ?? "";
    return;
  }
  store.select(made);
  createOpen.value = false;
}
</script>

<template>
  <!-- Padding and gap put the mark's centre twenty pixels in, on the same line as the
       glyphs in the list below it. Folded, the button is the rail's width and centres. -->
  <button
    :aria-label="rail ? `Project: ${store.current.name}` : undefined"
    :class="rail ? 'justify-center' : 'gap-2.5 px-2.5'"
    class="group flex h-9 w-full items-center overflow-hidden rounded-(--idenzy-radius-small) bg-ink/4 text-ink transition-[background-color,transform] hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.99]"
    type="button"
  >
    <span
      aria-hidden="true"
      class="flex size-5 flex-none items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-on-primary"
    >
      {{ initial(store.current.name) }}
    </span>

    <template v-if="!rail">
      <span class="min-w-0 flex-1 truncate text-left text-[13px] font-medium">
        {{ store.current.name }}
      </span>
      <Icon
        aria-hidden="true"
        class="flex-none text-base text-ink/50 transition-colors group-hover:text-ink/80"
        name="material-symbols:unfold-more"
      />
    </template>

    <v-tooltip v-if="rail" :text="store.current.name" activator="parent" location="end" open-delay="300" />

    <v-menu :offset="6" activator="parent" location="bottom start">
      <v-list min-width="232" nav>
        <v-list-item
          v-for="project in store.projects"
          :key="project.id"
          :active="project.id === store.current.id"
          :title="project.name"
          @click="store.select(project)"
        >
          <template #prepend>
            <span
              aria-hidden="true"
              class="flex size-5 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-on-primary"
            >
              {{ initial(project.name) }}
            </span>
          </template>
          <template v-if="project.id === store.current.id" #append>
            <Icon aria-hidden="true" class="text-base text-ink/70" name="material-symbols:check" />
          </template>
        </v-list-item>

        <v-divider class="my-1" />

        <v-list-item prepend-icon="material-symbols:add" title="Create project" @click="create" />
      </v-list>
    </v-menu>
  </button>

  <!-- A sibling of the button rather than a child of it, because a dialog is not part of
       the control that opens it; Vuetify teleports the overlay either way, and nesting one
       inside a `button` is markup the drawer would carry on every screen. -->
  <ProjectCreateDialog
    v-if="createOpen"
    v-model="createOpen"
    :busy="creating"
    :error="createError"
    :org="store.currentOrg.name"
    @confirm="confirmCreate"
  />
</template>
