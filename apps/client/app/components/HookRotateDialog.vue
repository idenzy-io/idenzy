<script setup lang="ts">
/**
 * Asks before rotating the project's hook secret. Every hook is signed with it, so all five move
 * together, and a hook is fail-closed: an endpoint still checking only the old secret after the
 * overlap refuses our calls, and each refusal fails a request. The deadline is named before
 * anything changes; the new secret follows in its own dialog, shown once.
 */
import { HOOK_CALLS, HOOK_ROTATION_OVERLAP_HOURS } from "~/utils/hooks";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  projectName: string;
  /** Hooks in the path, each of which fails its requests if its endpoint misses the change. */
  enabledCount: number;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-title`;
const running = HOOK_CALLS.running;
const deadline = formatDateTime(
  new Date(Date.now() + HOOK_ROTATION_OVERLAP_HOURS * 3_600_000).toISOString(),
);

function confirm() {
  if (!props.busy) emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="500">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">Rotate hook signing secret</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            For every hook on <span class="font-medium text-ink">{{ projectName }}</span>. Webhook
            secrets are not touched.
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
              The current one keeps signing beside it for {{ HOOK_ROTATION_OVERLAP_HOURS }} hours,
              until about <span class="font-medium text-ink">{{ deadline }}</span>. Deploy the new
              one before then.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-warning" name="material-symbols:warning-outline" />
            <span>
              After that, an endpoint that checks only the old secret refuses our calls, and a hook
              that is refused fails its request.
              <template v-if="running && enabledCount > 0">
                {{ enabledCount }} {{ enabledCount === 1 ? "hook is" : "hooks are" }} enabled on
                this project.
              </template>
            </span>
          </li>
          <li v-if="!running" class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:info-outline" />
            <span>Nothing calls a hook on this deployment yet, so no request is affected today.</span>
          </li>
        </ul>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :loading="busy" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Rotate secret
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
