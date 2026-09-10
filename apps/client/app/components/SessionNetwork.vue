<script setup lang="ts">
/**
 * What the address the session came from resolves to: one label for the strongest signal,
 * with the rest on the tooltip.
 *
 * Three things this cell will not do. It does not draw "Unchecked" as though it were
 * "Direct", because a lookup that did not answer says nothing about the address and the
 * reassurance would be invented. It does not tint a VPN or a proxy as a problem, because
 * a great many people reach the internet through one and a column that cried wolf would
 * be read as decoration by the end of the first page. And Tor is the one it does mark,
 * because it is the signal worth a second look.
 *
 * The flags themselves are what the filter reads, so narrowing to VPN still finds an
 * address that is a VPN and a Tor exit both. This is only the label.
 */
import {
  isNetworkConcern,
  NETWORK_ICONS,
  NETWORK_LABELS,
  type NetworkIntel,
  networkFlags,
  networkSignal,
} from "~/utils/sessions";

const props = defineProps<{
  network: NetworkIntel | null;
}>();

const signal = computed(() => networkSignal(props.network));
const flags = computed(() => networkFlags(props.network));

/* The tooltip earns its place only where it says more than the label does. */
const detail = computed(() => {
  if (props.network === null) return "No IP intelligence answered for this address";
  if (flags.value.length === 0) return "No anonymising network detected";
  return flags.value.map((flag) => NETWORK_LABELS[flag]).join(" · ");
});
</script>

<template>
  <v-tooltip :text="detail" location="top">
    <template #activator="{ props: tip }">
      <span
        v-bind="tip"
        :class="
          isNetworkConcern(signal)
            ? 'text-warning'
            : signal === 'direct' || signal === 'unchecked'
              ? 'text-ink/40'
              : 'text-ink/80'
        "
        class="inline-flex max-w-full items-center gap-1 text-xs"
      >
        <Icon :name="NETWORK_ICONS[signal]" aria-hidden="true" class="flex-none text-sm" />
        <span :class="signal === 'unchecked' ? 'italic' : ''" class="truncate">
          {{ NETWORK_LABELS[signal] }}
        </span>
        <!-- A second flag exists and the label named only the first. -->
        <span v-if="flags.length > 1" class="flex-none font-mono text-[10px] text-ink/45">
          +{{ flags.length - 1 }}
        </span>
      </span>
    </template>
  </v-tooltip>
</template>
