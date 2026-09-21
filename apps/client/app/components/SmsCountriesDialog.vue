<script setup lang="ts">
/**
 * Chooses the countries a project will pay to send SMS to.
 *
 * A dialog rather than a control on the card, because this is the setting that decides
 * what the project spends money on and it is edited as a set: a reader adding three
 * markets wants to see the list, search it, and commit once. The card behind it shows
 * what is chosen; this is where choosing happens.
 *
 * Countries are listed by name and never by calling code. Twenty countries share +1, so a
 * picker organised by prefix would let somebody allow the United States and, without
 * seeing it, every Caribbean range on the same code, which is exactly where pumping
 * schemes live.
 *
 * The draft is local until it is saved, so a search that empties the list cannot look like
 * a selection that emptied it.
 */

import { countryFlag, countryName } from "~/utils/sessions";
import { allCountries } from "~/utils/sms-policy";

const props = defineProps<{
  /** The codes currently on the policy. */
  allowed: readonly string[];
  saving: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  save: [codes: string[]];
}>();

const COUNTRIES = allCountries((code) => countryName(code) ?? code);

const draft = ref<Set<string>>(new Set());
const query = ref("");

watch(open, (value) => {
  if (!value) return;
  draft.value = new Set(props.allowed);
  query.value = "";
});

const listed = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle === "") return COUNTRIES;
  return COUNTRIES.filter(
    (country) =>
      country.name.toLowerCase().includes(needle) || country.code.toLowerCase() === needle,
  );
});

function toggle(code: string) {
  const next = new Set(draft.value);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  draft.value = next;
}

const chosen = computed(() => draft.value.size);

const dirty = computed(() => {
  if (draft.value.size !== props.allowed.length) return true;
  return props.allowed.some((code) => !draft.value.has(code));
});

/* Clearing is offered because emptying the list is a real decision and the honest way to
   say "stop sending SMS", but it is never the default: the list starts empty already. */
function clear() {
  draft.value = new Set();
}

function submit() {
  if (!dirty.value || props.saving) return;
  emit("save", [...draft.value].sort());
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card border flat>
      <form class="flex max-h-[82vh] flex-col" @submit.prevent="submit">
        <header class="flex flex-col gap-3 border-b border-line px-5 py-4">
          <div class="flex flex-col gap-1">
            <h2 class="m-0 text-sm font-medium text-ink">Where this project may send</h2>
            <p class="m-0 text-xs leading-5 text-ink/60">
              A destination outside this list is refused before it costs anything. The list
              starts empty on purpose: pumping picks the destination, so the countries a
              product does not serve are exactly the ones an attacker sends to.
            </p>
          </div>
          <SearchField
            v-model="query"
            label="Search countries"
            placeholder="Search a country"
          />
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <ul v-if="listed.length > 0" class="m-0 list-none divide-y divide-line p-0">
            <li v-for="country in listed" :key="country.code">
              <label
                class="flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-ink/3"
              >
                <input
                  :checked="draft.has(country.code)"
                  class="size-3.5 flex-none accent-[rgb(var(--v-theme-primary))]"
                  type="checkbox"
                  @change="toggle(country.code)"
                />
                <span aria-hidden="true" class="w-5 flex-none text-sm">
                  {{ countryFlag(country.code) }}
                </span>
                <span class="min-w-0 flex-1 truncate text-xs text-ink">{{ country.name }}</span>
                <span class="flex-none font-mono text-[11px] text-ink/45">{{ country.code }}</span>
              </label>
            </li>
          </ul>
          <p v-else class="m-0 px-5 py-10 text-center text-xs text-ink/50">
            No country matches that.
          </p>
        </div>

        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
        >
          <div class="flex items-center gap-3">
            <span class="text-[11px] text-ink/55">
              {{ chosen === 1 ? "1 country" : `${chosen} countries` }}
            </span>
            <v-btn
              v-if="chosen > 0"
              class="text-xs font-medium"
              color="neutral"
              size="x-small"
              variant="text"
              @click="clear"
            >
              Clear
            </v-btn>
          </div>
          <div class="flex items-center gap-2">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Cancel
            </v-btn>
            <v-btn
              :disabled="!dirty || saving"
              :loading="saving"
              class="text-xs font-medium"
              color="primary"
              size="small"
              type="submit"
              variant="flat"
            >
              Save
            </v-btn>
          </div>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
</style>
