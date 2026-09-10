<script lang="ts">
export interface Step {
  id: string;
  label: string;
}
</script>

<script setup lang="ts">
/**
 * Where a multi-step form is: the steps in order, the one the reader is on, the ones
 * behind them ticked. A step behind is a button, because going back to change a choice
 * is the whole reason to show the list; a step ahead is not, because it depends on
 * what the current one has not yet said.
 */
const props = defineProps<{
  steps: readonly Step[];
  current: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const at = computed(() => props.steps.findIndex((step) => step.id === props.current));

function stateOf(index: number): "done" | "current" | "ahead" {
  if (index < at.value) return "done";
  return index === at.value ? "current" : "ahead";
}
</script>

<template>
  <ol aria-label="Steps" class="m-0 flex list-none items-center gap-2 p-0 text-xs">
    <li v-for="(step, index) in steps" :key="step.id" class="flex min-w-0 items-center gap-2">
      <component
        :is="stateOf(index) === 'done' ? 'button' : 'span'"
        :aria-current="stateOf(index) === 'current' ? 'step' : undefined"
        :class="[
          stateOf(index) === 'current' ? 'text-ink' : '',
          stateOf(index) === 'done' ? 'text-ink/70 hover:text-ink' : '',
          stateOf(index) === 'ahead' ? 'text-ink/40' : '',
        ]"
        :type="stateOf(index) === 'done' ? 'button' : undefined"
        class="inline-flex items-center gap-2 rounded-(--idenzy-radius-x-small) py-0.5 pr-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        @click="stateOf(index) === 'done' && emit('select', step.id)"
      >
        <span
          :class="[
            stateOf(index) === 'current' ? 'border-primary bg-primary text-on-primary' : '',
            stateOf(index) === 'done' ? 'border-ink/20 bg-ink/6 text-ink' : '',
            stateOf(index) === 'ahead' ? 'border-line text-ink/45' : '',
          ]"
          aria-hidden="true"
          class="flex size-5 flex-none items-center justify-center rounded-full border font-mono text-[10px] leading-none tabular-nums"
        >
          <Icon v-if="stateOf(index) === 'done'" class="text-xs" name="material-symbols:check" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <span class="truncate font-medium">{{ step.label }}</span>
      </component>
      <span
        v-if="index < steps.length - 1"
        :class="stateOf(index) === 'done' ? 'bg-ink/25' : 'bg-line'"
        aria-hidden="true"
        class="h-px w-6 flex-none sm:w-10"
      />
    </li>
  </ol>
</template>
