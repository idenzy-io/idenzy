<script setup lang="ts">
/**
 * Asks before rotating an endpoint's signing secret, because a rotation starts a clock: the
 * previous secret signs beside the new one until a deadline, and a receiver still holding only
 * the old one fails verification after it. The dialog names that deadline before anything
 * changes, and the new secret follows in its own dialog, shown once.
 */
import { formatDateTime } from "~/utils/time";
import { ROTATION_OVERLAP_HOURS, WEBHOOK_DELIVERY, type WebhookEndpoint } from "~/utils/webhooks";

defineProps<{
  endpoint: WebhookEndpoint;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-title`;
const deadline = formatDateTime(
  new Date(Date.now() + ROTATION_OVERLAP_HOURS * 3_600_000).toISOString(),
);
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="emit('confirm')">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">Rotate signing secret</h2>
          <p class="m-0 text-xs leading-5 break-all text-ink/60">
            <span class="font-mono text-ink/80">{{ endpoint.url }}</span>
          </p>
        </header>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:key-outline" />
            <span>A new secret is made and shown once, in the next dialog.</span>
          </li>
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:history" />
            <span>
              The current secret keeps signing beside it for {{ ROTATION_OVERLAP_HOURS }} hours,
              until about <span class="font-medium text-ink">{{ deadline }}</span>. Deploy the
              new one before then; after it, a receiver holding only the old one fails
              verification.
            </span>
          </li>
          <li v-if="!WEBHOOK_DELIVERY.running" class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:info-outline" />
            <span>Nothing is sent on this deployment yet, so no receiver is affected today.</span>
          </li>
        </ul>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

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
            :loading="busy"
            class="text-xs font-medium"
            color="primary"
            size="small"
            type="submit"
            variant="flat"
          >
            Rotate secret
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
