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
 */
defineProps<{
  /** Folded to the mark alone, with the name in a tooltip. */
  rail: boolean;
}>();

const store = useProjectStore();

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

function create() {
  // POST /v1/projects through the management API, then select the answer.
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
</template>
