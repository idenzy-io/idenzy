<script setup lang="ts">
/**
 * Takes an endpoint off the project, and offers pausing it first (notes/webhooks.md).
 *
 * The two differ in what survives, and the dialog says both halves. Removing ends the URL, the
 * event list and the secret, and adding the URL again makes a new endpoint with a new secret.
 * Pausing keeps all three. Neither queues anything: a webhook is a notification and never a
 * log, so events while it is gone or paused reach nobody, and resuming replays nothing.
 */
import type { WebhookEndpoint } from "~/utils/webhooks";

const props = defineProps<{
  endpoint: WebhookEndpoint;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
  pause: [];
}>();

const titleId = `${useId()}-title`;

function confirm() {
  if (!props.busy) emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="500">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">Remove endpoint</h2>
          <p class="m-0 text-xs leading-5 break-all text-ink/60">
            <span class="font-mono text-ink/80">{{ endpoint.url }}</span>
          </p>
        </header>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:link-off" />
            <span>
              It stops being called and its signing secret stops being valid. Neither comes
              back: adding the URL again makes a new endpoint with a new secret.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:history" />
            <span>
              Deliveries waiting for a retry are dropped, and no event is kept for it from now
              on. A webhook is a notification and never a log.
            </span>
          </li>
          <li v-if="endpoint.enabled" class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
              name="material-symbols:pause-circle-outline"
            />
            <span>
              Pausing is the safer choice for a redeploy: it keeps the URL, the events and the
              secret. While paused nothing is queued, and resuming replays nothing.
            </span>
          </li>
        </ul>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex flex-wrap items-center justify-end gap-2">
          <v-btn
            v-if="endpoint.enabled"
            :disabled="busy"
            class="mr-auto text-xs font-medium"
            color="neutral"
            size="small"
            variant="text"
            @click="emit('pause')"
          >
            Pause endpoint
          </v-btn>
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
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Remove endpoint
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
