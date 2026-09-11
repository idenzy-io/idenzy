<script setup lang="ts">
/**
 * Where a key of one kind goes, framework by framework, as the variable to copy.
 *
 * The variable is what is copied and never a line with a value in it: the panel holds only a
 * key's prefix, and a copy button that put `pk_4fQ2x9a…` on the clipboard would be copying a
 * shortened value nobody can use (notes/layout-blueprint.md, rule 7). The value itself was
 * shown once, in the reveal.
 *
 * The browser list is the one the starter templates write, and it carries no secret key: a
 * test holds `PLACEMENTS` to that, which is the note's acceptance check.
 */
import { type ApiKeyKind, KEY_KIND_PREFIXES, PLACEMENTS, PUBLIC_PREFIXES } from "~/utils/keys";

const props = defineProps<{
  kind: ApiKeyKind;
  /** A live key's prefix, shown beside each name so a reader can match it to their file. */
  prefix?: string;
}>();

const shown = computed(() => `${props.prefix ?? KEY_KIND_PREFIXES[props.kind]}…`);
</script>

<template>
  <div class="flex flex-col gap-3">
    <ul class="m-0 list-none divide-y divide-line overflow-hidden rounded-(--idenzy-radius) border border-line bg-surface p-0">
      <li
        v-for="placement in PLACEMENTS[kind]"
        :key="placement.id"
        class="grid items-center gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
      >
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-xs font-medium text-ink">{{ placement.label }}</span>
          <span class="text-[11px] leading-4 text-ink/50">{{ placement.where }}</span>
        </span>
        <span class="flex min-w-0 items-center gap-2">
          <CopyField
            :label="`Copy ${placement.name}`"
            :value="placement.name"
            class="min-w-0 flex-1"
            dense
          />
          <span class="hidden flex-none font-mono text-[11px] text-ink/45 md:inline">
            = {{ shown }}
          </span>
        </span>
      </li>
    </ul>

    <p v-if="kind === 'secret'" class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/60">
      <Icon
        aria-hidden="true"
        class="mt-0.5 flex-none text-sm text-warning"
        name="material-symbols:warning-outline"
      />
      <span>
        Never under a public prefix ({{ PUBLIC_PREFIXES.join(", ") }}): a browser bundle
        publishes whatever it is built with, and nothing unpublishes it afterwards. Our
        scaffolder refuses to write this one for that reason.
      </span>
    </p>
    <p v-else class="m-0 flex items-start gap-2 text-xs leading-5 text-ink/60">
      <Icon
        aria-hidden="true"
        class="mt-0.5 flex-none text-sm text-success"
        name="material-symbols:check-circle-outline"
      />
      <span>
        Safe to ship: it names the project and authorises nothing. The header it travels on
        takes a <span class="font-mono">pk_</span> and nothing else, so a secret key pasted in
        here by mistake is refused before any lookup.
      </span>
    </p>
  </div>
</template>
