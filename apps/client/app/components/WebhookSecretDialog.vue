<script setup lang="ts">
/**
 * The signing secret, the once. `webhooks.secret_hash` is a digest, so this value exists
 * on the wire for the length of this dialog and nowhere afterwards, including for us.
 *
 * It is its own dialog rather than a line on the endpoint's, and it cannot be closed by
 * clicking away or pressing escape: a customer who dismissed it by accident has an
 * endpoint they can only fix by rolling the secret they never saw. The acknowledgement is
 * there for the same reason, and it is the only place in this panel where a checkbox
 * guards a copy button rather than a destructive act.
 */
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "~/utils/webhooks";

defineProps<{
  secret: string;
  url: string;
  /** A roll says something different from a first one: the old secret is still working. */
  rolled: boolean;
  overlapHours: number;
}>();

const open = defineModel<boolean>({ required: true });

const kept = ref(false);

watch(open, (value) => {
  if (value) kept.value = false;
});
</script>

<template>
  <v-dialog v-model="open" max-width="520" persistent>
    <v-card border flat>
      <div class="flex flex-col gap-5 p-5">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">
            {{ rolled ? "The new signing secret" : "The signing secret" }}
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            We keep a hash of this and never the value, so this is the only time it is
            shown. Store it where
            <span class="font-mono text-ink/80">{{ url }}</span> can read it.
          </p>
        </header>

        <CopyField :value="secret" label="Copy the signing secret" />

        <div class="flex flex-col gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3">
          <p class="m-0 text-[11px] leading-4 text-ink/70">
            Every delivery carries
            <span class="font-mono text-ink">{{ TIMESTAMP_HEADER }}</span> and
            <span class="font-mono text-ink">{{ SIGNATURE_HEADER }}</span>. Verify the
            second over the first and the raw body, before you parse it.
          </p>
          <p v-if="rolled" class="m-0 text-[11px] leading-4 text-warning">
            The previous secret keeps working for {{ overlapHours }} hours, so deliveries
            do not stop while you deploy this one. After that it is refused.
          </p>
        </div>

        <label class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn v-model="kept" class="-mt-1.5 -ml-1.5" color="primary" density="compact" />
          <span class="pt-px">I have stored it. Nobody can show it to me again.</span>
        </label>

        <footer class="flex items-center justify-end">
          <v-btn
            :disabled="!kept"
            class="text-xs font-medium"
            color="primary"
            size="small"
            variant="flat"
            @click="open = false"
          >
            Done
          </v-btn>
        </footer>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 28px;

  flex: none;
  min-height: 0;
}

:deep(.v-selection-control__input > .v-icon) {
  font-size: 1.125rem;
}
</style>
