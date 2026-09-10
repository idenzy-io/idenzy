<script setup lang="ts">
/**
 * Takes a domain off the project. Mail does not stop: if the one being removed is the
 * one sending, the From line falls back to the shared domain in the same write, because
 * a project with no sending domain is a project whose sign-in mail dies.
 *
 * That fallback is the whole reason this needs a dialog rather than a menu item. The
 * removal is reversible, the records are still in DNS and adding it again re-uses them,
 * but the address every user sees changes the moment it lands, and a change of sender is
 * the kind of thing that puts the next mail in a spam folder.
 */
import { fromAddress, type SendingDomain, SHARED_DOMAIN } from "~/utils/sending-domains";

const props = defineProps<{
  domain: SendingDomain | null;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const acknowledged = ref(false);

watch(open, (value) => {
  if (value) acknowledged.value = false;
});

const inUse = computed(() => props.domain?.inUse === true);
const ready = computed(() => !inUse.value || acknowledged.value);

function confirm() {
  if (!ready.value || props.busy) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card v-if="domain" border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Remove this domain</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <span class="font-mono text-ink/80">{{ domain.domain }}</span> comes off the
            project and we stop checking its records. The records themselves stay in your
            DNS, and adding the domain again picks up where this leaves off.
          </p>
        </header>

        <div
          v-if="inUse"
          class="flex flex-col gap-2 rounded-(--idenzy-radius-small) border border-line bg-canvas p-3"
        >
          <p class="m-0 text-xs leading-5 text-ink/80">
            This is the domain the project sends from, so the From line moves back to ours
            with the same change:
          </p>
          <p class="m-0 flex flex-wrap items-center gap-2 font-mono text-xs">
            <span class="text-ink/45 line-through">{{ fromAddress(domain.domain) }}</span>
            <Icon aria-hidden="true" class="text-sm text-ink/40" name="material-symbols:arrow-forward" />
            <span class="text-ink">{{ fromAddress(SHARED_DOMAIN) }}</span>
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">
            Mail keeps sending. What changes is the name your users see on it, and a sender
            that changes without warning is the kind of thing a mailbox treats as new.
          </p>
        </div>

        <label v-if="inUse" class="flex cursor-pointer items-start gap-2 text-xs text-ink">
          <v-checkbox-btn
            v-model="acknowledged"
            class="-mt-1.5 -ml-1.5"
            color="error"
            density="compact"
          />
          <span class="pt-px">I understand the From address changes for every user.</span>
        </label>

        <footer class="flex items-center justify-end gap-2">
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
            :color="inUse ? 'error' : 'primary'"
            :disabled="!ready"
            :loading="busy"
            class="text-xs font-medium"
            size="small"
            type="submit"
            variant="flat"
          >
            Remove domain
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
