<script setup lang="ts">
/**
 * The cell a session row is recognised by: a glyph, the device's name, and what its user
 * agent will admit to underneath.
 *
 * The glyph carries two parsed facts and no third: its shape is the form, its colour the
 * platform. Both restate the line below rather than adding to it, so a reader who cannot
 * tell the colours apart loses nothing, and a client we could not place is drawn in the
 * muted ink with no colour at all. It sits bare rather than on a tile, because a tile
 * behind every row is furniture and the mark is doing the work.
 *
 * The two lines carry different weights of evidence and the cell says so. The name is
 * the client's own, or plainly missing; the line under it is parsed, so it is written in
 * the muted ink and the whole string is one hover away. Nothing here invents a name from
 * a user agent, which is the rule the server keeps for the same reason: on a security
 * screen a confident guess is worse than a blank.
 *
 * The key mark is a bound refresh token (PROJECT.md 4.4), which is a property of the
 * device rather than of the sign-in, so it sits here rather than beside the methods.
 */
import {
  agentLine,
  describeAgent,
  deviceLabel,
  FORM_ICONS,
  FORM_LABELS,
  platformTone,
  type SessionRow,
} from "~/utils/sessions";

const props = defineProps<{
  session: SessionRow;
}>();

const agent = computed(() => describeAgent(props.session.userAgent));
const named = computed(() => props.session.deviceName !== null);
</script>

<template>
  <div class="flex min-w-0 items-center gap-2.5">
    <v-tooltip :text="FORM_LABELS[agent.form]" location="top">
      <template #activator="{ props: tip }">
        <span
          v-bind="tip"
          :aria-label="FORM_LABELS[agent.form]"
          :class="platformTone(agent.os)"
          class="flex size-5 flex-none items-center justify-center"
          role="img"
        >
          <Icon :name="FORM_ICONS[agent.form]" aria-hidden="true" class="text-base" />
        </span>
      </template>
    </v-tooltip>

    <div class="flex min-w-0 flex-col gap-px leading-4">
      <span class="flex min-w-0 items-center gap-1">
        <span
          :class="named ? 'text-ink' : 'text-ink/45 italic'"
          class="truncate text-xs font-medium"
        >
          {{ deviceLabel(session) }}
        </span>
        <v-tooltip
          v-if="session.deviceBound"
          location="top"
          text="Refresh token bound to a device key"
        >
          <template #activator="{ props: tip }">
            <Icon
              v-bind="tip"
              aria-label="Device-bound"
              class="flex-none text-[13px] text-success"
              name="material-symbols:key-outline"
              role="img"
            />
          </template>
        </v-tooltip>
      </span>

      <v-tooltip
        :disabled="session.userAgent === null"
        :text="session.userAgent ?? ''"
        location="bottom start"
        max-width="420"
      >
        <template #activator="{ props: tip }">
          <span v-bind="tip" class="truncate text-[11px] text-ink/55">
            {{ session.userAgent === null ? "No user agent sent" : agentLine(agent) }}
          </span>
        </template>
      </v-tooltip>
    </div>
  </div>
</template>
