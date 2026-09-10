<script setup lang="ts">
/**
 * Takes an endpoint off the project. What makes this worth a dialog is what a webhook is:
 * a notification and never a log. Nothing queues while an endpoint is gone and nothing is
 * replayed when one comes back, so the events that happen in between are not delayed,
 * they simply never reach anybody.
 *
 * Switching it off has the same effect and keeps the URL, the event list and the secret,
 * which is almost always what somebody pausing a deploy actually wants. The dialog offers
 * it, because a removal made for that reason is one that has to be set up again from
 * nothing.
 */
import type { WebhookEndpoint } from "~/utils/webhooks";

const props = defineProps<{
  endpoint: WebhookEndpoint | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
  disable: [];
}>();

function confirm() {
  if (props.busy) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card v-if="endpoint" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Remove this endpoint</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <span class="font-mono text-ink/80">{{ endpoint.url }}</span> stops being
            called, and its signing secret stops being valid. Neither can be recovered:
            adding the URL again makes a new endpoint with a new secret.
          </p>
        </header>

        <p
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3 text-[11px] leading-4 text-ink/70"
        >
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm text-ink/50"
            name="material-symbols:info-outline"
          />
          <span>
            A webhook is a notification and never a log. Nothing queues while this is gone
            and nothing is replayed afterwards, so events between now and whenever it comes
            back reach nobody.
          </span>
        </p>

        <footer class="flex flex-wrap items-center justify-between gap-2">
          <v-btn
            v-if="endpoint.enabled"
            :loading="busy"
            class="text-xs font-medium"
            color="neutral"
            size="small"
            variant="outlined"
            @click="emit('disable')"
          >
            Switch it off instead
          </v-btn>
          <span class="ml-auto flex items-center gap-2">
            <v-btn
              class="text-xs font-medium"
              color="neutral"
              size="small"
              variant="text"
              @click="open = false"
            >
              Keep it
            </v-btn>
            <v-btn
              :loading="busy"
              class="text-xs font-medium"
              color="error"
              size="small"
              type="submit"
              variant="flat"
            >
              Remove endpoint
            </v-btn>
          </span>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
