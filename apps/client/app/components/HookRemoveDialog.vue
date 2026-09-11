<script setup lang="ts">
/**
 * Takes a hook out of the path, by turning it off or by removing its endpoint, and names what
 * stops being enforced (notes/hooks.md, "Removing a gate").
 *
 * A gate that is on asks for an acknowledgement naming the requests it will no longer check,
 * with Keep gate beside the action: turning one off is a policy change from the very next
 * sign-in. A hook that is not enabled enforces nothing, so its endpoint goes without one.
 * Turning off keeps the endpoint and the check; removing drops both.
 */
import {
  GATE_SUBJECTS,
  HOOK_KINDS,
  HOOK_LABELS,
  HOOK_SKIPPED,
  type HookConfig,
  KIND_NOUNS,
  NEXT_REQUEST,
} from "~/utils/hooks";

const props = defineProps<{
  hook: HookConfig;
  action: "disable" | "remove";
  projectName: string;
  busy: boolean;
  error: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const titleId = `${useId()}-title`;
const noun = computed(() => KIND_NOUNS[HOOK_KINDS[props.hook.type]]);
const subject = computed(() => GATE_SUBJECTS[props.hook.type] ?? null);

/** Only a gate that is on is a policy somebody relies on. */
const asks = computed(() => props.hook.enabled && subject.value !== null);
const acknowledged = ref(false);
const submitted = ref(false);
const missing = computed(() => asks.value && submitted.value && !acknowledged.value);

const title = computed(() =>
  props.action === "disable"
    ? `Turn off ${HOOK_LABELS[props.hook.type]}`
    : `Remove endpoint for ${HOOK_LABELS[props.hook.type]}`,
);

const confirmLabel = computed(() => {
  if (props.action === "disable") return `Turn off ${noun.value}`;
  return props.hook.enabled ? `Remove ${noun.value}` : "Remove endpoint";
});

const statement = computed(() => {
  const words = subject.value ?? "";
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} on ${props.projectName} will no longer be checked by this gate.`;
});

function confirm() {
  submitted.value = true;
  if ((asks.value && !acknowledged.value) || props.busy) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" :aria-labelledby="titleId" max-width="520">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 :id="titleId" class="m-0 text-base font-medium text-ink">{{ title }}</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            On <span class="font-medium text-ink">{{ projectName }}</span>.
            <span class="font-mono break-all text-ink/80">{{ hook.url }}</span>
          </p>
        </header>

        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-xs leading-5 text-ink/75">
          <li v-if="hook.enabled" class="flex items-start gap-2">
            <Icon
              aria-hidden="true"
              class="mt-0.5 flex-none text-sm text-warning"
              name="material-symbols:do-not-disturb-on-outline"
            />
            <span>{{ HOOK_SKIPPED[hook.type] }}</span>
          </li>
          <li v-else class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:info-outline" />
            <span>
              It is not enabled, so nothing is enforced by it and no {{ NEXT_REQUEST[hook.type] }}
              changes.
            </span>
          </li>
          <li class="flex items-start gap-2">
            <Icon aria-hidden="true" class="mt-0.5 flex-none text-sm text-ink/40" name="material-symbols:history" />
            <span v-if="action === 'disable'">
              The endpoint, the deadline and the check are kept, so turning it back on is Review and
              enable.
            </span>
            <span v-else>
              The endpoint and its check go, so setting it up again means validating it again. The
              deadline and the project's hook secret stay.
            </span>
          </li>
        </ul>

        <div v-if="asks" class="flex flex-col gap-1">
          <label
            class="flex cursor-pointer items-start gap-1 rounded-(--idenzy-radius-small) bg-ink/4 py-2 pr-3 pl-2 ring-1 ring-ink/6 ring-inset"
          >
            <v-checkbox-btn v-model="acknowledged" class="-mt-0.5 flex-none" color="primary" density="compact" />
            <span class="pt-1 text-xs leading-5 text-ink">{{ statement }}</span>
          </label>
          <p v-if="missing" class="m-0 text-[11px] leading-4 text-error" role="alert">
            Tick this to confirm that {{ subject }} stop being checked.
          </p>
        </div>

        <p v-if="error" class="m-0 text-xs leading-5 text-error" role="alert">{{ error }}</p>

        <footer class="flex flex-wrap items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            {{ hook.enabled ? `Keep ${noun}` : "Cancel" }}
          </v-btn>
          <v-btn :loading="busy" class="text-xs font-medium" color="error" size="small" type="submit" variant="flat">
            {{ confirmLabel }}
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
