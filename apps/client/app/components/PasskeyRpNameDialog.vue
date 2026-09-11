<script setup lang="ts">
/**
 * Renames the relying party. The name is what the authenticator shows when it asks
 * someone to create or use a passkey, so it is the customer's product name and nothing
 * of ours. Changing it costs nothing: a credential is bound to the RP ID, not the name.
 */
import { RP_ISSUE_LABELS } from "~/utils/passkeys";

const props = defineProps<{
  current: string;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [name: string];
}>();

const name = ref("");
/* Focused once the dialog has finished entering; `autofocus` loses to the overlay's own focus. */
const field = useTemplateRef<{ focus: () => void }>("field");

watch(open, (value) => {
  if (value) name.value = props.current;
});

const issue = computed(() => {
  const text = name.value.trim();
  if (text === "") return RP_ISSUE_LABELS.rp_name_missing;
  if (text === props.current) return "That is the name the project shows now.";
  return "";
});

const ready = computed(() => issue.value === "");

function confirm() {
  if (!ready.value) return;
  emit("confirm", name.value.trim());
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="440" @after-enter="field?.focus()">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Edit the product name</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            What the authenticator shows when it asks. Passkeys already enrolled keep working.
          </p>
        </header>

        <div class="flex flex-col gap-1">
          <label class="text-xs font-medium text-ink" for="rp-name-next">Product name</label>
          <v-text-field
            id="rp-name-next"
            ref="field"
            v-model="name"
            :error="name.trim() === ''"
            autocomplete="off"
            hide-details
            name="idenzy-passkey-product-name"
            placeholder="Your product's name"
            variant="filled"
          />
          <p class="m-0 text-[11px]" :class="name.trim() === '' ? 'text-error' : 'text-ink/50'">
            {{ name.trim() === "" ? issue : "Your product, as its users know it." }}
          </p>
        </div>

        <footer class="flex items-center justify-end gap-2">
          <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
            Cancel
          </v-btn>
          <v-btn :disabled="!ready" class="text-xs font-medium" color="primary" size="small" type="submit" variant="flat">
            Save name
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
