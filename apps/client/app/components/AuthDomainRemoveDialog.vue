<script setup lang="ts">
/**
 * Confirms taking an auth domain off a project.
 *
 * A dialog because the consequence is immediate and wide: the host stops answering, every
 * client configured to call it fails, and cookie mode is refused for everybody until they
 * are pointed back at the shared host. That is a different shape of loss from most delete
 * confirmations, so it is said in those terms rather than as "this cannot be undone".
 *
 * The acknowledgement is asked for only where the domain is live, because a domain that
 * never verified is serving nobody and removing it costs nothing.
 */
import { type AuthDomain, SHARED_API_HOST, siteOf } from "~/utils/auth-domains";

const props = defineProps<{
  domain: AuthDomain;
  removing: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const live = computed(() => props.domain.status === "verified");

const acknowledged = ref(false);

watch(open, (value) => {
  if (value) acknowledged.value = false;
});

const ready = computed(() => (live.value ? acknowledged.value : true) && !props.removing);

function confirm() {
  if (!ready.value) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Remove this auth domain?</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <template v-if="live">
              <span class="font-mono text-ink/80">{{ domain.domain }}</span> stops answering
              at once. Anything pointed at it fails until it is pointed back at
              <span class="font-mono text-ink/80">{{ SHARED_API_HOST }}</span
              >, and cookie mode is refused there, so every session moves to header mode.
            </template>
            <template v-else>
              <span class="font-mono text-ink/80">{{ domain.domain }}</span> never verified,
              so it is serving nobody and nothing changes for your users. The DNS records
              you published for it can go too.
            </template>
          </p>
        </header>

        <p v-if="live" class="m-0 text-xs leading-5 text-ink/60">
          Signed-in users are not signed out. Their refresh tokens are still valid, and a
          client that reaches the shared host with them carries on in header mode. What
          breaks is any client still calling a hostname that no longer resolves.
        </p>

        <label
          v-if="live"
          class="flex cursor-pointer items-start gap-2.5 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-4 py-3"
        >
          <input
            v-model="acknowledged"
            class="mt-0.5 size-3.5 flex-none accent-[rgb(var(--v-theme-warning))]"
            type="checkbox"
          />
          <span class="text-xs leading-5 text-ink/75">
            I will point my clients at
            <span class="font-mono">{{ SHARED_API_HOST }}</span> before removing this, or I
            accept that pages under <span class="font-mono">{{ siteOf(domain.domain) }}</span>
            will fail until I do.
          </span>
        </label>

        <footer class="flex items-center justify-end gap-2">
          <v-btn
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            :disabled="!ready"
            :loading="removing"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Remove
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
