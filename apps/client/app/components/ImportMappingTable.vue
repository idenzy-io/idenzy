<script setup lang="ts">
/**
 * Which column of the file is which field of ours, one row per field. The guess from
 * `inferMapping` is filled in and every row can be changed, with a value from the first
 * record beside it so the operator can see they picked the column they meant rather
 * than the one with a similar name. A field left unmapped is simply not imported; the
 * two that matter, email and phone, are marked because one of them has to be.
 */
import { FIELDS, type Field, type ImportRecord, type Mapping } from "~/utils/import";

const props = defineProps<{
  keys: readonly string[];
  records: readonly ImportRecord[];
}>();

const mapping = defineModel<Mapping>({ required: true });

function set(field: Field, column: string | null) {
  const next = { ...mapping.value };
  if (column === null) delete next[field];
  else next[field] = column;
  mapping.value = next;
}

/** The first record with something in the column, so a sparse column still shows. */
function sample(column: string | undefined): string {
  if (column === undefined) return "";
  for (const record of props.records.slice(0, 20)) {
    const value = record[column];
    if (value === null || value === undefined || value === "") continue;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  }
  return "";
}

const IDENTIFIERS: readonly Field[] = ["email", "phone"];
</script>

<template>
  <div class="overflow-hidden rounded-(--idenzy-radius) border border-line">
    <table class="w-full border-separate border-spacing-0 text-xs">
      <thead>
        <tr class="bg-ink/3 text-left text-ink/60">
          <th class="h-9 px-3 font-medium" scope="col">Field</th>
          <th class="h-9 px-3 font-medium" scope="col">Column in the file</th>
          <th class="h-9 px-3 font-medium" scope="col">First value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="field in FIELDS" :key="field.key" class="group">
          <th class="border-t border-line px-3 py-2 text-left align-top font-normal" scope="row">
            <span class="flex flex-col gap-0.5">
              <span class="font-medium text-ink">
                {{ field.label }}
                <span v-if="IDENTIFIERS.includes(field.key)" class="text-[10px] text-ink/45">
                  · one needed
                </span>
              </span>
              <span v-if="field.hint" class="text-[11px] text-ink/50">{{ field.hint }}</span>
            </span>
          </th>
          <td class="border-t border-line px-3 py-2 align-top">
            <v-menu :offset="4" location="bottom start">
              <template #activator="{ props: activator }">
                <button
                  v-bind="activator"
                  :class="mapping[field.key] ? 'text-ink' : 'text-ink/45'"
                  class="inline-flex h-7 max-w-full items-center gap-1 rounded-(--idenzy-radius-x-small) border border-line bg-surface px-2 font-mono text-[11px] transition-colors duration-150 hover:border-ink/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  type="button"
                >
                  <span class="truncate">{{ mapping[field.key] ?? "Not mapped" }}</span>
                  <Icon aria-hidden="true" class="flex-none text-sm" name="material-symbols:unfold-more" />
                </button>
              </template>
              <v-list class="max-h-72 overflow-y-auto" density="compact" min-width="220" nav>
                <v-list-item
                  :active="mapping[field.key] === undefined"
                  title="Not mapped"
                  @click="set(field.key, null)"
                />
                <v-divider class="my-1" />
                <v-list-item
                  v-for="key in keys"
                  :key="key"
                  :active="mapping[field.key] === key"
                  :title="key"
                  class="font-mono"
                  @click="set(field.key, key)"
                />
              </v-list>
            </v-menu>
          </td>
          <td class="border-t border-line px-3 py-2 align-top">
            <span class="block max-w-64 truncate font-mono text-[11px] text-ink/60">
              {{ sample(mapping[field.key]) || "–" }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
