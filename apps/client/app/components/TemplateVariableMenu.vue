<script setup lang="ts">
/**
 * The variables this message carries, and a way to put one at the cursor.
 *
 * A menu beside the field being typed in rather than a list in a side panel, because
 * inserting is the action and reading the list is the thing done on the way to it. The
 * editor completes these as they are typed as well; this is for the reader who does not
 * yet know there is a list.
 *
 * Each row carries what the variable holds, because `link` and `otp` are self-explanatory
 * and `expires_in` is not: the difference between a count of seconds and "10 minutes" is
 * the whole of that variable's behaviour, and it belongs where somebody is choosing it.
 */

import { type TemplateVariable, VARIABLE_HELP } from "~/utils/email-templates";

const props = defineProps<{
  variables: readonly TemplateVariable[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  insert: [text: string];
}>();

const open = ref(false);

/*
 * The placeholder is written here rather than in the template. Vue's own interpolation is
 * the same two braces, so a template literal containing them in an expression is read as a
 * mustache that never closes and the build fails outright.
 */
const rows = computed(() =>
  props.variables.map((name) => ({
    name,
    token: `{{ ${name} }}`,
    summary: VARIABLE_HELP[name]?.summary ?? "",
  })),
);

function insert(name: TemplateVariable) {
  open.value = false;
  emit("insert", `{{ ${name} }}`);
}
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom end" offset="6">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        :disabled="disabled"
        class="text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:data-object"
        size="small"
        variant="text"
      >
        Insert variable
      </v-btn>
    </template>

    <v-card border class="overflow-hidden" flat max-width="340">
      <ul aria-label="Variables in scope" class="m-0 flex list-none flex-col p-0">
        <li v-for="row in rows" :key="row.name">
          <button
            class="flex w-full cursor-pointer appearance-none flex-col gap-0.5 border-0 bg-transparent px-3 py-2 text-left transition-colors duration-150 hover:bg-ink/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            type="button"
            @click="insert(row.name)"
          >
            <span class="font-mono text-[11px] leading-4 font-medium text-primary">
              {{ row.token }}
            </span>
            <span class="text-[11px] leading-4 text-ink/60">{{ row.summary }}</span>
          </button>
        </li>
      </ul>
      <p class="m-0 border-t border-line bg-canvas/60 px-3 py-2 text-[10px] leading-4 text-ink/50">
        This is the whole list for this message. A name outside it fails the send rather
        than leaving a gap, so the editor marks it as you type.
      </p>
    </v-card>
  </v-menu>
</template>
