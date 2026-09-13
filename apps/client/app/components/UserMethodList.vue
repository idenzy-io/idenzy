<script setup lang="ts">
/**
 * How one account can sign in, and whether any of it still works.
 *
 * A method on the account and a method the project allows are different facts, and only
 * the pair answers the question this page is opened with. An account holding an SMS code
 * on a project whose SMS policy allows no country looks perfectly healthy in a methods
 * column and cannot sign in at all, so each row carries the project's answer beside the
 * account's and names the screen that changes it.
 *
 * Laid out as a settings list, name left and state right on hairlines, because that is
 * what it is: a list of switches somebody else set. The columns are fixed and the glyph
 * sits centred in a box of its own, since the provider marks are not one width and a row
 * that started at the logo's edge would put every name at a different x.
 */
import type { MethodStanding } from "~/utils/sign-in-paths";
import { METHOD_LABELS, methodIcon, type SignInMethod } from "~/utils/users";

const descriptions: Record<string, string> = {
  password: "A password saved on this account",
  passkey: "A passkey registered to this account",
  email_otp: "A one-time code delivered by email",
  sms_otp: "A one-time code delivered by SMS",
  google: "A connected Google account",
  apple: "A connected Apple account",
  microsoft: "A connected Microsoft account",
  github: "A connected GitHub account",
};

defineProps<{
  standings: readonly MethodStanding[];
}>();
</script>

<template>
  <ul v-if="standings.length > 0" class="method-list">
    <li
      v-for="standing in standings"
      :key="standing.method"
      class="method-list__item"
    >
      <span aria-hidden="true" class="method-list__icon">
        <Icon
          :class="methodIcon(standing.method).monochrome ? '[.v-theme--dark_&]:invert' : ''"
          :name="methodIcon(standing.method).icon"
          class="text-xl text-ink/75"
        />
      </span>

      <div class="method-list__identity">
        <span class="text-[13px] font-medium text-ink">{{ METHOD_LABELS[standing.method] }}</span>
        <span class="text-xs leading-5 text-ink/60">{{ descriptions[standing.method] }}</span>
      </div>
      <span class="method-list__status">
        <StatusBadge :label="standing.usable ? 'Available' : 'Unavailable'" :tone="standing.usable ? 'success' : 'warning'" />
      </span>

      <span v-if="standing.reason" class="method-list__reason text-xs leading-5 text-ink/60">
        {{ standing.reason }}
        <NuxtLink
          v-if="standing.fix"
          :to="standing.fix.to"
          class="block w-fit font-medium text-primary no-underline transition-colors hover:underline"
        >
          {{ standing.fix.label }}
          <Icon aria-hidden="true" class="align-[-2px] text-sm" name="material-symbols:chevron-right" />
        </NuxtLink>
      </span>
    </li>
  </ul>

  <p v-else class="rounded-lg border border-dashed border-line p-5 text-xs leading-6 text-ink/60">
    Nothing is enrolled on this account, so there is no way in to check.
  </p>
</template>

<style scoped>
.method-list { margin: 0; padding: 0; list-style: none; }
.method-list__item { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; padding: 14px 0; }
.method-list__item:first-child { padding-top: 4px; }
.method-list__item + .method-list__item { border-top: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity)); }
.method-list__icon { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; background: rgba(var(--v-theme-on-surface), .04); border-radius: 6px; }
.method-list__identity { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.method-list__reason { grid-column: 2 / -1; }
@media (max-width: 600px) {
  .method-list__item { grid-template-columns: 32px minmax(0, 1fr); padding: 12px 0; }
  .method-list__status { grid-column: 2; }
}
</style>
