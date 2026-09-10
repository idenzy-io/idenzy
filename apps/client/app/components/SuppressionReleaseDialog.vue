<script setup lang="ts">
/**
 * Confirms taking one address off the suppression list.
 *
 * Behind a dialog because releasing is not undoing a mistake, it is overruling a mailbox
 * provider that told us the address does not exist or that its owner marked us as spam.
 * Sending to a hard bounce again is the fastest way to lose a sending reputation, and the
 * reputation is shared with every project on the domain, so the reader is told what they
 * are taking on rather than asked to confirm a generic deletion.
 *
 * The acknowledgement is a tick for the two reasons a provider raised and is not asked for
 * the two somebody chose, because making a person confirm a risk they created themselves
 * teaches them to tick boxes.
 */
import { reasonInfo, reasonLabel, type SuppressionRow, shortDigest } from "~/utils/suppressions";
import { formatDateTime } from "~/utils/time";

const props = defineProps<{
  row: SuppressionRow;
  /** The address that was typed to find it, where a lookup is what opened this. */
  address: string;
  releasing: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const info = computed(() => reasonInfo(props.row.reason));
const severe = computed(() => info.value?.severe ?? false);

const acknowledged = ref(false);

watch(open, (value) => {
  if (value) acknowledged.value = false;
});

const ready = computed(() => (severe.value ? acknowledged.value : true) && !props.releasing);

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
          <h2 class="m-0 text-sm font-medium text-ink">Send to this address again?</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Releasing removes the row. The next message to it is attempted normally, and
            nothing is left saying it was ever on the list.
          </p>
        </header>

        <div
          class="flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 px-4 py-3 ring-1 ring-ink/6 ring-inset"
        >
          <div v-if="address" class="flex items-baseline justify-between gap-3">
            <span class="text-[11px] text-ink/55">Address</span>
            <span class="truncate font-mono text-xs text-ink">{{ address }}</span>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-[11px] text-ink/55">Digest</span>
            <span class="font-mono text-xs text-ink/75">{{ shortDigest(row.targetHash) }}</span>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-[11px] text-ink/55">Why</span>
            <span class="text-xs text-ink">{{ reasonLabel(row.reason) }}</span>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-[11px] text-ink/55">Added</span>
            <span class="font-mono text-xs text-ink/75">{{ formatDateTime(row.createdAt) }}</span>
          </div>
        </div>

        <p v-if="info" class="m-0 text-xs leading-5 text-ink/60">{{ info.note }}</p>

        <label
          v-if="severe"
          class="flex cursor-pointer items-start gap-2.5 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-4 py-3"
        >
          <input
            v-model="acknowledged"
            class="mt-0.5 size-3.5 flex-none accent-[rgb(var(--v-theme-warning))]"
            type="checkbox"
          />
          <span class="text-xs leading-5 text-ink/75">
            I know a provider reported this, and that sending again puts a reputation shared
            with every project on this domain at risk.
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
            :loading="releasing"
            class="text-xs font-medium"
            color="warning"
            size="small"
            type="submit"
            variant="flat"
          >
            Release
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
