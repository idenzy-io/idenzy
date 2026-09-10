<script setup lang="ts">
/**
 * Where the address places the session: the flag, then the country's name.
 *
 * The name is what the cell says and the flag is what makes it findable, which is the
 * order they matter in. It is decoration and marked as such, so a screen reader hears
 * "Japan" once rather than twice and Windows, which ships no flag glyphs, falls back to
 * the two letters of the code and loses only the picture. The code itself moves to the
 * tooltip: it is what the column sorts and filters on, and it is one hover away.
 *
 * A Tor circuit exits wherever it exits, so on those rows this is the exit node and not
 * the person. That is said rather than left to be assumed, because a country read as a
 * location is exactly the wrong conclusion to draw about somebody using Tor.
 */
import {
  countryFlag,
  countryIsExitOnly,
  countryName,
  countryOf,
  type NetworkIntel,
} from "~/utils/sessions";

const props = defineProps<{
  network: NetworkIntel | null;
}>();

const code = computed(() => countryOf(props.network));
const name = computed(() => countryName(code.value));
const flag = computed(() => countryFlag(code.value));
const exitOnly = computed(() => countryIsExitOnly(props.network));

const detail = computed(() => {
  const stem = `${name.value} · ${code.value}`;
  return exitOnly.value ? `${stem} · Tor exit node, not the person's location` : stem;
});
</script>

<template>
  <v-tooltip v-if="code" :text="detail" location="top">
    <template #activator="{ props: tip }">
      <span v-bind="tip" class="inline-flex max-w-full items-center gap-1.5 text-xs">
        <!-- Fixed width so the names line up down the column whether the flag drew as a
             flag, as two letter tiles, or as nothing at all. -->
        <span
          v-if="flag"
          aria-hidden="true"
          class="w-5 flex-none overflow-hidden text-sm leading-none whitespace-nowrap"
        >
          {{ flag }}
        </span>
        <span :class="exitOnly ? 'text-ink/45 italic' : 'text-ink/85'" class="truncate">
          {{ name }}
        </span>
      </span>
    </template>
  </v-tooltip>
  <span v-else class="text-ink/30">–</span>
</template>
