<script setup lang="ts">
/**
 * Leaves the organisation.
 *
 * Two of the three effects are the ones people are wrong about. A key you minted keeps
 * working after you go, because it belongs to the project rather than to you, and somebody
 * leaving under a cloud is exactly when that matters. And the audit trail keeps your name,
 * because a trail that lost its actors when somebody left would be no trail at all.
 *
 * When leaving is refused, the dialog says why rather than the button being missing. An owner
 * has to transfer first because ownership moves rather than being vacated, and the last
 * member cannot leave because an organisation nobody can reach is worse than one with a
 * member in it. Both are rules `utils/account` states and `utils/members` enforces, so a
 * template that merely hid the button would be hiding a rule an API call gets past.
 */
import { LEAVE_EFFECTS, LEAVE_REFUSAL_LABELS, type LeaveRefusal } from "~/utils/account";

const props = defineProps<{
  orgName: string;
  /** Null when leaving is allowed. */
  refusal: LeaveRefusal | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const acknowledged = ref(false);

watch(open, (showing) => {
  if (showing) acknowledged.value = false;
});

const ready = computed(() => props.refusal === null && acknowledged.value);

function confirm() {
  if (!ready.value) return;
  emit("confirm");
}

/* Closes on the write landing rather than on the click. */
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) open.value = false;
  },
);
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">
            Leave <span class="text-error">{{ orgName }}</span>
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Your access ends immediately. Nothing about the organisation's projects changes.
          </p>
        </header>

        <p
          v-if="refusal"
          class="m-0 flex items-start gap-2 rounded-(--idenzy-radius-small) border border-warning/30 bg-warning/6 px-3 py-2.5 text-[11px] leading-4 text-ink/80"
        >
          <Icon
            aria-hidden="true"
            class="mt-px flex-none text-sm text-warning"
            name="material-symbols:warning-outline"
          />
          <span>{{ LEAVE_REFUSAL_LABELS[refusal] }}</span>
        </p>

        <ul class="m-0 flex list-none flex-col gap-2.5 p-0 text-xs leading-5 text-ink/75">
          <li v-for="effect in LEAVE_EFFECTS" :key="effect.id" class="flex items-start gap-2">
            <Icon
              :name="effect.icon"
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-ink/40"
            />
            <span>
              <span class="font-medium text-ink">{{ effect.label }}.</span>
              {{ effect.note }}
            </span>
          </li>
        </ul>

        <label
          v-if="refusal === null"
          class="flex cursor-pointer items-start gap-2 text-xs text-ink"
        >
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="error"
            density="compact"
          />
          <span class="pt-px">
            I understand I will need a new invitation to come back.
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
            Stay
          </v-btn>
          <v-btn
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Leave the organisation
          </v-btn>
        </footer>
      </form>
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
