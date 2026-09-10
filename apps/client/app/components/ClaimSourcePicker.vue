<script setup lang="ts">
/**
 * Where one claim reads from: the source, and the field or key inside it.
 *
 * Two menus and a field rather than two selects, because a select is the wrong shape in
 * a row that has to read as a sentence: "email, from the profile's Email". The source
 * menu names the three places and marks the one that publishes; the field menu lists
 * exactly the nine claimable fields with what each is, so the allowlist is something the
 * reader sees rather than something they hit. A metadata key is typed, since it is theirs.
 */
import {
  type ClaimSource,
  isClaimableUserField,
  SOURCES,
  sourceInfo,
  USER_FIELDS,
  userFieldInfo,
} from "~/utils/claims";

const props = defineProps<{
  source: ClaimSource;
  path: string;
  /** The row's id, so the key field's label reaches it. */
  id: string;
  invalid?: boolean;
}>();

const emit = defineEmits<{
  /** A new source, and the path it starts with. */
  change: [source: ClaimSource, path: string];
  "update:path": [path: string];
}>();

const info = computed(() => sourceInfo(props.source));
const field = computed(() => (props.source === "user" ? userFieldInfo(props.path) : null));

/**
 * Switching source keeps a path that still makes sense and drops one that cannot: a
 * profile field name is not a metadata key anybody has, and a metadata key is not on
 * the allowlist.
 */
function choose(source: ClaimSource) {
  if (source === props.source) return;
  if (source === "user") {
    emit("change", source, isClaimableUserField(props.path) ? props.path : "email");
  } else if (props.source === "user") {
    emit("change", source, "");
  } else {
    emit("change", source, props.path);
  }
}
</script>

<template>
  <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
    <span class="text-[11px] text-ink/45">from</span>

    <button
      :class="info.publishes ? 'text-warning' : 'text-ink'"
      class="group inline-flex h-7 max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) border border-line bg-canvas px-2 text-xs font-medium transition-colors duration-150 hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      type="button"
    >
      <Icon :name="info.icon" aria-hidden="true" class="flex-none text-sm" />
      <span class="truncate">{{ info.label }}</span>
      <Icon
        aria-hidden="true"
        class="flex-none text-sm text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
        name="material-symbols:unfold-more"
      />
      <v-menu :offset="4" activator="parent" location="bottom start">
        <v-list density="compact" min-width="300" nav>
          <v-list-item
            v-for="option in SOURCES"
            :key="option.source"
            :active="option.source === source"
            :prepend-icon="option.icon"
            :subtitle="option.publishes ? 'Publishes what a browser could not see' : 'Already public'"
            :title="option.label"
            @click="choose(option.source)"
          />
        </v-list>
      </v-menu>
    </button>

    <template v-if="source === 'user'">
      <button
        :class="invalid ? 'border-error/60 text-error' : 'border-line text-ink'"
        class="group inline-flex h-7 max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) border bg-canvas px-2 text-xs transition-colors duration-150 hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        type="button"
      >
        <Icon
          v-if="field"
          :name="field.icon"
          aria-hidden="true"
          class="flex-none text-sm text-ink/60"
        />
        <span class="truncate font-mono text-[11px]">{{ field ? field.field : path || "field" }}</span>
        <Icon
          aria-hidden="true"
          class="flex-none text-sm text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
          name="material-symbols:unfold-more"
        />
        <v-menu :offset="4" activator="parent" location="bottom start">
          <v-list density="compact" min-width="320" nav>
            <v-list-item
              v-for="option in USER_FIELDS"
              :key="option.field"
              :active="option.field === path"
              :prepend-icon="option.icon"
              :subtitle="option.note"
              :title="option.label"
              @click="emit('update:path', option.field)"
            >
              <template #append>
                <span class="font-mono text-[10px] text-ink/45">{{ option.field }}</span>
              </template>
            </v-list-item>
          </v-list>
        </v-menu>
      </button>
    </template>

    <template v-else>
      <span class="flex items-center gap-1">
        <span class="font-mono text-[11px] text-ink/45">.</span>
        <v-text-field
          :id="`${id}-path`"
          :aria-label="`Key of ${info.label}`"
          :error="invalid"
          :model-value="path"
          autocomplete="off"
          class="claim-key font-mono"
          density="compact"
          hide-details
          placeholder="key"
          spellcheck="false"
          variant="filled"
          @update:model-value="emit('update:path', String($event))"
        />
      </span>
    </template>
  </span>
</template>

<style scoped>
/* A key is one word, so the field takes a word's width and not a row's. */
.claim-key {
  width: 9rem;
}

.claim-key :deep(.v-field__input) {
  font-size: 11px;
  min-height: 28px;
}
</style>
