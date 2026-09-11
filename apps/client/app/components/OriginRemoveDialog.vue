<script setup lang="ts">
/**
 * Takes an origin off the list. A dialog rather than a menu item because the failure it
 * causes is silent from the customer's side: their page keeps loading, the request still
 * reaches us and is still answered, and the browser throws the response away. Nothing in
 * their server logs, ours, or the network tab's status column says why.
 *
 * The last one is worth naming separately. A project with an empty list is not a project
 * that refuses browsers loudly; it is one where every credentialed call from a page fails
 * the same quiet way, which reads as the SDK being broken.
 */
import { corsSample } from "~/utils/origins";

const props = defineProps<{
  origin: string;
  /** Whether it is the only one left, which is a different sentence. */
  last: boolean;
  busy: boolean;
}>();

const open = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  confirm: [];
}>();

const after = computed(() => corsSample(props.origin, false));

function confirm() {
  if (props.busy) return;
  emit("confirm");
}
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card border flat>
      <form class="flex flex-col gap-5 p-5" @submit.prevent="confirm">
        <header class="flex flex-col gap-1">
          <h2 class="m-0 text-sm font-medium text-ink">Stop allowing this origin</h2>
          <p class="m-0 text-xs leading-5 text-ink/60">
            <span class="font-mono text-ink/80">{{ origin }}</span> comes off the list on the
            next request. A page there can still reach the API and will no longer be allowed
            to read what comes back.
          </p>
        </header>

        <div class="flex flex-col gap-2 rounded-(--idenzy-radius-small) bg-ink/4 ring-1 ring-ink/6 ring-inset p-3">
          <p class="m-0 text-[11px] font-medium text-ink/70">What that page sees afterwards</p>
          <p class="m-0 font-mono text-[11px] text-ink">{{ after.status }}</p>
          <p
            v-for="header in after.headers"
            :key="header.name"
            class="m-0 font-mono text-[11px] text-ink/60"
          >
            {{ header.name }}: {{ header.value }}
          </p>
          <p class="m-0 text-[11px] leading-4 text-ink/55">{{ after.outcome }}</p>
        </div>

        <p v-if="last" class="m-0 flex items-start gap-2 text-xs leading-5 text-warning">
          <Icon
            aria-hidden="true"
            class="mt-0.5 flex-none text-sm"
            name="material-symbols:warning-outline"
          />
          <span>
            It is the last one. With an empty list no browser anywhere can complete a
            sign-in on this project, and every failure looks like the SDK rather than a
            setting.
          </span>
        </p>

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
            :loading="busy"
            class="text-xs font-medium"
            color="error"
            size="small"
            type="submit"
            variant="flat"
          >
            Stop allowing it
          </v-btn>
        </footer>
      </form>
    </v-card>
  </v-dialog>
</template>
