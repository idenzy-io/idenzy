<script setup lang="ts">
/**
 * The one question a save can ask: private metadata is about to be published into every
 * token, is that meant? It names the mappings that do it, says who can read a token, and
 * takes a tick before the save goes ahead. What the server stores is when this was
 * given, so the dialog says that too: the question a reviewer asks later is not whether
 * a box was ticked but when somebody agreed.
 */
import type { ClaimMapping } from "~/utils/claims";

const props = defineProps<{
  /** The mappings that read private metadata. */
  claims: readonly ClaimMapping[];
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const agreed = ref(false);

watch(open, (value) => {
  if (value) agreed.value = false;
});

const names = computed(() => props.claims.map((claim) => claim.name.trim()));

function confirm() {
  if (!agreed.value) return;
  emit("confirm");
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 flex items-center gap-2 text-sm font-medium text-ink">
            <Icon aria-hidden="true" class="text-base text-warning" name="material-symbols:lock-open-outline" />
            Publish private metadata into every token?
          </h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            Private metadata is the one place you keep what a browser was never meant to
            see. An access token is read by everything the user's device sends it to: your
            own servers, and anything else that asks for it.
          </p>
        </header>

        <div class="flex flex-col gap-1.5 rounded-(--idenzy-radius-small) border border-warning/40 bg-warning/6 px-3.5 py-3">
          <p class="m-0 text-[11px] font-medium text-ink">
            {{ names.length === 1 ? "This claim reads it" : "These claims read it" }}
          </p>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            <li v-for="claim in claims" :key="claim.name" class="flex items-center gap-2 text-[11px]">
              <span class="font-mono text-ink">{{ claim.name.trim() || "(unnamed)" }}</span>
              <span class="text-ink/45">reads</span>
              <span class="font-mono text-ink/80">metadata_private.{{ claim.path.trim() }}</span>
            </li>
          </ul>
        </div>

        <label class="flex cursor-pointer items-start gap-2 text-xs leading-5 text-ink">
          <v-checkbox-btn v-model="agreed" class="-mt-0.5" color="primary" density="compact" />
          <span>
            I understand that these values will be in every access token this project
            issues, for every user, and readable by anything the token is sent to.
          </span>
        </label>

        <footer class="flex items-center justify-between gap-3">
          <p class="m-0 text-[11px] text-ink/50">
            The time of this acknowledgement is stored with the template.
          </p>
          <span class="flex items-center gap-2">
            <v-btn class="text-xs font-medium" color="neutral" size="small" variant="text" @click="open = false">
              Cancel
            </v-btn>
            <v-btn :disabled="!agreed" class="text-xs font-medium" color="warning" size="small" type="submit" variant="flat">
              Acknowledge and save
            </v-btn>
          </span>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:deep(.v-selection-control) {
  --v-selection-control-size: 24px;

  flex: none;
  min-height: 0;
}
</style>
