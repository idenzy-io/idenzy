<script lang="ts">
import type { LocaleStatus } from "~/utils/email-templates";

export interface LanguageEntry {
  locale: string;
  status: LocaleStatus;
}
</script>

<script setup lang="ts">
/**
 * The languages one message is written in, and the way to add another.
 *
 * A list rather than a select, because the state is the point: which language is sending,
 * which is still compiling and which has unpublished copy in it are three different
 * answers, and a select shows one name and hides the rest. This is also the only place a
 * reader can see that they have left a draft in a language they are not looking at.
 *
 * **Adding one is inline, and it seeds.** A dialog for a two-character field is a step
 * nobody needs, and a new language that opened on a blank page is a translator asked to
 * retype the markup. `Start from` is what makes it a translation job: the copy of another
 * language you already have, or our built-in.
 *
 * The form is a card form, so its field is `filled` and the picker beside it is a button
 * drawn like one: a tinted box with a rule along its foot. That is the panel's rule for
 * this position rather than a choice made here, and it is a different answer from a
 * dialog's or a toolbar's.
 *
 * **Which language is on is carried by a rail, not only by a tint.** A wash of the accent
 * is nearly invisible on the dark surface, and this column is two-letter tags in a narrow
 * card: the reader has to be able to tell which one the panes beside it belong to without
 * comparing two greys.
 */

import { DEFAULT_LOCALE, LOCALE_STATUS_LABELS, normalizeLocale } from "~/utils/email-templates";

const props = defineProps<{
  entries: readonly LanguageEntry[];
  current: string;
  /** Where a new language may be seeded from: languages that already have copy. */
  sources: readonly string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [locale: string];
  add: [locale: string, from: string | null];
}>();

const TONES: Record<LocaleStatus, string> = {
  draft: "bg-warning",
  compiling: "bg-warning/50",
  active: "bg-success",
  none: "bg-ink/25",
};

const tagId = `${useId()}-language-tag`;
const fromId = `${useId()}-language-from`;

const adding = ref(false);
const tag = ref("");
const from = ref<string>("");
const field = useTemplateRef<{ focus: () => void }>("field");

const fromOptions = computed(() => [
  { value: "", label: "Built-in copy" },
  ...props.sources.map((locale) => ({ value: locale, label: `Copy of ${locale}` })),
]);

const issue = computed(() => {
  const value = tag.value.trim();
  if (value === "") return "";
  const normalized = normalizeLocale(value);
  if (normalized === null) return "A language tag looks like en, tr or pt-BR.";
  if (props.entries.some((entry) => entry.locale === normalized)) {
    return `${normalized} is already on the list.`;
  }
  return "";
});

const fromLabel = computed(
  () => fromOptions.value.find((option) => option.value === from.value)?.label ?? "Built-in copy",
);

const canAdd = computed(() => tag.value.trim() !== "" && issue.value === "");

function start() {
  adding.value = true;
  tag.value = "";
  from.value = props.sources.includes(props.current) ? props.current : "";
  void nextTick(() => field.value?.focus());
}

function cancel() {
  adding.value = false;
  tag.value = "";
}

function submit() {
  const normalized = normalizeLocale(tag.value);
  if (normalized === null || !canAdd.value) return;
  emit("add", normalized, from.value === "" ? null : from.value);
  adding.value = false;
  tag.value = "";
}
</script>

