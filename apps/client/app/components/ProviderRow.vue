<script setup lang="ts">
/**
 * One provider a project has set up: the mark, what it is, and the switch that decides
 * whether anybody can sign in with it.
 *
 * The three things under the name are the three a support question is usually about.
 * Which credentials are in use, because instant mode works on localhost and nowhere
 * else. What it asserts about an address, because that is why a sign-in did or did not
 * find an existing account. And which scopes are requested, because a consent screen
 * that asks for too much is a conversion problem the customer sees before we do.
 *
 * The switch writes on the spot, as everything on this screen does. Turning a provider
 * off leaves the credentials and the identities alone: it is a door closed, not a door
 * removed, which is what the menu's last item is for.
 */
import {
  ASSERTION_LOOK,
  MODE_LABELS,
  type ProviderConfig,
  type ProviderInfo,
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
  configure: [];
  "copy-callback": [];
  remove: [];
}>();

const now = useNow({ interval: 60_000 });

const scopes = computed(() => scopesOf(props.info, props.config));
const assertion = computed(() => ASSERTION_LOOK[props.info.email]);

/** The mode's own word, and the warning that comes with the shared app. */
const mode = computed(() => MODE_LABELS[props.config.mode]);

const secretAge = computed(() =>
  props.config.secretUpdatedAt === null
    ? ""
    : relativeTimeWords(props.config.secretUpdatedAt, now.value),
);
</script>

<template>
  <div
    :class="config.enabled ? '' : 'opacity-60'"
    class="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-opacity duration-150"
  >
    <span class="flex size-9 flex-none items-center justify-center text-ink">
      <Icon
        :class="[info.monochrome ? '[.v-theme--dark_&]:invert' : '', info.tint ?? '']"
        :name="info.icon"
        aria-hidden="true"
        class="text-[26px]"
      />
    </span>

    <div class="flex min-w-0 flex-1 basis-64 flex-col gap-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="truncate text-sm font-medium text-ink">{{ info.label }}</span>
        <span
          class="rounded-full border border-line px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap text-ink/55"
        >
          {{ info.protocol === "oidc" ? "OIDC" : "OAuth 2" }}
        </span>
        <v-tooltip :text="mode.detail" location="top" max-width="280">
          <template #activator="{ props: tip }">
            <span
              v-bind="tip"
              :class="
                config.mode === 'instant'
                  ? 'border-warning/40 bg-warning/8 text-warning'
                  : 'border-line text-ink/55'
              "
              class="rounded-full border px-1.5 text-[10px] leading-4 font-medium whitespace-nowrap"
            >
              {{ mode.label }}
            </span>
          </template>
        </v-tooltip>
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/55">
        <span v-if="config.mode === 'custom'" class="flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:key-outline" />
          <span class="max-w-56 truncate font-mono text-ink/70">{{ config.clientId }}</span>
        </span>
        <span v-else class="flex items-center gap-1.5">
          <Icon aria-hidden="true" class="flex-none text-xs" name="material-symbols:bolt" />
          Our shared app
        </span>

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
          :text="scopes.length === 0 ? 'Notion takes no scopes.' : scopes.join(' ')"
          location="top"
          max-width="300"
        >
          <template #activator="{ props: tip }">
            <span v-bind="tip" class="flex items-center gap-1.5">
              <Icon
                aria-hidden="true"
                class="flex-none text-xs"
                name="material-symbols:tune"
              />
              {{ scopes.length === 0 ? "No scopes" : `${scopes.length} scopes` }}
              <span v-if="config.scopes.length > 0" class="text-ink/40">· yours</span>
            </span>
          </template>
        </v-tooltip>

        <v-tooltip
          v-if="secretAge"
          location="top"
          max-width="280"
          text="Stored envelope encrypted under this project's data key. It cannot be read back, here or anywhere."
        >
          <template #activator="{ props: tip }">
            <span v-bind="tip" class="flex items-center gap-1.5">
              <Icon
                aria-hidden="true"
                class="flex-none text-xs"
                name="material-symbols:lock-outline"
              />
              Secret written {{ secretAge }}
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

    <div class="ml-auto flex flex-none items-center gap-3">
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

      <v-menu :offset="4" location="bottom end">
        <template #activator="{ props: activator }">
          <button
            v-bind="activator"
            :aria-label="`Actions for ${info.label}`"
            class="provider-row__trigger inline-flex size-7 items-center justify-center rounded-(--idenzy-radius-x-small) text-ink/55 transition-colors duration-150 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            type="button"
          >
            <Icon aria-hidden="true" class="text-base" name="material-symbols:more-horiz" />
          </button>
        </template>

        <v-list density="compact" min-width="232" nav>
          <v-list-item
            prepend-icon="material-symbols:tune"
            title="Credentials and scopes"
            @click="emit('configure')"
          />
          <v-list-item
            prepend-icon="material-symbols:content-copy-outline"
            title="Copy callback URL"
            @click="emit('copy-callback')"
          />
          <v-divider class="my-1" />
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

    <p v-if="config.mode === 'instant'" class="basis-full text-[11px] leading-4 text-warning sm:pl-13">
      Our shared OAuth app shows our name on the consent screen and is refused anywhere but
      localhost and preview domains. Move to your own before this project meets a user.
    </p>
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
