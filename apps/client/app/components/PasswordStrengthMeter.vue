<script setup lang="ts">
/**
 * Four segments and a checklist, shown from the moment the field exists rather than on the
 * first keystroke: what makes a good password is worth reading before typing one, and a
 * block that appears mid-form pushes the rest of it down as you go.
 *
 * The list is in two parts, and that is the point. Only the length is a rule the server
 * enforces (PROJECT.md 4.5 sets no composition requirements), so it is the only thing
 * under "Required"; the rest is advice and says so. One list headed "must contain"
 * announced a policy nothing checks, which is how a project ends up with a screen
 * demanding a capital letter and a server that does not care.
 */
const props = defineProps<{ password: string }>();

const strength = computed(() => measurePasswordStrength(props.password));

/**
 * Vuetify writes a custom property for every theme colour, so the name can be assembled at
 * runtime. Icon names cannot: those are resolved by a build-time scan, which is why the two
 * below are written out in full.
 */
const strengthColor = computed(() => `rgb(var(--v-theme-${strength.value.color}))`);

const segments = [1, 2, 3, 4];

/*
 * The list is split rather than headed "must contain", which announced a policy the
 * server does not have: the only thing it enforces is the length, and everything else
 * here is advice. A form that lists advice as a requirement teaches people to read
 * requirements as advice.
 */
const required = computed(() => strength.value.requirements.filter((rule) => rule.required));
const suggested = computed(() => strength.value.requirements.filter((rule) => !rule.required));
</script>

<template>
  <div class="flex flex-col gap-1.5 pt-1">
    <div class="flex items-center gap-1.5">
      <!-- One bar per step rather than one bar with a percentage: segments read as a
           rating, and a continuous bar invites the question of what 63% means.
           The empty track is on-surface at a tenth, so it stays a hairline in both themes
           rather than the solid block a full-strength neutral would draw. -->
      <v-progress-linear
        v-for="segment in segments"
        :key="segment"
        :aria-hidden="true"
        :bg-opacity="0.1"
        :color="strength.color"
        :model-value="strength.score >= segment ? 100 : 0"
        bg-color="on-surface"
        height="3"
        rounded
      />
    </div>

    <p class="mt-1 text-xs opacity-60">Required</p>

    <ul class="flex list-none flex-col gap-1 ps-0">
      <li
        v-for="requirement in required"
        :key="requirement.id"
        :class="requirement.met ? '' : 'opacity-60'"
        class="flex items-center gap-1.5 text-xs"
      >
        <Icon
          :name="requirement.met ? 'lucide:circle-check' : 'lucide:circle'"
          :style="requirement.met ? { color: 'rgb(var(--v-theme-success))' } : undefined"
          class="shrink-0 text-sm"
        />
        <span>{{ requirement.label }}</span>
      </li>
    </ul>

    <p class="mt-1 text-xs opacity-60">Stronger with</p>

    <ul class="flex list-none flex-col gap-1 ps-0">
      <li
        v-for="requirement in suggested"
        :key="requirement.id"
        :class="requirement.met ? '' : 'opacity-60'"
        class="flex items-center gap-1.5 text-xs"
      >
        <Icon
          :name="requirement.met ? 'lucide:circle-check' : 'lucide:circle'"
          :style="requirement.met ? { color: 'rgb(var(--v-theme-success))' } : undefined"
          class="shrink-0 text-sm"
        />
        <span>{{ requirement.label }}</span>
      </li>
    </ul>
  </div>
</template>
