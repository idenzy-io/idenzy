<script setup lang="ts">
/**
 * One provider a project has set up: the mark, what state it is actually in, and the two
 * controls that change it.
 *
 * The state is the point of the row. A provider can be off, missing a field, running on
 * our shared app, complete but never checked, or taking sign-ins, and those are five
 * different answers to "why can nobody sign in with Google". The badge names one of them
 * and the line under it says what that means for a user right now, so the row never
 * reports a bare "On" over a credential set that cannot finish an exchange.
 *
 * The primary action is a button on the row rather than an item in the ellipsis, and it
 * is named after the state: a provider missing a field says Finish setup, one on our
 * shared app says Use your own app, and everything else says Manage. Hiding the only
 * thing most visits are for behind a menu is what the ellipsis is not for.
 *
 * The switch writes on the spot, as everything on this screen does. Turning a provider
 * off leaves the credentials and the identities alone: a door closed, not a door removed,
 * which is what the menu's last item is for.
 */
import type { BadgeTone } from "~/components/StatusBadge.vue";
import {
  ASSERTION_LOOK,
  MODE_LABELS,
  missingFor,
  type ProviderConfig,
  type ProviderInfo,
  type ProviderReadiness,
  READINESS,
  readinessOf,
  scopesOf,
} from "~/utils/providers";
import { relativeTimeWords } from "~/utils/time";

const props = defineProps<{
  info: ProviderInfo;
  config: ProviderConfig;
  /** Sign-ins through this provider over the last thirty days. */
  signIns: number;
  busy: boolean;
}>();

const emit = defineEmits<{
  toggle: [value: boolean];
  manage: [];
  "copy-callback": [];
  remove: [];
}>();

const now = useNow({ interval: 60_000 });

const TONES: Record<ProviderReadiness, BadgeTone> = {
  incomplete: "warning",
  off: "neutral",
  development: "warning",
  untested: "neutral",
  ready: "success",
};

const state = computed(() => readinessOf(props.info, props.config));
const look = computed(() => READINESS[state.value]);
const missing = computed(() => missingFor(props.info, props.config));

const scopes = computed(() => scopesOf(props.info, props.config));
const assertion = computed(() => ASSERTION_LOOK[props.info.email]);
const mode = computed(() => MODE_LABELS[props.config.mode]);

const checked = computed(() =>
  props.config.testedAt === null ? "" : relativeTimeWords(props.config.testedAt, now.value),
);

/**
 * The line under the name. What is missing outranks everything else, because it is the
 * only one of these that has to be acted on before the rest mean anything.
 */
const summary = computed(() => {
  if (missing.value.length > 0) return `Missing ${missing.value.join(" and ")}.`;
  return look.value.detail;
});
</script>

