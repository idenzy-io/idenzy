<script setup lang="ts">
/**
 * Where a hook runs: the request's own steps as a rail, with that hook marked (notes/hooks.md,
 * "Selected hook: where it runs in the request").
 *
 * Evenly spaced columns from `sm` up, so the seven steps of a sign-in fit the dialog at any
 * width rather than wrapping a step onto a line of its own; a vertical rail below it. The order
 * is the content: a second factor is proved before any hook runs, so a before-sign-in hook is
 * never handed a half-signed-in user, and the two that send run on the dispatcher after the
 * request that asked for the message has been answered. Other hook points are outlined, dashed
 * where they are not enabled.
 */
import {
  HOOK_ICONS,
  HOOK_PLACEMENT,
  type HookConfig,
  type HookType,
  type PipelineStage,
  stagesFor,
} from "~/utils/hooks";

const props = defineProps<{
  type: HookType;
  hooks: readonly HookConfig[];
}>();

const stages = computed(() => stagesFor(props.type));
const enabled = computed(
  () => new Set(props.hooks.filter((hook) => hook.enabled).map((hook) => hook.type)),
);

/** Ours a dot, this hook solid, another hook outlined. Each covers the rail behind it. */
function nodeClass(stage: PipelineStage): string {
  if (stage.hook === props.type) {
    return "size-7 rounded-(--idenzy-radius-x-small) bg-primary text-white";
  }
  if (stage.hook === undefined) return "size-2.5 rounded-full bg-ink/30";
  return enabled.value.has(stage.hook)
    ? "size-7 rounded-(--idenzy-radius-x-small) border border-ink/30 bg-surface text-ink/70"
    : "size-7 rounded-(--idenzy-radius-x-small) border border-dashed border-ink/25 bg-surface text-ink/45";
}

function labelClass(stage: PipelineStage): string {
  if (stage.hook === props.type) return "font-medium text-primary";
  return stage.hook === undefined ? "text-ink/70" : "text-ink/50";
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <ol aria-label="Where it runs" class="m-0 grid list-none p-0 sm:auto-cols-fr sm:grid-flow-col">
      <li
        v-for="(stage, index) in stages"
        :key="stage.id"
        :aria-current="stage.hook === type ? 'step' : undefined"
        class="relative flex items-start gap-3 pb-3 last:pb-0 sm:flex-col sm:items-center sm:gap-1.5 sm:pb-0 sm:text-center"
      >
        <!-- The rail to the next step, from this mark's centre to the next one's. -->
        <span
          v-if="index < stages.length - 1"
          aria-hidden="true"
          class="absolute top-3.5 -bottom-3.5 left-3.5 w-px bg-ink/15 sm:bottom-auto sm:left-1/2 sm:h-px sm:w-full"
        />
        <span class="relative flex size-7 flex-none items-center justify-center">
          <span :class="nodeClass(stage)" class="flex items-center justify-center">
            <Icon v-if="stage.hook" :name="HOOK_ICONS[stage.hook]" aria-hidden="true" class="text-sm" />
          </span>
        </span>
        <span :class="labelClass(stage)" class="pt-1.5 text-[11px] leading-4 sm:px-1 sm:pt-0">
          {{ stage.label }}
        </span>
      </li>
    </ol>
    <p class="m-0 text-xs leading-5 text-ink/60">{{ HOOK_PLACEMENT[type] }}</p>
  </div>
</template>
