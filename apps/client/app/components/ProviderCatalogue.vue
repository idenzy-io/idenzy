<script setup lang="ts">
/**
 * Every provider this deployment implements, as cards to pick from. The ones already set
 * up are left out, because this grid is the way in and a provider that has one is
 * configured from its own row above.
 *
 * Each card carries the one fact that changes what a project gets: whether the provider
 * asserts the address it hands over is verified. That is what decides whether a sign-in
 * can join an account somebody already has (PROJECT.md 4.6), and it is better read here,
 * before the credentials are pasted, than discovered when a user reports that signing in
 * with Twitch made them a second account.
 *
 * The generic OIDC connector is shown and cannot be picked. Leaving it out entirely reads
 * as "not supported"; showing it grey says "not yet", which is the truth.
 */
import { ASSERTION_LOOK, PROVIDERS, type ProviderName } from "~/utils/providers";

const props = defineProps<{
  /** Already configured, so not on offer here. */
  hidden: readonly ProviderName[];
}>();

const emit = defineEmits<{
  select: [id: ProviderName];
}>();

const offered = computed(() => PROVIDERS.filter((provider) => !props.hidden.includes(provider.id)));
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
    <component
      :is="provider.available ? 'button' : 'div'"
      v-for="provider in offered"
      :key="provider.id"
      :class="
        provider.available
          ? 'border-line hover:border-ink/25 hover:bg-ink/2'
          : 'border-dashed border-line opacity-55'
      "
      :type="provider.available ? 'button' : undefined"
      class="group flex flex-col gap-2.5 rounded-(--idenzy-radius) border p-3.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      @click="provider.available && emit('select', provider.id)"
    >
      <span class="flex items-center gap-3">
        <span class="flex size-8 flex-none items-center justify-center text-ink">
          <Icon
            :class="[provider.monochrome ? '[.v-theme--dark_&]:invert' : '', provider.tint ?? '']"
            :name="provider.icon"
            aria-hidden="true"
            class="text-[26px]"
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-sm font-medium text-ink">{{ provider.label }}</span>
          <span class="text-[11px] leading-4 text-ink/50">
            {{ provider.protocol === "oidc" ? "OpenID Connect" : "OAuth 2.0" }}
          </span>
        </span>
        <span
          v-if="provider.available"
          aria-hidden="true"
          class="inline-flex size-6 flex-none items-center justify-center rounded-full text-ink/35 transition-colors duration-150 group-hover:bg-ink/8 group-hover:text-ink"
        >
          <Icon class="text-base" name="material-symbols:add" />
        </span>
        <span
          v-else
          class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
        >
          Phase 4
        </span>
      </span>

      <span class="flex items-start gap-1.5 text-[11px] leading-4 text-ink/60">
        <Icon
          :class="ASSERTION_LOOK[provider.email].tone"
          :name="ASSERTION_LOOK[provider.email].icon"
          aria-hidden="true"
          class="mt-px flex-none text-sm"
        />
        <span>
          <span class="font-medium text-ink/75">{{ ASSERTION_LOOK[provider.email].label }}.</span>
          {{ provider.emailNote }}
        </span>
      </span>
    </component>
  </div>
</template>