<template>
  <div
    :class="config.enabled ? '' : 'opacity-70'"
    class="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3.5 gap-y-3 px-4 py-3.5 transition-opacity duration-150 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto]"
  >
    <span aria-hidden="true" class="flex size-9 flex-none items-center justify-center text-ink">
      <Icon
        :class="[info.monochrome ? '[.v-theme--dark_&]:invert' : '', info.tint ?? '']"
        :name="info.icon"
        class="text-[26px]"
      />
    </span>

    <div class="flex min-w-0 flex-col gap-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="truncate text-sm font-medium text-ink">{{ info.label }}</span>
        <StatusBadge :label="look.label" :tone="TONES[state]" />
        <span
          class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
        >
          {{ info.protocol === "oidc" ? "OIDC" : "OAuth 2" }}
        </span>
      </div>

      <p
        :class="missing.length > 0 ? 'text-warning' : 'text-ink/60'"
        class="m-0 text-xs leading-5"
      >
        {{ summary }}
      </p>

      <!-- The four facts a support question is usually about: whose app, what it says
           about an address, what the consent screen asks for, and when this was last
           checked. Each is one line high, so a row of them stays one line. -->
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
        <v-tooltip :text="mode.detail" location="top" max-width="280">
          <template #activator="{ props: tip }">
            <span v-bind="tip" class="flex min-w-0 items-center gap-1.5">
              <Icon
                :name="
                  config.mode === 'instant'
                    ? 'material-symbols:bolt'
                    : 'material-symbols:key-outline'
                "
                aria-hidden="true"
                class="flex-none text-xs"
              />
              <span v-if="config.mode === 'custom' && config.clientId" class="max-w-56 truncate font-mono text-ink/70">
                {{ config.clientId }}
              </span>
              <span v-else>{{ mode.label === "Instant" ? "Our shared app" : "Your own app" }}</span>
            </span>
          </template>
        </v-tooltip>

        <v-tooltip :text="info.emailNote" location="top" max-width="300">
          <template #activator="{ props: tip }">
            <span v-bind="tip" class="flex items-center gap-1.5">
              <Icon
                :class="assertion.tone"
                :name="assertion.icon"
                aria-hidden="true"
                class="flex-none text-xs"
              />
              {{ assertion.label }}
            </span>
          </template>
        </v-tooltip>

        <v-tooltip
          :text="scopes.length === 0 ? `${info.label} takes no scopes.` : scopes.join(' ')"
          location="top"
          max-width="300"
        >
          <template #activator="{ props: tip }">
            <span v-bind="tip" class="flex items-center gap-1.5">
              <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:tune" />
              {{ scopes.length === 0 ? "No scopes" : `${scopes.length} scopes` }}
              <span v-if="config.scopes.length > 0" class="text-ink/40">&middot; yours</span>
            </span>
          </template>
        </v-tooltip>

        <v-tooltip
          location="top"
          max-width="300"
          text="Read from this project's own configuration, so it answers the moment something changes. Nothing here signs anybody in."
        >
          <template #activator="{ props: tip }">
            <span v-bind="tip" class="flex items-center gap-1.5">
              <Icon
                aria-hidden="true"
                class="flex-none text-xs"
                name="material-symbols:fact-check-outline"
              />
              {{ checked ? `Checked ${checked}` : "Never checked" }}
            </span>
          </template>
        </v-tooltip>

        <span v-if="config.storeTokens" class="flex items-center gap-1.5">
          <Icon
            aria-hidden="true"
            class="flex-none text-xs"
            name="material-symbols:encrypted-outline"
          />
          Keeping provider tokens
        </span>
      </div>
    </div>

    <div class="col-start-2 flex flex-none flex-wrap items-center gap-x-3 gap-y-2 sm:col-start-3">
      <v-tooltip location="top" text="Sign-ins in the last 30 days">
        <template #activator="{ props: tip }">
          <span v-bind="tip" class="font-mono text-xs text-ink/70 tabular-nums">
            {{ signIns.toLocaleString("en") }}
          </span>
        </template>
      </v-tooltip>

      <v-switch
        :aria-label="`${info.label} sign-in`"
        :disabled="busy"
        :loading="busy"
        :model-value="config.enabled"
        color="primary"
        density="compact"
        hide-details
        inset
        @update:model-value="emit('toggle', $event === true)"
      />

      <v-btn
        :class="state === 'incomplete' ? 'text-warning' : ''"
        class="text-xs font-medium"
        color="neutral"
        size="small"
        variant="outlined"
        @click="emit('manage')"
      >
        {{ look.action }}
      </v-btn>

      <v-menu :offset="4" location="bottom end">
        <template #activator="{ props: activator }">
          <button
            v-bind="activator"
            :aria-label="`More actions for ${info.label}`"
            class="inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
          </button>
        </template>

        <v-list density="compact" min-width="232" nav>
          <v-list-item
            prepend-icon="material-symbols:content-copy-outline"
            title="Copy callback URL"
            @click="emit('copy-callback')"
          />
          <v-list-item
            :href="info.console.href"
            :title="info.console.label"
            append-icon="material-symbols:open-in-new"
            prepend-icon="material-symbols:settings-outline"
            rel="noopener"
            target="_blank"
          />
          <v-list-item
            :href="info.guide"
            append-icon="material-symbols:open-in-new"
            prepend-icon="material-symbols:menu-book-outline"
            rel="noopener"
            target="_blank"
            title="Setup guide"
          />
          <v-divider class="my-1" />
          <v-list-item
            class="provider-row__danger"
            prepend-icon="material-symbols:link-off"
            title="Remove from project"
            @click="emit('remove')"
          />
        </v-list>
      </v-menu>
    </div>
  </div>
</template>

<style scoped>
/* Outranks the nav list's own ink, which is three classes deep in theme.css. The scoped
   attribute survives the teleport into the overlay, so the rule reaches the item. */
.v-list--nav .v-list-item.provider-row__danger,
.v-list--nav .v-list-item.provider-row__danger:hover {
  color: rgb(var(--v-theme-error));
}
</style>