<template>
  <div class="flex flex-col">
    <ul aria-label="Languages" class="m-0 flex list-none flex-col p-0">
      <li v-for="entry in entries" :key="entry.locale">
        <button
          :aria-current="entry.locale === current ? 'true' : undefined"
          :class="
            entry.locale === current
              ? 'bg-primary/12 text-ink'
              : 'text-ink/65 hover:bg-ink/6 hover:text-ink'
          "
          :disabled="disabled"
          class="relative flex min-h-9 w-full cursor-pointer appearance-none items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-default"
          type="button"
          @click="emit('select', entry.locale)"
        >
          <!-- The rail is what makes the choice legible. A wash of the accent alone is
               nearly invisible on the dark surface, and this column is two-letter tags in
               a narrow card: the reader has to be able to see which one the panes beside
               it belong to without comparing two greys. -->
          <span
            v-if="entry.locale === current"
            aria-hidden="true"
            class="absolute inset-y-0 left-0 w-[3px] bg-primary"
          />
          <span
            :class="TONES[entry.status]"
            aria-hidden="true"
            class="size-1.5 flex-none rounded-full"
          />
          <span
            :class="entry.locale === current ? 'font-semibold' : 'font-medium'"
            class="min-w-0 flex-1 truncate font-mono text-xs"
          >
            {{ entry.locale }}
            <span v-if="entry.locale === DEFAULT_LOCALE" class="font-normal text-ink/40">
              · default
            </span>
          </span>
          <span
            :class="entry.locale === current ? 'text-ink/70' : 'text-ink/45'"
            class="flex-none text-[10px] leading-4"
          >
            {{ LOCALE_STATUS_LABELS[entry.status] }}
          </span>
        </button>
      </li>
    </ul>

    <!-- The add form takes the button's place rather than opening beside it, so the card
         does not change height twice for one action. -->
    <div class="border-t border-line p-2">
      <div v-if="adding" class="flex flex-col gap-3 p-1">
        <div class="flex flex-col gap-1">
          <label :for="tagId" class="text-xs font-medium text-ink">Language tag</label>
          <v-text-field
            :id="tagId"
            ref="field"
            v-model="tag"
            :error="issue !== ''"
            autocomplete="off"
            class="font-mono"
            hide-details
            placeholder="pt-BR"
            spellcheck="false"
            variant="filled"
            @keydown.enter.prevent="submit"
            @keydown.esc="cancel"
          />
          <p :class="issue ? 'text-error' : 'text-ink/50'" class="m-0 text-[11px] leading-4">
            {{ issue || "A language or a language and region: en, tr, pt-BR." }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label :for="fromId" class="text-xs font-medium text-ink">Start from</label>
          <!-- Drawn like the filled field above it: a tinted box with a rule along its
               foot, so a list and a line of text read as the same kind of control. -->
          <button
            :id="fromId"
            aria-haspopup="menu"
            class="group flex h-9 w-full items-center justify-between gap-2 rounded-t-(--idenzy-radius) border-b border-ink/25 bg-ink/5 px-3 text-left text-sm text-ink transition-colors duration-150 hover:border-ink/45 hover:bg-ink/8 focus-visible:border-primary focus-visible:outline-none"
            type="button"
          >
            <span class="min-w-0 truncate">{{ fromLabel }}</span>
            <Icon
              aria-hidden="true"
              class="flex-none text-base text-ink/45 transition-colors duration-150 group-hover:text-ink/80"
              name="material-symbols:unfold-more"
            />
            <v-menu :offset="6" activator="parent" location="bottom center">
              <v-list density="compact" nav width="240">
                <v-list-item
                  v-for="option in fromOptions"
                  :key="option.value"
                  :active="option.value === from"
                  :title="option.label"
                  @click="from = option.value"
                />
              </v-list>
            </v-menu>
          </button>
          <p class="m-0 text-[11px] leading-4 text-ink/50">
            The copy the new language opens on. Nothing is published by adding it.
          </p>
        </div>

        <div class="flex items-center justify-end gap-1">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="cancel"
          >
            Cancel
          </v-btn>
          <v-btn
            :disabled="!canAdd"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="submit"
          >
            Add language
          </v-btn>
        </div>
      </div>

      <v-btn
        v-else
        :disabled="disabled"
        block
        class="text-xs font-medium"
        color="neutral"
        prepend-icon="material-symbols:add"
        size="small"
        variant="text"
        @click="start"
      >
        Add a language
      </v-btn>
    </div>
  </div>
</template>
