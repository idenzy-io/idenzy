<script setup lang="ts">
/**
 * The first choice of an import: where the file comes from. Each source is a card that
 * says how its export is obtained and what happens to its passwords, because that
 * second line is the thing an operator is worried about and the thing that differs
 * most between them. A radio group in behaviour, cards in appearance.
 */
import { FORMAT_LABELS, type ImportSource, SOURCES } from "~/utils/import";

const source = defineModel<ImportSource | null>({ required: true });
</script>

<template>
  <div aria-label="Source" class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup">
    <button
      v-for="entry in SOURCES"
      :key="entry.id"
      :aria-checked="source === entry.id"
      :class="
        source === entry.id
          ? 'border-primary bg-primary/4 ring-1 ring-primary'
          : 'border-line hover:border-ink/25 hover:bg-ink/2'
      "
      class="flex flex-col gap-3 rounded-(--idenzy-radius) border p-4 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      role="radio"
      type="button"
      @click="source = entry.id"
    >
      <span class="flex items-center gap-3">
        <span class="flex size-9 flex-none items-center justify-center text-ink">
          <Icon
            :class="[entry.monochrome ? '[.v-theme--dark_&]:invert' : '', entry.tint ?? '']"
            :name="entry.icon"
            aria-hidden="true"
            class="text-[28px]"
          />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate text-sm font-medium text-ink">{{ entry.label }}</span>
          <span class="flex flex-wrap gap-1">
            <span
              v-for="format in entry.formats"
              :key="format"
              class="rounded-full border border-line px-1.5 font-mono text-[10px] leading-4 text-ink/55"
            >
              {{ FORMAT_LABELS[format] }}
            </span>
          </span>
        </span>
        <span
          :class="source === entry.id ? 'border-primary bg-primary' : 'border-ink/25'"
          aria-hidden="true"
          class="ml-auto flex size-4 flex-none items-center justify-center rounded-full border transition-colors duration-150"
        >
          <span v-if="source === entry.id" class="size-1.5 rounded-full bg-on-primary" />
        </span>
      </span>

      <span class="text-xs leading-5 text-ink/60">{{ entry.how }}</span>

      <span class="flex items-start gap-1.5 text-[11px] leading-4 text-ink/60">
        <Icon
          :class="entry.hash === null ? 'text-warning' : 'text-success'"
          :name="entry.hash === null ? 'material-symbols:key-off-outline' : 'material-symbols:key-outline'"
          aria-hidden="true"
          class="mt-px flex-none text-sm"
        />
        <span>{{ entry.passwords }}</span>
      </span>
    </button>
  </div>
</template>
